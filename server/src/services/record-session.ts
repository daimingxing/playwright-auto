import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseMeta } from '../../../shared/types';
import { buildStartUrl } from '../../../shared/url';
import { getCase } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { parseCodegenSpec } from './codegen-parser';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';
import { getPlaywrightCliPath } from './playwright-cli';
import { badRequest, notFound } from '../lib/http-error';

interface RecordSession {
  projectKey: string;
  caseKey: string;
  outputPath: string;
  child?: ChildProcess;
  createdAt: string;
  timer: ReturnType<typeof setTimeout>;
}

interface RecordInput {
  envKey?: string;
}

const sessions = new Map<string, RecordSession>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * 启动 Playwright codegen 录制会话。
 */
export async function startRecordSession(projectKey: string, caseKey: string, input: RecordInput = {}) {
  const project = await getProject(projectKey);
  const item = await getCase(projectKey, caseKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((env) => env.key === envKey);

  if (!envMeta) {
    throw notFound('录制环境不存在');
  }

  const sessionId = crypto.randomUUID();
  const dir = await mkdtemp(join(tmpdir(), 'playwright-auto-codegen-'));
  const outputPath = join(dir, 'record.spec.ts');
  const startUrl = buildStartUrl(envMeta.baseUrl, item.startPath);

  if (process.env.NODE_ENV === 'test') {
    await writeFile(outputPath, createTestSpec(startUrl), 'utf8');
    sessions.set(sessionId, {
      projectKey,
      caseKey,
      outputPath,
      createdAt: new Date().toISOString(),
      timer: createSessionTimer(sessionId)
    });
    return { sessionId, url: startUrl };
  }

  await assertVendorBrowser();

  const args = [
    getPlaywrightCliPath(),
    'codegen',
    '--target',
    'playwright-test',
    '--output',
    outputPath,
    '--browser',
    'chromium',
    startUrl
  ];

  if (await hasProjectAuth(projectKey, envKey)) {
    // codegen 的最后一个参数必须是 URL，登录态参数插入到 URL 前面。
    args.splice(args.length - 1, 0, '--load-storage', getProjectAuthPath(projectKey, envKey));
  }

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...getVendorEnv()
    },
    shell: false,
    stdio: 'ignore'
  });

  sessions.set(sessionId, {
    projectKey,
    caseKey,
    outputPath,
    child,
    createdAt: new Date().toISOString(),
    timer: createSessionTimer(sessionId)
  });

  return { sessionId, url: startUrl };
}

/**
 * 停止录制并返回录制步骤，不保存当前用例。
 */
export async function stopRecordSession(projectKey: string, caseKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey || session.caseKey !== caseKey) {
    throw badRequest('录制会话不存在或已结束');
  }

  if (isSessionExpired(session.createdAt)) {
    clearSession(session);
    sessions.delete(sessionId);
    throw badRequest('录制会话不存在或已结束');
  }

  await stopChild(session.child);

  const code = await readFile(session.outputPath, 'utf8');
  const result = parseCodegenSpec(code);

  clearSession(session);
  sessions.delete(sessionId);

  return {
    steps: result.steps
  };
}

/**
 * 尽量温和地停止 codegen 子进程。
 */
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    await killProcessTree(child.pid);
    return;
  }

  child.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1500);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * 在 Windows 下结束 codegen 进程树。
 */
async function killProcessTree(pid: number) {
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore'
    });

    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

/**
 * 创建会话过期定时器。
 */
function createSessionTimer(sessionId: string) {
  const timer = setTimeout(() => {
    const session = sessions.get(sessionId);

    clearSession(session);
    sessions.delete(sessionId);
  }, SESSION_TTL_MS);

  timer.unref?.();
  return timer;
}

/**
 * 判断会话是否已过期。
 */
function isSessionExpired(createdAt: string) {
  return Date.now() - Date.parse(createdAt) >= SESSION_TTL_MS;
}

/**
 * 清理会话关联资源。
 */
function clearSession(session: RecordSession | undefined) {
  if (!session) {
    return;
  }

  clearTimeout(session.timer);

  if (session.child && !session.child.killed && session.child.exitCode === null) {
    session.child.kill('SIGTERM');
  }
}

/**
 * 生成测试环境下的模拟 codegen 脚本。
 */
function createTestSpec(startUrl: string) {
  return `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('${startUrl}');
  await page.getByRole('textbox', { name: '名称' }).fill('测试订单');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存成功')).toBeVisible();
});
`;
}
