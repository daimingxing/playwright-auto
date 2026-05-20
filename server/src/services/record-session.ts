import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseMeta } from '../../../shared/types';
import { getCase, updateCase } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { parseCodegenSpec } from './codegen-parser';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';

interface RecordSession {
  projectKey: string;
  caseKey: string;
  outputPath: string;
  child?: ChildProcess;
  createdAt: string;
}

const sessions = new Map<string, RecordSession>();

/**
 * 启动 Playwright codegen 录制会话。
 */
export async function startRecordSession(projectKey: string, caseKey: string) {
  const project = await getProject(projectKey);
  const item = await getCase(projectKey, caseKey);
  const envMeta = project.envs.find((env) => env.key === project.defaultEnv);

  if (!envMeta) {
    throw new Error('录制环境不存在');
  }

  const sessionId = crypto.randomUUID();
  const dir = await mkdtemp(join(tmpdir(), 'playwright-auto-codegen-'));
  const outputPath = join(dir, 'record.spec.ts');
  const startUrl = new URL(item.startPath, envMeta.baseUrl).toString();

  if (process.env.NODE_ENV === 'test') {
    await writeFile(outputPath, createTestSpec(startUrl), 'utf8');
    sessions.set(sessionId, { projectKey, caseKey, outputPath, createdAt: new Date().toISOString() });
    return { sessionId, url: startUrl };
  }

  await assertVendorBrowser();

  const args = [
    'playwright',
    'codegen',
    '--target',
    'playwright-test',
    '--output',
    outputPath,
    '--browser',
    'chromium',
    startUrl
  ];

  if (await hasProjectAuth(projectKey)) {
    // codegen 的最后一个参数必须是 URL，登录态参数插入到 URL 前面。
    args.splice(args.length - 1, 0, '--load-storage', getProjectAuthPath(projectKey));
  }

  const child = spawn('npx', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...getVendorEnv()
    },
    shell: true,
    stdio: 'ignore'
  });

  sessions.set(sessionId, {
    projectKey,
    caseKey,
    outputPath,
    child,
    createdAt: new Date().toISOString()
  });

  return { sessionId, url: startUrl };
}

/**
 * 停止录制并把录制步骤覆盖到当前用例。
 */
export async function stopRecordSession(projectKey: string, caseKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey || session.caseKey !== caseKey) {
    throw new Error('录制会话不存在或已结束');
  }

  if (session.child && !session.child.killed) {
    session.child.kill();
  }

  const item = await getCase(projectKey, caseKey);
  const code = await readFile(session.outputPath, 'utf8');
  const result = parseCodegenSpec(code);
  const nextItem: CaseMeta = {
    ...item,
    steps: result.steps
  };

  sessions.delete(sessionId);

  return updateCase(projectKey, caseKey, nextItem);
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
