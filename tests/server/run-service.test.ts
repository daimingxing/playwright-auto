import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase } from '../../server/src/lib/case-store';
import { createRun } from '../../server/src/lib/run-store';
import { getRunPath } from '../../server/src/lib/path';
import { readJson } from '../../server/src/lib/fs';
import type { RunMeta } from '../../shared/types';
import { addProjectEnv, createProject } from '../../server/src/lib/project-store';
import { createAuthState, getProjectAuthPath, hasProjectAuth } from '../../server/src/services/auth-session';
import { exportRun } from '../../server/src/services/export';
import { getProjectRunFiles, RunError, runProject } from '../../server/src/services/runner';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-run-'));
  process.env.DATA_ROOT = root;
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('运行服务', () => {
  it('创建临时登录态文件并导出运行产物', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const auth = await createAuthState('crm', {
      cookies: [],
      origins: []
    });
    const run = await createRun('crm', 'default');
    const zipPath = await exportRun('crm', run.id);
    const info = await stat(zipPath);

    expect(auth.path).toContain('storageState.json');
    expect(info.size).toBeGreaterThan(0);
  });

  it('项目级登录态保存后可以被运行服务复用', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const auth = await createAuthState('crm', {
      cookies: [],
      origins: []
    });

    expect(auth.path).toBe(getProjectAuthPath('crm'));
    expect(await hasProjectAuth('crm')).toBe(true);
  });

  it('运行指定环境时复用对应环境的登录态', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    await addProjectEnv('crm', {
      name: '预发环境',
      key: 'pre',
      baseUrl: 'https://pre.crm.test.local'
    });
    await createAuthState('crm', {
      cookies: [],
      origins: []
    }, 'pre');
    spawnMock.mockReturnValue({
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(0);
        }
      }
    });

    await runProject('crm', { envKey: 'pre' });

    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PLAYWRIGHT_STORAGE_STATE: getProjectAuthPath('crm', 'pre')
        })
      })
    );
  });

  it('生成匹配项目用例文件的 Playwright 过滤参数', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const item = await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });

    const files = await getProjectRunFiles('crm');

    expect(files).toEqual([`.*crm.*cases.*${item.key}.*case\\.spec\\.ts`]);
  });

  it('运行项目时显式传入 Playwright 配置文件', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const item = await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    spawnMock.mockReturnValue({
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(0);
        }
      }
    });

    await runProject('crm');

    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      ['playwright', 'test', '--config', 'playwright.config.ts', `.*crm.*cases.*${item.key}.*case\\.spec\\.ts`],
      expect.objectContaining({ cwd: process.cwd() })
    );
  });

  it('运行成功时返回可直接打开的报告地址', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    spawnMock.mockReturnValue({
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(0);
        }
      }
    });

    const run = await runProject('crm');
    const stored = await readJson<RunMeta>(join(getRunPath('crm', run.id), 'run.json'));

    expect(run.reportUrl).toBe(`/api/projects/crm/runs/${run.id}/report/`);
    expect(stored.status).toBe('passed');
  });

  it('运行失败时返回用例和阶段摘要以及报告地址', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    spawnMock.mockReturnValue({
      stdout: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('  1) [chromium] › data\\projects\\crm\\cases\\case-1\\case.spec.ts:3:1 › 创建订单\n'));
            callback(Buffer.from('    Error: expect(locator).toBeVisible failed\n'));
          }
        }
      },
      stderr: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('Timeout 1000ms exceeded\n'));
          }
        }
      },
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(1);
        }
      }
    });

    await expect(runProject('crm')).rejects.toMatchObject({
      message: '用例“创建订单”在断言可见阶段失败：元素在 1000ms 内没有变为可见',
      reportUrl: expect.stringMatching(/^\/api\/projects\/crm\/runs\/\d+\/report\/$/)
    } satisfies Partial<RunError>);

    const runsRoot = join(root, 'projects', 'crm', 'runs');
    const runIds = await import('node:fs/promises').then(({ readdir }) => readdir(runsRoot));
    const stored = await readJson<RunMeta>(join(runsRoot, runIds[0], 'run.json'));
    expect(stored.status).toBe('failed');
  });
});
