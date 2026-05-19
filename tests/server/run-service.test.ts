import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../server/src/lib/project-store';
import { createAuthState, getProjectAuthPath, hasProjectAuth } from '../../server/src/services/auth-session';
import { createRun } from '../../server/src/lib/run-store';
import { exportRun } from '../../server/src/services/export';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-run-'));
  process.env.DATA_ROOT = root;
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
});
