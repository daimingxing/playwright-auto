import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImportJob, listImportItems } from '../../server/src/lib/import-store';
import { addProjectEnv, createProject } from '../../server/src/lib/project-store';
import { setPageMapRunner } from '../../server/src/services/ai/page-context';
import { enqueueImportJob, processImportItem } from '../../server/src/services/import/import-worker';
import type { ImportCaseSource, ImportStepSource } from '../../shared/types';

let root = '';
let collectCount = 0;
let failUrl = '';
const authStats = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../server/src/lib/path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/lib/path')>();

  return {
    ...actual,
    getAuthHash: vi.fn(async (projectKey: string, envKey: string) => {
      authStats.count += 1;

      return actual.getAuthHash(projectKey, envKey);
    })
  };
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-worker-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  collectCount = 0;
  failUrl = '';
  authStats.count = 0;
  setPageMapRunner(async (input) => ({
    setDefaultTimeout() {},
    async open() {
      collectCount += 1;

      if (input.targetUrl === failUrl) {
        throw new Error('模拟页面不可访问');
      }
    },
    async snapshot(warnings) {
      return {
        page: {
          url: input.targetUrl,
          title: `页面${input.targetUrl}`,
          headings: [`页面${input.targetUrl}`]
        },
        elements: {
          buttons: [{ text: '新增', locator: "getByRole('button', { name: '新增' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [{ text: '系统管理', locator: "getByText('系统管理', { exact: true })", unique: true }],
          tables: []
        },
        warnings
      };
    },
    async action() {},
    async stable() {},
    async close() {}
  }));
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  setPageMapRunner(undefined);
  await rm(root, { recursive: true, force: true });
});

describe('导入 worker 页面地图分组', () => {
  it('同页面多条导入项只采集一次页面地图并写入同组信息', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-same-url',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/users')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);

    expect(collectCount).toBe(1);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === 'pendingReview')).toBe(true);
    expect(new Set(items.map((item) => item.groupId)).size).toBe(1);
    expect(items.map((item) => item.groupIndex)).toEqual([0, 1]);
    expect(items.every((item) => item.pageMapId === items[0].pageMapId)).toBe(true);
  });

  it('不同环境、不同登录态或不同 URL 不会误共用页面地图缓存', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const first = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-url',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/orders')]
    });

    await enqueueImportJob('crm', first.importId);
    const firstItems = await waitItems('crm', first.importId, ['pendingReview', 'failed']);

    await addProjectEnv('crm', {
      name: '测试环境',
      key: 'test',
      baseUrl: 'https://crm-test.local'
    });
    const envJob = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-env',
      envKey: 'test',
      cases: [createCase('TC003', '/users')]
    });

    await enqueueImportJob('crm', envJob.importId);
    const envItems = await waitItems('crm', envJob.importId, ['pendingReview', 'failed']);

    await writeFile(join(root, 'projects', 'crm', 'auth', 'default.storageState.json'), '{"cookies":[{"name":"sid","value":"1"}]}');
    const second = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-auth',
      envKey: 'default',
      cases: [createCase('TC004', '/users')]
    });

    await enqueueImportJob('crm', second.importId);
    const secondItems = await waitItems('crm', second.importId, ['pendingReview', 'failed']);

    expect(collectCount).toBe(4);
    expect(firstItems[0].pageMapId).not.toBe(firstItems[1].pageMapId);
    expect(envItems[0].pageMapId).not.toBe(firstItems[0].pageMapId);
    expect(secondItems[0].pageMapId).not.toBe(firstItems[0].pageMapId);
  });

  it('同一任务多 URL 分组只读取一次登录态 hash 且仍按 URL 分组', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-multi-url',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/orders'), createCase('TC003', '/reports')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);

    expect(authStats.count).toBe(1);
    expect(collectCount).toBe(3);
    expect(items.every((item) => item.status === 'pendingReview')).toBe(true);
    expect(new Set(items.map((item) => item.groupId)).size).toBe(3);
    expect(new Set(items.map((item) => item.pageMapId)).size).toBe(3);
  });

  it('页面地图失败时同组项失败且其他组继续生成', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    failUrl = '/missing';
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-failed-group',
      envKey: 'default',
      cases: [createCase('TC001', '/missing'), createCase('TC002', '/missing'), createCase('TC003', '/users')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);
    const failed = items.filter((item) => item.source.caseInfo.targetUrl === '/missing');
    const success = items.find((item) => item.source.caseInfo.targetUrl === '/users');

    expect(failed).toHaveLength(2);
    expect(failed.every((item) => item.status === 'failed')).toBe(true);
    expect(new Set(failed.map((item) => item.errorMessage)).size).toBe(1);
    expect(failed[0].errorMessage).toContain('页面地图生成失败');
    expect(success?.status).toBe('pendingReview');
  });

  it('页面地图失败后手动重试会重新采集并生成草稿', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    failUrl = '/missing';
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-retry-after-map-failed',
      envKey: 'default',
      cases: [createCase('TC001', '/missing'), createCase('TC002', '/missing'), createCase('TC003', '/users')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);
    const failed = items.filter((item) => item.source.caseInfo.targetUrl === '/missing');

    expect(failed).toHaveLength(2);
    expect(failed.every((item) => item.status === 'failed')).toBe(true);
    expect(new Set(failed.map((item) => item.groupId)).size).toBe(1);
    expect(failed.map((item) => item.groupIndex)).toEqual([0, 1]);
    expect(failed.every((item) => item.pageMapId === undefined)).toBe(true);

    failUrl = '';
    await processImportItem('crm', job.importId, failed[0].itemId);
    const retryItems = await listImportItems('crm', job.importId);
    const retried = retryItems.find((item) => item.itemId === failed[0].itemId);
    const sameGroupFailed = retryItems.find((item) => item.itemId === failed[1].itemId);
    const success = retryItems.find((item) => item.source.caseInfo.targetUrl === '/users');

    expect(collectCount).toBe(2);
    expect(retried?.status).toBe('pendingReview');
    expect(retried?.pageMapId).toBeUndefined();
    expect(sameGroupFailed?.status).toBe('failed');
    expect(sameGroupFailed?.pageMapId).toBeUndefined();
    expect(success?.status).toBe('pendingReview');
  });
});

/**
 * 等待后台导入项都进入终态，避免队列异步写入和断言抢跑。
 */
async function waitItems(projectKey: string, importId: string, doneStatus: Array<'pendingReview' | 'failed'>) {
  for (let index = 0; index < 20; index += 1) {
    const items = await listImportItems(projectKey, importId);

    if (items.length > 0 && items.every((item) => doneStatus.includes(item.status as 'pendingReview' | 'failed'))) {
      return items;
    }

    // worker 使用进程内后台队列，测试只需短轮询等待异步任务落盘。
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return listImportItems(projectKey, importId);
}

/**
 * 创建带安全探索动作的导入源，确保页面地图路径会走多状态采集器。
 */
function createCase(caseNo: string, targetUrl: string) {
  const caseInfo: ImportCaseSource = {
    caseNo,
    caseName: `${caseNo} 用例`,
    targetUrl,
    precondition: '已登录管理员账号',
    expectedResult: '操作成功',
    note: ''
  };
  const steps: ImportStepSource[] = [
    {
      caseNo,
      stepNo: 1,
      actionType: 'click',
      targetType: 'menu',
      targetName: '系统管理',
      actionText: '点击系统管理',
      targetText: '系统管理菜单',
      dataKeys: [],
      note: ''
    }
  ];

  return {
    caseInfo,
    steps,
    data: [],
    rowRefs: {
      caseRow: Number(caseNo.replace('TC', '')),
      stepRows: [1],
      dataRows: []
    }
  };
}
