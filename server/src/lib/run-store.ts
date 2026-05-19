import { join } from 'node:path';
import type { RunMeta } from '../../../shared/types';
import { ensureDir, writeJson } from './fs';
import { getRunPath } from './path';

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
 * 生成运行编号。
 */
function createRunId() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}
