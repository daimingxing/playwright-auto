import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRun, updateRun } from '../lib/run-store';
import { getProjectPath, getRunPath } from '../lib/path';
import { listCases } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';

interface RunInput {
  envKey?: string;
  storageState?: string;
}

export class RunError extends Error {
  reportPath: string;
  reportUrl: string;

  /**
   * 创建带报告入口的测试运行错误。
   */
  constructor(message: string, reportPath: string, reportUrl: string) {
    super(message);
    this.name = 'RunError';
    this.reportPath = reportPath;
    this.reportUrl = reportUrl;
  }
}

/**
 * 按项目运行当前可用测试用例。
 */
export async function runProject(projectKey: string, input: RunInput = {}) {
  const project = await getProject(projectKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((item) => item.key === envKey);
  const files = await getProjectRunFiles(projectKey);

  if (!envMeta) {
    throw new Error('运行环境不存在');
  }

  if (files.length === 0) {
    throw new Error('当前项目没有可运行用例');
  }

  const run = await createRun(projectKey, envKey);

  await assertVendorBrowser();

  const storageState = input.storageState ?? ((await hasProjectAuth(projectKey, envKey)) ? getProjectAuthPath(projectKey, envKey) : '');
  const runPath = getRunPath(projectKey, run.id);
  const reportPath = join(runPath, 'html-report');
  const reportUrl = createReportUrl(projectKey, run.id);
  const env = {
    ...process.env,
    ...getVendorEnv(),
    PLAYWRIGHT_AUTO_PROJECT: projectKey,
    PLAYWRIGHT_AUTO_RUN: run.id,
    PLAYWRIGHT_AUTO_OUTPUT: runPath,
    PLAYWRIGHT_BASE_URL: envMeta.baseUrl,
    PLAYWRIGHT_STORAGE_STATE: storageState,
    PLAYWRIGHT_HEADLESS: 'false'
  };

  try {
    await new Promise<void>((resolve, reject) => {
    let output = '';
    const child = spawn('npx', ['playwright', 'test', '--config', 'playwright.config.ts', ...files], {
      cwd: process.cwd(),
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new RunError(createRunErrorMessage(code, output), reportPath, reportUrl));
    });
    });
  } catch (error) {
    await updateRun(projectKey, run.id, { status: 'failed' });
    throw error;
  }

  const nextRun = await updateRun(projectKey, run.id, { status: 'passed' });

  return {
    ...nextRun,
    reportPath: join(getProjectPath(projectKey), 'runs', run.id, 'html-report'),
    reportUrl
  };
}

/**
 * 获取 Playwright 运行时使用的项目内用例过滤参数。
 */
export async function getProjectRunFiles(projectKey: string) {
  const cases = await listCases(projectKey);

  return cases.map((item) => {
    const project = escapeRegExp(projectKey);
    const key = escapeRegExp(item.key);

    return `.*${project}.*cases.*${key}.*case\\.spec\\.ts`;
  });
}

/**
 * 生成面向测试人员的运行失败错误信息。
 */
function createRunErrorMessage(code: number | null, output: string) {
  return summarizeOutput(output, code);
}

/**
 * 从 Playwright 输出中提取测试人员可读的失败摘要。
 */
function summarizeOutput(output: string, code: number | null) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const caseName = findCaseName(lines);
  const phase = findFailedPhase(lines);
  const reason = findFailedReason(lines);

  if (caseName && phase && reason) {
    return `用例“${caseName}”在${phase}失败：${reason}`;
  }

  if (caseName && phase) {
    return `用例“${caseName}”在${phase}失败`;
  }

  if (caseName) {
    return `用例“${caseName}”运行失败`;
  }

  return `测试运行失败，退出码：${code ?? '未知'}`;
}

/**
 * 从 Playwright 失败标题中提取用例名称。
 */
function findCaseName(lines: string[]) {
  const line = lines.find((item) => item.includes('›'));

  if (!line) {
    return '';
  }

  const segments = line.split('›').map((item) => item.trim()).filter(Boolean);

  return segments.at(-1)?.replace(/\s+\(\d+(\.\d+)?[a-z]+\)$/i, '') ?? '';
}

/**
 * 根据 Playwright matcher 信息推断失败阶段。
 */
function findFailedPhase(lines: string[]) {
  const text = lines.join(' ');

  if (text.includes('toBeVisible')) {
    return '断言可见阶段';
  }

  if (text.includes('toHaveText') || text.includes('toContainText')) {
    return '断言文本阶段';
  }

  if (text.includes('toHaveValue')) {
    return '断言取值阶段';
  }

  if (text.includes('toHaveURL')) {
    return '断言地址阶段';
  }

  if (text.includes('toHaveTitle')) {
    return '断言标题阶段';
  }

  if (text.includes('.click:') || text.includes('locator.click')) {
    return '点击操作阶段';
  }

  if (text.includes('.fill:') || text.includes('locator.fill')) {
    return '填写操作阶段';
  }

  if (text.includes('page.goto')) {
    return '打开页面阶段';
  }

  return '运行阶段';
}

/**
 * 把常见 Playwright 错误转成简短原因。
 */
function findFailedReason(lines: string[]) {
  const text = lines.join(' ');
  const timeout = text.match(/Timeout\s+(\d+)ms\s+exceeded/i);

  if (text.includes('toBeVisible') && timeout) {
    return `元素在 ${timeout[1]}ms 内没有变为可见`;
  }

  if (timeout) {
    return `等待超过 ${timeout[1]}ms`;
  }

  const error = lines.find((line) => line.startsWith('Error:'));

  return error?.replace(/^Error:\s*/, '').slice(0, 80) ?? '';
}

/**
 * 转义 Playwright 测试过滤正则中的特殊字符。
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成前端可打开的报告地址。
 */
function createReportUrl(projectKey: string, runId: string) {
  return `/api/projects/${encodeURIComponent(projectKey)}/runs/${encodeURIComponent(runId)}/report/`;
}
