import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMeta } from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { getProjectPath, getRunPath } from './path';

let lastRunTime = 0;
let runSeed = 0;
const runIdPattern = /^(\d{14}|\d{17})$/;

/**
 * 创建一次测试运行记录。
 */
export async function createRun(projectKey: string, envKey: string) {
  const id = createRunId();
  const runPath = getRunPath(projectKey, id);
  const now = new Date().toISOString();
  const run: RunMeta = {
    id,
    projectKey,
    envKey,
    status: 'created',
    reportPath: join(runPath, 'html-report'),
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(join(runPath, 'html-report'));
  await ensureDir(join(runPath, 'test-results'));
  await ensureDir(join(runPath, 'auth'));
  await writeJson(join(runPath, 'run.json'), run);

  return run;
}

/**
 * 更新一次测试运行记录。
 */
export async function updateRun(projectKey: string, runId: string, input: Partial<Pick<RunMeta, 'status'>>) {
  assertRunId(runId);

  const runPath = getRunPath(projectKey, runId);
  const current = await readJson<RunMeta>(join(runPath, 'run.json'));
  const nextRun: RunMeta = {
    ...current,
    ...input,
    updatedAt: new Date().toISOString()
  };

  await writeJson(join(runPath, 'run.json'), nextRun);

  return nextRun;
}

/**
 * 读取项目下的测试运行记录。
 */
export async function listRuns(projectKey: string) {
  const runsPath = join(getProjectPath(projectKey), 'runs');
  const names = await readdir(runsPath).catch(() => []);
  const runs: Array<RunMeta | null> = await Promise.all(
    names.map(async (name) => {
      try {
        const run = await readJson<RunMeta>(join(runsPath, name, 'run.json'));

        return {
          ...run,
          reportUrl: createReportUrl(projectKey, run.id)
        };
      } catch {
        return null;
      }
    })
  );

  return runs
    .filter((item): item is RunMeta => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}

/**
 * 删除单次测试运行目录。
 */
export async function deleteRun(projectKey: string, runId: string) {
  assertRunId(runId);
  await rm(getRunPath(projectKey, runId), { recursive: true, force: false });
}

/**
 * 生成运行编号。
 */
function createRunId() {
  const now = Date.now();

  if (now === lastRunTime) {
    runSeed += 1;
  } else {
    lastRunTime = now;
    runSeed = 0;
  }

  // 同一毫秒内连续运行时追加序号，避免报告目录互相覆盖。
  return `${now}${String(runSeed).padStart(4, '0')}`;
}

/**
 * 校验运行编号，避免异常路径进入文件系统操作。
 */
function assertRunId(runId: string) {
  if (!runIdPattern.test(runId)) {
    throw new Error('运行编号不合法');
  }
}

/**
 * 生成前端可打开的报告地址。
 */
function createReportUrl(projectKey: string, runId: string) {
  return `/api/projects/${encodeURIComponent(projectKey)}/runs/${encodeURIComponent(runId)}/report/`;
}
