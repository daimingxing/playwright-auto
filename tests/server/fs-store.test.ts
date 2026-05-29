import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCase,
  deleteCase,
  getCase,
  listCases,
  listTrash,
  removeTrashCase,
  restoreTrashCase
} from '../../server/src/lib/case-store';
import { createProject, getProject } from '../../server/src/lib/project-store';
import { createRun } from '../../server/src/lib/run-store';
import { writeJson } from '../../server/src/lib/fs';
import { getTrashPath } from '../../server/src/lib/path';

let root = '';
const caseKeyPattern = /^case-\d{8}-\d{6}-[a-f0-9]{4}$/;

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

    expect(item.key).toMatch(caseKeyPattern);
    expect(await listCases('crm')).toHaveLength(1);

    await deleteCase('crm', item.key);

    expect(await listCases('crm')).toHaveLength(0);
  });

  it('创建用例时生成不复用的时间随机标识', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const first = await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });

    await deleteCase('crm', first.key);
    const second = await createCase('crm', {
      name: '查询订单',
      startPath: '/orders'
    });

    expect(second.key).toMatch(caseKeyPattern);
    expect(second.key).not.toBe(first.key);
    expect((await listTrash('crm')).map((item) => item.key)).toEqual([first.key]);
  });

  it('可以恢复回收站用例并彻底删除回收站用例', async () => {
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

    await deleteCase('crm', first.key);
    await deleteCase('crm', second.key);
    await restoreTrashCase('crm', first.key);
    await removeTrashCase('crm', second.key);

    expect((await listCases('crm')).map((item) => item.key)).toEqual([first.key]);
    expect(await listTrash('crm')).toHaveLength(0);
  });

  it('恢复旧编号用例时保留原有目录编号', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await writeJson(join(getTrashPath('crm', 'case-1'), 'case.json'), {
      name: '创建订单',
      key: 'case-1',
      startPath: '/orders/create',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const restored = await restoreTrashCase('crm', 'case-1');

    expect(restored.key).toBe('case-1');
    expect((await listCases('crm')).map((item) => item.key)).toEqual(['case-1']);
    expect(await listTrash('crm')).toHaveLength(0);
  });

  it('删除用例时在全局用例命名空间中避开回收站同名目录', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const oldCase = {
      name: '历史用例',
      key: 'case-1',
      startPath: '/orders/create',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await writeJson(join(getTrashPath('crm', 'case-1'), 'case.json'), oldCase);
    await writeJson(join(root, 'projects', 'crm', 'cases', 'case-1', 'case.json'), oldCase);

    await deleteCase('crm', 'case-1');

    expect((await listCases('crm')).map((item) => item.key)).toEqual([]);
    expect(await readdir(join(root, 'projects', 'crm', 'trash'))).toEqual(['case-1', 'case-1-1']);
    expect((await listTrash('crm')).map((item) => item.key)).toEqual(['case-1', 'case-1-1']);

    const restored = await restoreTrashCase('crm', 'case-1-1');

    expect(restored.key).toBe('case-1-1');
    expect((await listCases('crm')).map((item) => item.key)).toEqual(['case-1-1']);
  });

  it('恢复回收站用例时在全局用例命名空间中避开可用用例同名目录', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const oldCase = {
      name: '历史用例',
      key: 'case-1',
      startPath: '/orders/create',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await writeJson(join(root, 'projects', 'crm', 'cases', 'case-1', 'case.json'), oldCase);
    await writeJson(join(getTrashPath('crm', 'case-1'), 'case.json'), oldCase);

    const restored = await restoreTrashCase('crm', 'case-1');

    expect(restored.key).toBe('case-1-1');
    expect(await readdir(join(root, 'projects', 'crm', 'cases'))).toEqual(['case-1', 'case-1-1']);
    expect((await listCases('crm')).map((item) => item.key)).toEqual(['case-1', 'case-1-1']);
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

  it('读取历史用例时返回兼容视图但不改写原始文件', async () => {
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const casePath = join(root, 'projects', 'crm', 'cases', 'case-old', 'case.json');
    await writeJson(casePath, {
      name: '历史用例',
      key: 'case-old',
      status: 'unknown',
      startPath: '/orders',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')"
        }
      ],
      createdAt: '2026-05-29T00:00:00.000Z',
      updatedAt: '2026-05-29T00:00:00.000Z'
    });
    const before = await readFile(casePath, 'utf8');

    const items = await listCases('crm');
    const detail = await getCase('crm', 'case-old');
    const after = await readFile(casePath, 'utf8');

    expect(items[0]).toMatchObject({
      key: 'case-old',
      status: 'draft',
      review: {
        summary: {
          error: 1
        }
      }
    });
    expect(detail.review?.items[0]?.ruleCode).toBe('dynamic-id');
    expect(after).toBe(before);
  });
});
