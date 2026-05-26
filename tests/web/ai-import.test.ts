import { describe, expect, it } from 'vitest';
import type { ImportItem, ImportJob } from '../../shared/types';
import {
  canSaveImportItem,
  filterImportItems,
  formatImportItemStatus,
  formatImportStatus,
  getImportProgress,
  getItemIssueText
} from '../../web/src/pages/ai-import';

describe('AI 导入页面工具', () => {
  it('格式化导入任务进度', () => {
    expect(getImportProgress(makeJob({ totalCount: 10, generatedCount: 4 }))).toBe(40);
    expect(getImportProgress(makeJob({ totalCount: 0, generatedCount: 4 }))).toBe(0);
  });

  it('只允许保存待确认导入项', () => {
    expect(canSaveImportItem(makeItem('pendingReview'))).toBe(true);
    expect(canSaveImportItem(makeItem('saved'))).toBe(false);
    expect(canSaveImportItem(makeItem('failed'))).toBe(false);
  });

  it('显示任务和导入项状态中文', () => {
    expect(formatImportStatus('partialSaved')).toBe('部分保存');
    expect(formatImportItemStatus('pendingReview')).toEqual({ label: '待确认', type: 'warning' });
  });

  it('按状态、低置信和风险提示筛选导入项', () => {
    const normal = makeItem('pendingReview');
    const saved = makeItem('saved');
    const low = makeItem('pendingReview', { draft: { ...makeDraft(), confidence: 'low' } });
    const warning = makeItem('pendingReview', { draft: { ...makeDraft(), warnings: ['目标元素不唯一'] } });

    expect(filterImportItems([normal, saved], 'pendingReview')).toEqual([normal]);
    expect(filterImportItems([normal, low], 'lowConfidence')).toEqual([low]);
    expect(filterImportItems([normal, warning], 'warning')).toEqual([warning]);
  });

  it('优先显示失败和风险提示', () => {
    expect(getItemIssueText(makeItem('failed', { errorMessage: '页面打开失败' }))).toBe('页面打开失败');
    expect(getItemIssueText(makeItem('pendingReview', { draft: { ...makeDraft(), warnings: ['目标元素不唯一'] } }))).toBe(
      '目标元素不唯一'
    );
  });
});

/**
 * 创建导入任务测试数据。
 */
function makeJob(patch: Partial<ImportJob> = {}): ImportJob {
  return {
    importId: 'import-20260526-120000-ab12',
    fileName: 'cases.xlsx',
    fileHash: 'hash',
    envKey: 'default',
    status: 'running',
    totalCount: 1,
    generatedCount: 0,
    savedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...patch
  };
}

/**
 * 创建导入项测试数据。
 */
function makeItem(status: ImportItem['status'], patch: Partial<ImportItem> = {}): ImportItem {
  return {
    itemId: 'item-20260526-120000-ab12',
    caseNo: 'TC001',
    caseName: '新增用户',
    rowRefs: { caseRow: 2, stepRows: [2], dataRows: [] },
    sourceHash: 'hash',
    source: {
      caseInfo: {
        caseNo: 'TC001',
        caseName: '新增用户',
        targetUrl: '/user/list',
        precondition: '',
        expectedResult: '添加成功',
        note: ''
      },
      steps: [],
      data: []
    },
    draft: makeDraft(),
    status,
    retryCount: 0,
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...patch
  };
}

/**
 * 创建 AI 草稿测试数据。
 */
function makeDraft(): NonNullable<ImportItem['draft']> {
  return {
    name: '新增用户',
    startPath: '/user/list',
    confidence: 'medium',
    warnings: [],
    missingInfo: [],
    steps: [
      {
        id: 's1',
        type: 'click',
        selector: 'button',
        text: '点击新增按钮',
        confidence: 'medium',
        warnings: []
      }
    ]
  };
}
