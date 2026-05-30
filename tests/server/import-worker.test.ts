import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImportJob, listImportItems, updateImportItem } from '../../server/src/lib/import-store';
import { listPageMaps } from '../../server/src/lib/page-map-store';
import { addProjectEnv, createProject } from '../../server/src/lib/project-store';
import { readPageMap } from '../../server/src/lib/page-map-store';
import { setPageMapRunner } from '../../server/src/services/ai/page-context';
import { enqueueImportJob, processImportItem } from '../../server/src/services/import/import-worker';
import type { AiDebugInfo, AiCaseDraft, ImportCaseSource, ImportStepSource } from '../../shared/types';

interface MockGroupItem {
  caseNo: string;
  draft?: AiCaseDraft;
  error?: string;
}

let root = '';
let collectCount = 0;
let failUrl = '';
const authStats = vi.hoisted(() => ({ count: 0 }));
const draftStats = vi.hoisted(() => ({
  groupSizes: [] as number[],
  singleCaseNos: [] as string[],
  failGroupSizes: [] as number[],
  failSingleCaseNos: [] as string[],
  groupItems: undefined as MockGroupItem[] | undefined,
  groupErrors: [] as string[]
}));

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

vi.mock('../../server/src/services/ai/ai-case-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/ai/ai-case-draft')>();

  return {
    ...actual,
    generateCaseDraftGroup: vi.fn(async (input: Parameters<typeof actual.generateCaseDraftGroup>[0]) => {
      draftStats.groupSizes.push(input.cases.length);

      if (draftStats.failGroupSizes.includes(input.cases.length)) {
        throw new Error(`模拟分组失败 ${input.cases.length}`);
      }

      return {
        items: draftStats.groupItems ?? input.cases.map((item) => ({
          caseNo: item.caseInfo.caseNo,
          draft: createMockDraft(item.caseInfo.caseNo, item.caseInfo.targetUrl)
        })),
        groupErrors: draftStats.groupErrors,
        aiDebug: {
          system: '测试分组系统提示词',
          user: '测试分组用户输入',
          response: '测试分组响应',
          parsed: {},
          updatedAt: new Date().toISOString()
        }
      };
    }),
    generateCaseDraft: vi.fn(async (input: Parameters<typeof actual.generateCaseDraft>[0]) => {
      draftStats.singleCaseNos.push(input.caseInfo.caseNo);

      if (draftStats.failSingleCaseNos.includes(input.caseInfo.caseNo)) {
        throw new Error(`模拟单条失败 ${input.caseInfo.caseNo}`);
      }

      return {
        draft: createMockDraft(input.caseInfo.caseNo, input.caseInfo.targetUrl),
        aiDebug: {
          system: '测试单条系统提示词',
          user: '测试单条用户输入',
          response: '测试单条响应',
          parsed: {},
          updatedAt: new Date().toISOString()
        }
      };
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
  draftStats.groupSizes = [];
  draftStats.singleCaseNos = [];
  draftStats.failGroupSizes = [];
  draftStats.failSingleCaseNos = [];
  draftStats.groupItems = undefined;
  draftStats.groupErrors = [];
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

  it('控件库不同的导入任务不会误共用页面地图缓存', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const first = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-auto-ui',
      envKey: 'default',
      uiLibrary: 'auto',
      cases: [createCase('TC001', '/users')]
    });

    await enqueueImportJob('crm', first.importId);
    const firstItems = await waitItems('crm', first.importId, ['pendingReview', 'failed']);
    const second = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-kendo-ui',
      envKey: 'default',
      uiLibrary: 'kendo',
      cases: [createCase('TC002', '/users')]
    });

    await enqueueImportJob('crm', second.importId);
    const secondItems = await waitItems('crm', second.importId, ['pendingReview', 'failed']);

    expect(collectCount).toBe(2);
    expect(firstItems[0].pageMapId).not.toBe(secondItems[0].pageMapId);
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

    expect(collectCount).toBe(3);
    expect(retried?.status).toBe('pendingReview');
    expect(retried?.pageMapId).toMatch(/^pm-/);
    expect(retried?.pageMapId).not.toBe(failed[0].groupId);
    expect(sameGroupFailed?.status).toBe('failed');
    expect(sameGroupFailed?.pageMapId).toBeUndefined();
    expect(success?.status).toBe('pendingReview');
  });

  it('刷新页面地图后重试失败导入项会绑定并复用新页面地图', async () => {
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    failUrl = '/missing';
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-reuse-refreshed-map',
      envKey: 'default',
      cases: [createCase('TC001', '/missing')]
    });

    await enqueueImportJob('crm', job.importId);
    const failedItems = await waitItems('crm', job.importId, ['pendingReview', 'failed']);
    const failed = failedItems[0];
    const oldMapId = (await listPageMaps('crm')).find((item) => item.targetUrl === failed.source.caseInfo.targetUrl && item.status === 'failed')?.mapId;

    expect(oldMapId).toMatch(/^pm-/);

    failUrl = '';
    await updateImportItem('crm', job.importId, failed.itemId, {
      pageMapId: oldMapId
    });
    await processImportItem('crm', job.importId, failed.itemId);
    const firstRetryItems = await listImportItems('crm', job.importId);
    const firstRetry = firstRetryItems[0];
    const mapId = firstRetry.pageMapId;
    const refreshedMap = await readPageMap('crm', mapId!);
    const refreshCount = collectCount;

    await updateImportItem('crm', job.importId, firstRetry.itemId, {
      status: 'failed',
      errorMessage: '模拟草稿生成失败',
      pageMapId: undefined
    });
    await processImportItem('crm', job.importId, firstRetry.itemId);
    const secondRetryItems = await listImportItems('crm', job.importId);
    const secondRetry = secondRetryItems[0];

    expect(collectCount).toBe(refreshCount);
    expect(refreshedMap.status).toBe('ready');
    expect(mapId).toMatch(/^pm-/);
    expect(mapId).toBe(oldMapId);
    expect(secondRetry.status).toBe('pendingReview');
    expect(secondRetry.pageMapId).toBe(mapId);
  });

  it('分组生成失败后先拆批，拆批失败后降级为单条生成', async () => {
    draftStats.failGroupSizes = [4, 2];
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-group-fallback',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/users'), createCase('TC003', '/users'), createCase('TC004', '/users')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);

    expect(collectCount).toBe(1);
    expect(draftStats.groupSizes).toEqual([4, 2, 2]);
    expect(draftStats.singleCaseNos).toEqual(['TC001', 'TC002', 'TC003', 'TC004']);
    expect(items.every((item) => item.status === 'pendingReview')).toBe(true);
    expect(new Set(items.map((item) => item.pageMapId)).size).toBe(1);
    expect(items.every((item) => item.genMode === 'single')).toBe(true);
    expect(items.every((item) => item.fallbackReason?.includes('模拟分组失败'))).toBe(true);
  });

  it('单条降级失败不会影响同组其他用例保存草稿', async () => {
    draftStats.failGroupSizes = [3, 2];
    draftStats.failSingleCaseNos = ['TC002'];
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-single-fallback-failed',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/users'), createCase('TC003', '/users')]
    });

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);
    const success = items.filter((item) => item.status === 'pendingReview');
    const failed = items.find((item) => item.caseNo === 'TC002');

    expect(collectCount).toBe(1);
    expect(success.map((item) => item.caseNo)).toEqual(['TC001', 'TC003']);
    expect(success.every((item) => item.draft)).toBe(true);
    expect(failed).toMatchObject({
      status: 'failed',
      genMode: 'single'
    });
    expect(failed?.errorMessage).toContain('模拟单条失败 TC002');
  });

  it('分组返回未知或缺失编号时失败项可见组级错误且不影响成功项', async () => {
    draftStats.groupErrors = ['模型返回未知用例编号 TC999', '模型缺少用例编号 TC001'];
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-group-visible-error',
      envKey: 'default',
      cases: [createCase('TC001', '/users'), createCase('TC002', '/users'), createCase('TC003', '/users')]
    });
    draftStats.groupItems = [
      { caseNo: 'TC002', error: '字段缺失：步骤为空' },
      { caseNo: 'TC003', draft: createMockDraft('TC003', '/users') },
      { caseNo: 'TC999', error: '未知用例编号' }
    ];

    await enqueueImportJob('crm', job.importId);
    const items = await waitItems('crm', job.importId, ['pendingReview', 'failed']);
    const failedMissing = items.find((item) => item.caseNo === 'TC001');
    const failedOwn = items.find((item) => item.caseNo === 'TC002');
    const success = items.find((item) => item.caseNo === 'TC003');

    expect(failedMissing?.errorMessage).toContain('模型返回未知用例编号 TC999');
    expect(failedMissing?.errorMessage).toContain('模型缺少用例编号 TC001');
    expect(failedOwn?.errorMessage).toContain('字段缺失：步骤为空');
    expect(failedOwn?.errorMessage).toContain('模型返回未知用例编号 TC999');
    expect(failedOwn?.aiDebug?.error).toContain('模型缺少用例编号 TC001');
    expect(success?.status).toBe('pendingReview');
    expect(success?.errorMessage).toBeUndefined();
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

/**
 * 创建 mock AI 草稿，避免 worker 测试依赖真实模型输出。
 */
function createMockDraft(caseNo: string, targetUrl: string): AiCaseDraft {
  return {
    name: `${caseNo} 草稿`,
    startPath: targetUrl,
    confidence: 'medium' as const,
    warnings: [],
    missingInfo: [],
    steps: [
      {
        id: 's1',
        type: 'click' as const,
        selector: "getByRole('button', { name: '新增' })",
        text: '点击新增按钮',
        confidence: 'medium' as const,
        warnings: []
      }
    ]
  };
}
