import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase } from '../../server/src/lib/case-store';
import { createRun } from '../../server/src/lib/run-store';
import { getRunPath } from '../../server/src/lib/path';
import { getProjectPath } from '../../server/src/lib/path';
import { readJson, writeJson } from '../../server/src/lib/fs';
import type { ProjectMeta, RunMeta } from '../../shared/types';
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
  process.env.PLAYWRIGHT_AUTO_CONFIG = join(root, 'playwright-auto.config.json');
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  delete process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS;
  delete process.env.PLAYWRIGHT_AUTO_HEADED_WORKERS;
  delete process.env.PLAYWRIGHT_AUTO_MAX_WORKERS;
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

  it('未指定环境时兼容项目配置中的默认环境', async () => {
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
    await setProjectDefaultEnv('crm', 'pre');
    spawnMock.mockReturnValue({
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(0);
        }
      }
    });

    const run = await runProject('crm');

    expect(run.envKey).toBe('pre');
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PLAYWRIGHT_BASE_URL: 'https://pre.crm.test.local'
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

  it('只生成选中用例的 Playwright 过滤参数', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const first = await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    const second = await createCase('crm', {
      name: '查询订单',
      startPath: '/orders'
    });

    const files = await getProjectRunFiles('crm', [second.key]);

    expect(files).toEqual([`.*crm.*cases.*${second.key}.*case\\.spec\\.ts`]);
    expect(files[0]).not.toContain(first.key);
  });

  it('选择空用例列表时提示至少选择一条用例', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    await expect(getProjectRunFiles('crm', [])).rejects.toThrow('请选择至少一条测试用例');
  });

  it('选择不存在用例时提示用例不存在或已删除', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });

    await expect(getProjectRunFiles('crm', ['missing-case'])).rejects.toThrow('选择的测试用例不存在或已被删除');
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
      [
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
        '--workers',
        '4',
        `.*crm.*cases.*${item.key}.*case\\.spec\\.ts`
      ],
      expect.objectContaining({ cwd: process.cwd() })
    );
  });

  it('运行项目时按调试配置传入无头模式和并发数', async () => {
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

    await runProject('crm', {
      mode: 'headed',
      workers: 2
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
        '--workers',
        '2',
        `.*crm.*cases.*${item.key}.*case\\.spec\\.ts`
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          PLAYWRIGHT_HEADLESS: 'false'
        })
      })
    );
  });

  it('运行项目时从环境变量读取默认并发数和上限', async () => {
    process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS = '12';
    process.env.PLAYWRIGHT_AUTO_MAX_WORKERS = '16';
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

    await runProject('crm', {
      mode: 'headless'
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
        '--workers',
        '12',
        `.*crm.*cases.*${item.key}.*case\\.spec\\.ts`
      ],
      expect.any(Object)
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

  it('运行失败摘要会移除 Playwright 颜色控制码', async () => {
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
            callback(Buffer.from('    Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoBeVisible\u001b[2m(\u001b[22m\u001b[2m)\u001b[22m failed\n'));
          }
        }
      },
      stderr: {
        on() {}
      },
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(1);
        }
      }
    });

    await expect(runProject('crm')).rejects.toMatchObject({
      message: '用例“创建订单”在断言可见阶段失败：expect(locator).toBeVisible() failed'
    } satisfies Partial<RunError>);
  });
});

/**
 * 模拟历史项目配置中已经存在的默认环境。
 */
async function setProjectDefaultEnv(projectKey: string, envKey: string) {
  const path = join(getProjectPath(projectKey), 'project.json');
  const project = await readJson<ProjectMeta>(path);

  await writeJson(path, {
    ...project,
    defaultEnv: envKey
  });
}
