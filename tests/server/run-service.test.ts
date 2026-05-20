import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase } from '../../server/src/lib/case-store';
import { createRun } from '../../server/src/lib/run-store';
import { createProject } from '../../server/src/lib/project-store';
import { createAuthState, getProjectAuthPath, hasProjectAuth } from '../../server/src/services/auth-session';
import { exportRun } from '../../server/src/services/export';
import { getProjectRunFiles, runProject } from '../../server/src/services/runner';

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
});
