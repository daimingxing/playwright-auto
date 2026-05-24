import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CaseMeta,
  PracticalFailureAnalysis,
  PracticalReviewRecord,
  RunMode,
  PracticalStepReview
} from '../../../shared/types';
import { buildStartUrl } from '../../../shared/url';
import { getCase } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import {
  cleanupPracticalReviews,
  createCaseSnapshotHash,
  createPracticalReviewId,
  savePracticalReviewRecord,
  updateLatestPracticalReview
} from '../lib/practical-review-store';
import { getPracticalReviewWorkPath } from '../lib/path';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { generatePracticalReviewSpec } from './practical-review-spec';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';
import { spawnPlaywrightCli } from './playwright-cli';
import { notFound } from '../lib/http-error';

interface PracticalReviewInput {
  envKey?: string;
  mode?: RunMode;
  testFailure?: {
    stepId: string;
    code: PracticalFailureAnalysis['code'];
    message: string;
    suggestion: string;
  };
}

/**
 * 执行单个用例的实测检查。
 */
export async function runPracticalReview(projectKey: string, caseKey: string, input: PracticalReviewInput = {}) {
  const project = await getProject(projectKey);
  const item = await getCase(projectKey, caseKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const env = project.envs.find((row) => row.key === envKey);

  if (!env) {
    throw notFound('实测检查环境不存在');
  }

  const startedAt = new Date().toISOString();
  const hash = createCaseSnapshotHash(item, envKey, env.baseUrl);
  const steps =
    process.env.NODE_ENV === 'test'
      ? createTestStepResults(item, input.testFailure)
      : await runBrowserReview(projectKey, item, envKey, env.baseUrl, input.mode ?? 'headless');
  const failedStep = steps.find((step) => step.status === 'failed');
  const finishedAt = new Date().toISOString();
  const status: PracticalReviewRecord['status'] = failedStep ? 'failed' : 'passed';
  const reviewId = createPracticalReviewId();
  const record: PracticalReviewRecord = {
    id: reviewId,
    projectKey,
    caseKey,
    envKey,
    envBaseUrl: env.baseUrl,
    status,
    caseSnapshotHash: hash,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    steps,
    artifacts: failedStep?.analysis?.artifacts ?? [],
    summary: {
      status,
      envKey,
      envBaseUrl: env.baseUrl,
      caseSnapshotHash: hash,
      stepCount: item.steps.length,
      reviewId,
      checkedAt: finishedAt,
      failedStepId: failedStep?.stepId,
      failedStepIndex: failedStep?.stepIndex,
      failureMessage: failedStep?.analysis?.message
    }
  };

  await savePracticalReviewRecord(projectKey, record);
  await updateLatestPracticalReview(projectKey, caseKey, record.summary);
  await cleanupPracticalReviews(projectKey);

  return record;
}

function createTestStepResults(item: CaseMeta, failure: PracticalReviewInput['testFailure']): PracticalStepReview[] {
  return item.steps.map((step, index) => {
    const startedAt = new Date().toISOString();
    const isFailed = failure?.stepId === step.id;
    const finishedAt = new Date().toISOString();

    return {
      stepId: step.id,
      stepIndex: index,
      stepType: step.type,
      selector: step.selector,
      status: isFailed ? 'failed' : failure ? 'skipped' : 'passed',
      startedAt,
      finishedAt,
      durationMs: 0,
      analysis: isFailed
        ? {
            code: failure.code,
            message: failure.message,
            suggestion: failure.suggestion,
            selector: step.selector,
            matchCount: failure.code === 'no-match' ? 0 : undefined
          }
        : undefined
    };
  });
}

async function runBrowserReview(
  projectKey: string,
  item: CaseMeta,
  envKey: string,
  envBaseUrl: string,
  mode: RunMode
): Promise<PracticalStepReview[]> {
  await assertVendorBrowser();

  const workDir = getPracticalReviewWorkPath(projectKey, randomUUID());
  const specDir = join(workDir, 'cases');
  const specPath = join(specDir, 'practical-review.spec.ts');
  const resultPath = join(workDir, 'review-result.json');
  const screenshotDir = join(workDir, 'screenshots');
  const startUrl = buildStartUrl(envBaseUrl, item.startPath);

  await mkdir(specDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  await writeFile(
    specPath,
    generatePracticalReviewSpec({
      startUrl,
      resultPath,
      screenshotDir,
      steps: item.steps
    }),
    'utf8'
  );

  const storageState = (await hasProjectAuth(projectKey, envKey)) ? getProjectAuthPath(projectKey, envKey) : '';
  const output = await runReviewProcess(specDir, join(workDir, 'playwright-output'), storageState, mode);

  try {
    if (!existsSync(resultPath)) {
      throw new Error(`实测检查未生成结果文件：${output || 'Playwright 未返回输出'}`);
    }

    const data = await readReviewResult(resultPath);

    return data.steps;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * 读取并解析实测检查结果文件。
 */
async function readReviewResult(resultPath: string) {
  try {
    return JSON.parse(await readFile(resultPath, 'utf8')) as { steps: PracticalStepReview[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`实测检查结果文件格式错误：${message}`);
  }
}

async function runReviewProcess(testDir: string, outputDir: string, storageState: string, mode: RunMode) {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    const reviewEnv = {
      ...process.env,
      ...getVendorEnv(),
      PLAYWRIGHT_TEST_DIR: testDir,
      PLAYWRIGHT_TEST_MATCH: 'practical-review.spec.ts',
      PLAYWRIGHT_AUTO_OUTPUT: outputDir,
      // Playwright 配置只读取字符串环境变量，headed 模式需要显式写 false。
      PLAYWRIGHT_HEADLESS: mode === 'headless' ? 'true' : 'false',
      ...(storageState ? { PLAYWRIGHT_STORAGE_STATE: storageState } : {})
    };
    const child = spawnPlaywrightCli(['test', '--config', 'playwright.config.ts'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: reviewEnv
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });
    child.on('exit', (code) => {
      if (code === 0 || code === 1) {
        resolve(output);
        return;
      }

      reject(new Error(output || `实测检查进程退出：${code}`));
    });
  });
}
