import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRun } from '../lib/run-store';
import { getCasePath, getProjectPath, getRunPath } from '../lib/path';
import { listCases } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';

interface RunInput {
  envKey?: string;
  storageState?: string;
}

/**
 * 按项目运行当前可用测试用例。
 */
export async function runProject(projectKey: string, input: RunInput = {}) {
  const run = await createRun(projectKey, input.envKey ?? 'default');
  const project = await getProject(projectKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((item) => item.key === envKey);
  const cases = await listCases(projectKey);
  const files = cases.map((item) => join(getCasePath(projectKey, item.key), 'case.spec.ts'));

  if (!envMeta) {
    throw new Error('运行环境不存在');
  }

  if (files.length === 0) {
    throw new Error('当前项目没有可运行用例');
  }

  const storageState = input.storageState ?? ((await hasProjectAuth(projectKey)) ? getProjectAuthPath(projectKey) : '');
  const env = {
    ...process.env,
    PLAYWRIGHT_AUTO_PROJECT: projectKey,
    PLAYWRIGHT_AUTO_RUN: run.id,
    PLAYWRIGHT_AUTO_OUTPUT: getRunPath(projectKey, run.id),
    PLAYWRIGHT_BASE_URL: envMeta.baseUrl,
    PLAYWRIGHT_STORAGE_STATE: storageState,
    PLAYWRIGHT_HEADLESS: 'false'
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'test', ...files], {
      cwd: process.cwd(),
      env,
      shell: true,
      stdio: 'inherit'
    });

    child.on('exit', (code) => {
      // Playwright 非 0 退出码表示测试失败，需要把失败传回调用方。
      code === 0 ? resolve() : reject(new Error(`测试运行失败，退出码：${code}`));
    });
  });

  return {
    ...run,
    reportPath: join(getProjectPath(projectKey), 'runs', run.id, 'html-report')
  };
}
