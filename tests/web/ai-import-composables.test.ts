import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportTaskCase, ImportTaskDetail } from '../../shared/types';
import { useImportTaskReview } from '../../web/src/pages/ai-import/ai-import-composables';

const mocks = vi.hoisted(() => ({
  getImportTask: vi.fn(),
  reviewImportTask: vi.fn(),
  confirmImportCase: vi.fn(),
  retryImportCase: vi.fn(),
  unconfirmImportCase: vi.fn(),
  publishImportCase: vi.fn(),
  resumeImportTask: vi.fn(),
  previewImportActionIr: vi.fn(),
  saveImportActionIr: vi.fn()
}));

vi.mock('../../web/src/api/imports', () => ({
  getImportTask: mocks.getImportTask,
  reviewImportTask: mocks.reviewImportTask,
  confirmImportCase: mocks.confirmImportCase,
  retryImportCase: mocks.retryImportCase,
  unconfirmImportCase: mocks.unconfirmImportCase,
  publishImportCase: mocks.publishImportCase,
  resumeImportTask: mocks.resumeImportTask,
  previewImportActionIr: mocks.previewImportActionIr,
  saveImportActionIr: mocks.saveImportActionIr
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
    const retriedResult = await page.retryCase(failed);

    expect(mocks.confirmImportCase).toHaveBeenCalledWith('crm', confirmed.id, pending.id);
    expect(mocks.retryImportCase).toHaveBeenCalledWith('crm', confirmed.id, failed.id);
    expect(page.task.value?.cases[0]?.status).toBe('publishable');
    expect(page.task.value?.cases[1]?.status).toBe('pending-review');
    expect(page.actingId.value).toBe('');
    expect(retriedResult).toEqual({ outcome: 'generated' });
  });

  it('重试后仍在探索时继续轮询，失败不会当成已重新生成', async () => {
    const failed = makeCase('failed');
    const exploring = makeTask([{ ...failed, status: 'exploring' }]);
    const stillFailed = makeTask([
      {
        ...failed,
        status: 'failed',
        failure: { kind: 'explore-failed', message: '页面探索失败，无法生成测试意图' }
      }
    ]);
    mocks.retryImportCase.mockResolvedValue(exploring);
    mocks.getImportTask.mockResolvedValue(stillFailed);
    const page = useImportTaskReview('crm', exploring.id);
    page.task.value = makeTask([failed]);

    await expect(page.retryCase(failed)).resolves.toEqual({
      outcome: 'failed',
      failure: stillFailed.cases[0]?.failure
    });
    expect(mocks.getImportTask).toHaveBeenCalled();
    expect(page.task.value?.cases[0]?.status).toBe('failed');
  });

  it('探索未完成时轮询任务，不把审阅请求一直挂起', async () => {
    const parsed = makeTask([makeCase('parsed')]);
    const exploring = makeTask([makeCase('exploring')]);
    const reviewed = makeTask([makeCase('pending-review')]);
    mocks.getImportTask.mockResolvedValueOnce(parsed).mockResolvedValue(reviewed);
    mocks.reviewImportTask.mockResolvedValue(exploring);
    const page = useImportTaskReview('crm', parsed.id);

    await page.loadTask();

    expect(mocks.reviewImportTask).toHaveBeenCalledTimes(1);
    expect(mocks.getImportTask).toHaveBeenCalledTimes(2);
    expect(page.task.value?.cases[0]?.status).toBe('pending-review');
    expect(page.reviewing.value).toBe(false);
  });

  it('探索结束后自动加载定位和填写值，不必离开页面', async () => {
    const parsed = makeTask([makeCase('parsed')]);
    const exploring = makeTask([makeCase('exploring')]);
    const reviewed = makeTask([makeCaseWithIntent('pending-review')]);
    mocks.getImportTask.mockResolvedValueOnce(parsed).mockResolvedValue(reviewed);
    mocks.reviewImportTask.mockResolvedValue(exploring);
    mocks.previewImportActionIr.mockResolvedValue({
      ok: true,
      steps: [{ id: 'stp-1', type: 'click' as const, selector: "getByRole('button', { name: '提交' })" }],
      issues: []
    });
    const page = useImportTaskReview('crm', parsed.id);

    await page.loadTask();

    expect(mocks.previewImportActionIr).toHaveBeenCalledWith('crm', parsed.id, reviewed.cases[0]?.id);
    expect(page.actionIrById.value[reviewed.cases[0]?.id ?? '']?.steps[0]?.selector).toContain('提交');
  });

  it('检查点中断时从检查点恢复并继续探索', async () => {
    const interrupted = makeTask([makeCase('parsed')]);
    interrupted.status = 'interrupted';
    const resumed = { ...interrupted, status: 'completed' as const, skippedItemIds: [], processedItemIds: [] };
    const reviewed = makeTask([makeCase('pending-review')]);
    mocks.resumeImportTask.mockResolvedValue(resumed);
    mocks.reviewImportTask.mockResolvedValue(reviewed);
    const page = useImportTaskReview('crm', interrupted.id);
    page.task.value = interrupted;

    await page.resumeTask();

    expect(mocks.resumeImportTask).toHaveBeenCalledWith('crm', interrupted.id);
    expect(mocks.reviewImportTask).toHaveBeenCalledWith('crm', interrupted.id);
    expect(page.task.value?.cases[0]?.status).toBe('pending-review');
  });

  it('加载并保存定位和填写值', async () => {
    const pending = makeCaseWithIntent('pending-review');
    const preview = {
      ok: true,
      steps: [{ id: 'stp-1', type: 'click' as const, selector: "getByRole('button', { name: '提交' })" }],
      issues: []
    };
    mocks.previewImportActionIr.mockResolvedValue(preview);
    mocks.saveImportActionIr.mockResolvedValue(makeTask([pending]));
    const page = useImportTaskReview('crm', 'imp-20990101-000000-abcd');
    page.task.value = makeTask([pending]);

    await page.loadActionIr(pending);
    await page.saveActionIrLocator(pending, preview.steps[0], {
      selector: "getByRole('button', { name: '确定', exact: true })",
      draft: { mode: 'role', role: 'button', value: { kind: 'text', text: '确定' }, exact: true }
    });

    expect(mocks.previewImportActionIr).toHaveBeenCalledWith('crm', 'imp-20990101-000000-abcd', pending.id);
    expect(mocks.saveImportActionIr).toHaveBeenCalledWith('crm', 'imp-20990101-000000-abcd', pending.id, {
      locators: {
        'stp-1': {
          selector: "getByRole('button', { name: '确定', exact: true })",
          selectorDraft: { mode: 'role', role: 'button', value: { kind: 'text', text: '确定' }, exact: true }
        }
      }
    });
  });

  it('已发布时保存定位会说明不能改', async () => {
    const published = makeCaseWithIntent('published');
    const page = useImportTaskReview('crm', 'imp-20990101-000000-abcd');
    page.task.value = makeTask([published]);

    await expect(page.saveActionIr(published, { steps: [{ id: 'stp-1', data: '其它' }] })).rejects.toThrow(
      '当前状态不能改定位和填写值'
    );
    expect(mocks.saveImportActionIr).not.toHaveBeenCalled();
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

/**
 * 构造带可审阅意图的导入用例。
 */
function makeCaseWithIntent(status: ImportTaskCase['status']): ImportTaskCase {
  const item = makeCase(status);
  item.intent = {
    id: item.id,
    caseNumber: item.caseNumber,
    name: item.name,
    startPath: item.startPath,
    preconditions: '',
    expected: '',
    remark: '',
    source: item.source,
    steps: [
      {
        id: 'stp-1',
        action: '点击',
        target: '提交',
        data: '',
        note: '',
        sourceRefs: [item.source]
      }
    ],
    pendingItems: []
  };
  return item;
}
