import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyImportJobDelta,
  createImportJob,
  getImportJob,
  listImportItems,
  listImportJobs,
  rebuildImportJobSummary,
  recoverImportItems,
  transitionImportItem,
  transitionImportItems,
  updateImportItem
} from '../../server/src/lib/import-store';
import * as importStore from '../../server/src/lib/import-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-store-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入任务存储', () => {
  it('创建任务并读取导入项', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [createCase()]
    });

    const jobs = await listImportJobs('crm');
    const detail = await getImportJob('crm', job.importId);
    const items = await listImportItems('crm', job.importId);

    expect(jobs).toHaveLength(1);
    expect(detail.totalCount).toBe(1);
    expect(items[0].caseNo).toBe('TC001');
  });

  it('更新导入项状态并同步任务摘要', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);

    await updateImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: {
        name: '新增用户',
        startPath: '/user/list',
        steps: [],
        confidence: 'high',
        warnings: [],
        missingInfo: []
      }
    });

    const detail = await getImportJob('crm', job.importId);
    const items = await listImportItems('crm', job.importId);

    expect(items[0].status).toBe('pendingReview');
    expect(detail.status).toBe('pendingReview');
    expect(detail.generatedCount).toBe(1);
  });

  it('恢复历史生成中的导入项为待处理', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);

    await updateImportItem('crm', job.importId, item.itemId, {
      status: 'generating',
      retryCount: 1
    });

    const recovered = await recoverImportItems('crm', job.importId);
    const items = await listImportItems('crm', job.importId);
    const detail = await getImportJob('crm', job.importId);

    expect(recovered).toEqual([item.itemId]);
    expect(items[0]).toMatchObject({
      status: 'pending',
      retryCount: 0,
      errorMessage: '上次导入生成被服务重启中断，已重新排队'
    });
    expect(detail.status).toBe('running');
  });
});

describe('AI 导入任务状态转移', () => {
  it('transitionImportItem 返回前后对象并只写一次任务摘要', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-delta',
      envKey: 'default',
      cases: [createCase('TC001')]
    });
    const [item] = await listImportItems('crm', job.importId);
    const getJobSpy = vi.spyOn(importStore, 'getImportJob');

    getJobSpy.mockClear();

    const { prev, next } = await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: createDraft('新增用户')
    });

    const detail = await getImportJob('crm', job.importId);

    expect(prev.status).toBe('pending');
    expect(next.status).toBe('pendingReview');
    expect(detail.generatedCount).toBe(1);
    expect(detail.status).toBe('pendingReview');
    // 单条转移不应扫全量目录来重算计数。
    expect(getJobSpy).toHaveBeenCalledTimes(1);

    getJobSpy.mockRestore();
  });

  it('transitionImportItems 批量聚合计数，多项状态在 delta 累加后正确', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-batch',
      envKey: 'default',
      cases: [createCase('TC001'), createCase('TC002'), createCase('TC003')]
    });
    const items = await listImportItems('crm', job.importId);

    await transitionImportItems('crm', job.importId, [
      { itemId: items[0].itemId, patch: { status: 'pendingReview', draft: createDraft('TC001') } },
      { itemId: items[1].itemId, patch: { status: 'pendingReview', draft: createDraft('TC002') } },
      { itemId: items[2].itemId, patch: { status: 'failed', errorMessage: '提前失败' } }
    ]);

    const detail = await getImportJob('crm', job.importId);
    const nextItems = await listImportItems('crm', job.importId);

    expect(detail.generatedCount).toBe(2);
    expect(detail.failedCount).toBe(1);
    // 还有一项处于 pendingReview 而无 saved/skipped，因此任务状态为 pendingReview。
    expect(detail.status).toBe('pendingReview');
    expect(nextItems.map((item) => item.status).sort()).toEqual(['failed', 'pendingReview', 'pendingReview']);
  });

  it('pending -> generating -> pendingReview 路径下计数与状态正确', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-flow-1',
      envKey: 'default',
      cases: [createCase('TC001')]
    });
    const [item] = await listImportItems('crm', job.importId);

    await transitionImportItem('crm', job.importId, item.itemId, { status: 'generating' });
    let detail = await getImportJob('crm', job.importId);

    expect(detail.status).toBe('running');
    expect(detail.generatedCount).toBe(0);
    expect(detail.savedCount).toBe(0);

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: createDraft('新增用户')
    });
    detail = await getImportJob('crm', job.importId);

    expect(detail.status).toBe('pendingReview');
    expect(detail.generatedCount).toBe(1);
  });

  it('pendingReview -> saved 路径下 generatedCount 不变、savedCount 增加、状态推进', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-flow-2',
      envKey: 'default',
      cases: [createCase('TC001')]
    });
    const [item] = await listImportItems('crm', job.importId);

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: createDraft('新增用户')
    });
    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'saved',
      savedCaseKey: 'case-key',
      savedAt: new Date().toISOString()
    });
    const detail = await getImportJob('crm', job.importId);

    expect(detail.generatedCount).toBe(1);
    expect(detail.savedCount).toBe(1);
    expect(detail.status).toBe('completed');
  });

  it('failed -> pending -> pendingReview 重试后计数回到正确值', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-flow-3',
      envKey: 'default',
      cases: [createCase('TC001')]
    });
    const [item] = await listImportItems('crm', job.importId);

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'failed',
      errorMessage: '第一次失败'
    });
    let detail = await getImportJob('crm', job.importId);
    expect(detail.failedCount).toBe(1);

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pending',
      errorMessage: undefined,
      retryCount: 1
    });
    detail = await getImportJob('crm', job.importId);
    expect(detail.failedCount).toBe(0);
    expect(detail.status).toBe('running');

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: createDraft('新增用户')
    });
    detail = await getImportJob('crm', job.importId);
    expect(detail.failedCount).toBe(0);
    expect(detail.generatedCount).toBe(1);
    expect(detail.status).toBe('pendingReview');
  });

  it('applyImportJobDelta 负向 delta 不会让计数跌破 0', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-clamp',
      envKey: 'default',
      cases: [createCase('TC001')]
    });

    const detail = await applyImportJobDelta('crm', job.importId, {
      generatedDelta: -5,
      savedDelta: -1,
      failedDelta: -1,
      skippedDelta: -1
    });

    expect(detail.generatedCount).toBe(0);
    expect(detail.savedCount).toBe(0);
    expect(detail.failedCount).toBe(0);
    expect(detail.skippedCount).toBe(0);
  });

  it('applyImportJobDelta 并发更新同一任务时不丢失增量', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-concurrent-delta',
      envKey: 'default',
      cases: Array.from({ length: 30 }, (_, index) => createCase(`TC${String(index + 1).padStart(3, '0')}`))
    });

    await Promise.all(
      Array.from({ length: 30 }, () =>
        applyImportJobDelta('crm', job.importId, {
          generatedDelta: 1,
          savedDelta: 0,
          failedDelta: 0,
          skippedDelta: 0
        })
      )
    );

    const detail = await getImportJob('crm', job.importId);

    expect(detail.generatedCount).toBe(30);
    expect(detail.status).toBe('pendingReview');
  });

  it('rebuildImportJobSummary 在数据脏掉时可以从 item 重新计算', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-rebuild',
      envKey: 'default',
      cases: [createCase('TC001')]
    });
    const [item] = await listImportItems('crm', job.importId);
    // 模拟历史脏数据：把摘要写大到与实际 item 不一致。
    await importStore.applyImportJobDelta('crm', job.importId, {
      generatedDelta: 10,
      savedDelta: 5,
      failedDelta: 0,
      skippedDelta: 0
    });

    await transitionImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: createDraft('TC001')
    });

    const detail = await rebuildImportJobSummary('crm', job.importId);

    expect(detail.generatedCount).toBe(1);
    expect(detail.savedCount).toBe(0);
    expect(detail.status).toBe('pendingReview');
  });

  it('transitionImportItems 跳过已不存在的导入项', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-skip',
      envKey: 'default',
      cases: [createCase('TC001')]
    });

    const result = await transitionImportItems('crm', job.importId, [
      { itemId: 'non-existent', patch: { status: 'failed' } }
    ]);
    const detail = await getImportJob('crm', job.importId);

    expect(result).toEqual([]);
    expect(detail.failedCount).toBe(0);
    expect(detail.status).toBe('running');
  });
});

/**
 * 创建单条导入源数据。
 */
function createCase(caseNo: string = 'TC001') {
  return {
    caseInfo: {
      caseNo,
      caseName: `${caseNo} 用例`,
      targetUrl: '/user/list',
      precondition: '',
      expectedResult: '添加成功',
      note: ''
    },
    steps: [],
    data: [],
    rowRefs: { caseRow: 2, stepRows: [], dataRows: [] }
  };
}

/**
 * 创建测试用 AI 草稿。
 */
function createDraft(name: string) {
  return {
    name,
    startPath: '/user/list',
    steps: [],
    confidence: 'high' as const,
    warnings: [],
    missingInfo: []
  };
}
