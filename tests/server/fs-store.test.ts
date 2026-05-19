import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCase, deleteCase, listCases } from '../../server/src/lib/case-store';
import { createProject, getProject } from '../../server/src/lib/project-store';
import { createRun } from '../../server/src/lib/run-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('文件存储', () => {
  it('创建项目时写入项目配置和固定目录', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const project = await getProject('crm');

    expect(project.name).toBe('CRM 系统');
    expect(project.envs[0]?.baseUrl).toBe('https://crm.test.local');
  });

  it('创建用例后可以读取，并能移动到回收站', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const item = await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });

    expect(item.key).toBe('case-1');
    expect(await listCases('crm')).toHaveLength(1);

    await deleteCase('crm', item.key);

    expect(await listCases('crm')).toHaveLength(0);
  });

  it('创建运行记录时生成运行目录', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const run = await createRun('crm', 'default');

    expect(run.projectKey).toBe('crm');
    expect(run.envKey).toBe('default');
    expect(run.reportPath).toContain(run.id);
  });
});
