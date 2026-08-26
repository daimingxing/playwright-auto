import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportTaskCase, ImportTaskDetail } from '../../shared/types';
import { useImportTaskReview } from '../../web/src/pages/ai-import/ai-import-composables';

const mocks = vi.hoisted(() => ({
  getImportTask: vi.fn(),
  reviewImportTask: vi.fn(),
  confirmImportCase: vi.fn(),
  retryImportCase: vi.fn()
}));

vi.mock('../../web/src/api/imports', () => ({
  getImportTask: mocks.getImportTask,
  reviewImportTask: mocks.reviewImportTask,
  confirmImportCase: mocks.confirmImportCase,
  retryImportCase: mocks.retryImportCase
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('导入任务审阅组合函数', () => {
  it('打开详情时对已解析用例生成可审阅意图', async () => {
    const parsed = makeTask([makeCase('parsed')]);
    const reviewed = makeTask([makeCase('pending-review')]);
    mocks.getImportTask.mockResolvedValue(parsed);
    mocks.reviewImportTask.mockResolvedValue(reviewed);
    const page = useImportTaskReview('crm', parsed.id);

    await page.loadTask();

    expect(mocks.reviewImportTask).toHaveBeenCalledWith('crm', parsed.id);
    expect(page.task.value?.cases[0]?.status).toBe('pending-review');
  });

  it('只确认待确认用例，并只重试失败用例', async () => {
    const pending = makeCase('pending-review');
    const failed = makeCase('failed', 'item-20990101-000000-abce');
    const confirmed = makeTask([{ ...pending, status: 'publishable' }, failed]);
    const retried = makeTask([
      { ...pending, status: 'publishable' },
      { ...failed, status: 'pending-review' }
    ]);
    mocks.getImportTask.mockResolvedValue(makeTask([pending, failed]));
    mocks.confirmImportCase.mockResolvedValue(confirmed);
    mocks.retryImportCase.mockResolvedValue(retried);
    const page = useImportTaskReview('crm', confirmed.id);
    page.task.value = makeTask([pending, failed]);

    await page.confirmCase(pending);
    await page.retryCase(failed);

    expect(mocks.confirmImportCase).toHaveBeenCalledWith('crm', confirmed.id, pending.id);
    expect(mocks.retryImportCase).toHaveBeenCalledWith('crm', confirmed.id, failed.id);
    expect(page.task.value?.cases[0]?.status).toBe('publishable');
    expect(page.task.value?.cases[1]?.status).toBe('pending-review');
  });
});

/**
 * 构造导入任务详情测试数据。
 */
function makeTask(cases: ImportTaskCase[]): ImportTaskDetail {
  return {
    id: 'imp-20990101-000000-abcd',
    projectKey: 'crm',
    fileName: 'orders.xlsx',
    fileHash: 'a'.repeat(64),
    assetId: 'a'.repeat(64),
    status: 'completed',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    parsedCount: cases.length,
    failedCount: 0,
    cases,
    checkpoint: { stage: 'completed', updatedAt: '2026-08-26T00:00:00.000Z', items: [] },
    input: { assetId: 'a'.repeat(64), fileName: 'orders.xlsx' }
  };
}

/**
 * 构造导入用例测试数据。
 */
function makeCase(status: ImportTaskCase['status'], id = 'item-20990101-000000-abcd'): ImportTaskCase {
  return {
    id,
    caseNumber: 'TC-001',
    name: '创建订单',
    startPath: '/orders/create',
    preconditions: '',
    expected: '',
    remark: '',
    status,
    source: { sheet: '用例', row: 2, caseNumber: 'TC-001', cells: {} },
    steps: [],
    errors: []
  };
}
