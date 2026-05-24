import { join } from 'node:path';
import { createRun, updateRun } from '../lib/run-store';
import { getProjectPath, getRunPath } from '../lib/path';
import { listCases } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import type { CaseMeta, RunConfig, RunInput } from '../../../shared/types';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';
import { getAppConfig } from '../lib/app-config';
import { spawnPlaywrightCli, terminatePlaywrightChild } from './playwright-cli';
import { badRequest, notFound } from '../lib/http-error';
import { isReviewPassed } from './case-review';

interface RunProjectInput extends RunInput {
  storageState?: string;
  signal?: AbortSignal;
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
export async function runProject(projectKey: string, input: RunProjectInput = {}) {
  const project = await getProject(projectKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((item) => item.key === envKey);
  const files = await getProjectRunFiles(projectKey, input.caseKeys);

  if (!envMeta) {
    throw notFound('运行环境不存在');
  }

  if (files.length === 0) {
    throw badRequest('当前项目没有可运行用例');
  }

  const run = await createRun(projectKey, envKey);

  await assertVendorBrowser();

  const storageState = input.storageState ?? ((await hasProjectAuth(projectKey, envKey)) ? getProjectAuthPath(projectKey, envKey) : '');
  const runPath = getRunPath(projectKey, run.id);
  const reportPath = join(runPath, 'html-report');
  const reportUrl = createReportUrl(projectKey, run.id);
  const options = normalizeRunOptions(input);
  const env = {
    ...process.env,
    ...getVendorEnv(),
    PLAYWRIGHT_AUTO_PROJECT: projectKey,
    PLAYWRIGHT_AUTO_RUN: run.id,
    PLAYWRIGHT_AUTO_OUTPUT: runPath,
    PLAYWRIGHT_BASE_URL: envMeta.baseUrl,
    PLAYWRIGHT_STORAGE_STATE: storageState,
    PLAYWRIGHT_HEADLESS: options.mode === 'headless' ? 'true' : 'false'
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const child = spawnPlaywrightCli([
        'test',
        '--config',
        'playwright.config.ts',
        '--workers',
        String(options.workers),
        ...files
      ], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const abortRun = () => {
        terminatePlaywrightChild(child).catch(() => {});
        reject(new Error('测试运行已取消'));
      };

      if (input.signal?.aborted) {
        abortRun();
        return;
      }

      input.signal?.addEventListener('abort', abortRun, { once: true });

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('error', (error) => {
        input.signal?.removeEventListener('abort', abortRun);
        reject(error);
      });

      child.on('exit', (code) => {
        input.signal?.removeEventListener('abort', abortRun);

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
 * 归一化运行参数，避免前端异常输入直接影响 Playwright 并发。
 */
function normalizeRunOptions(input: RunProjectInput) {
  const config = getRunConfig();
  const mode = input.mode === 'headed' ? 'headed' : 'headless';
  const defaultWorkers = mode === 'headless' ? config.headlessWorkers : config.headedWorkers;
  const rawWorkers = Number(input.workers ?? defaultWorkers);
  // 并发过高会让本地浏览器和被测系统同时承压，这里限制在运行中心约定范围内。
  const workers = Number.isInteger(rawWorkers) && rawWorkers >= 1 && rawWorkers <= config.maxWorkers ? rawWorkers : defaultWorkers;

  return {
    mode,
    workers
  };
}

/**
 * 读取运行中心并发配置。
 */
export function getRunConfig(): RunConfig {
  const config = getAppConfig().runner;

  return {
    headlessWorkers: config.headlessWorkers,
    headedWorkers: config.headedWorkers,
    maxWorkers: config.maxWorkers
  };
}

/**
 * 获取 Playwright 运行时使用的项目内用例过滤参数。
 */
export async function getProjectRunFiles(projectKey: string, caseKeys?: string[]) {
  if (caseKeys && caseKeys.length === 0) {
    throw badRequest('请选择至少一条测试用例');
  }

  const cases = await listCases(projectKey);
  const selectedKeys = caseKeys ? new Set(caseKeys) : undefined;
  const selectedCases = selectedKeys ? cases.filter((item) => selectedKeys.has(item.key)) : cases;

  if (selectedKeys && selectedCases.length !== selectedKeys.size) {
    throw badRequest('选择的测试用例不存在或已被删除');
  }

  const runnableCases = selectedCases.filter(isRunnableCase);

  if (selectedKeys && runnableCases.length !== selectedCases.length) {
    throw badRequest('选择的测试用例未启用或基础检查不通过');
  }

  return runnableCases.map((item) => {
    const project = escapeRegExp(projectKey);
    const key = escapeRegExp(item.key);

    return `.*${project}.*cases.*${key}.*case\\.spec\\.ts`;
  });
}

/**
 * 判断用例是否允许进入运行中心。
 */
function isRunnableCase(item: CaseMeta) {
  return item.status === 'active' && isReviewPassed(item.review);
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
  const lines = stripAnsi(output)
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

  return error ? trimReason(error.replace(/^Error:\s*/, '')) : '';
}

/**
 * 清理终端颜色控制码，避免接口错误信息在页面上显示乱码。
 */
function stripAnsi(value: string) {
  // Playwright 失败输出会包含 ESC 开头的 ANSI SGR 颜色码，例如 \u001b[31m。
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * 截断过长的错误原因，并避免尾部留下半截单词。
 */
function trimReason(value: string) {
  const reason = value.trim();

  if (reason.length <= 80) {
    return reason;
  }

  return reason.slice(0, 80).trimEnd();
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
