import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import type { ImportItem, ImportJob } from '../../shared/types';
import { parseImportExcel } from '../../server/src/services/import/import-excel';
import {
  canRetryImportItem,
  canSaveImportItem,
  canOpenSavedCase,
  filterImportItems,
  formatMatchType,
  formatTargetType,
  formatImportItemStatus,
  formatImportStatus,
  formatDraftStepType,
  formatImportTime,
  getStepSummary,
  getImportProgress,
  getPendingCount,
  getItemIssueText,
  formatPageMapStatus,
  formatPageMapAge,
  formatPageMapCount,
  formatPageMapState,
  formatGroupState,
  getFallbackText,
  getMapWarnings,
  getMapStates,
  hasPageMapDebug
} from '../../web/src/pages/ai-import/ai-import';

describe('AI 导入页面工具', () => {
  it('格式化导入任务进度', () => {
    expect(getImportProgress(makeJob({ totalCount: 10, generatedCount: 4 }))).toBe(40);
    expect(getImportProgress(makeJob({ totalCount: 0, generatedCount: 4 }))).toBe(0);
  });

  it('统计已生成但待确认的导入项数量', () => {
    expect(getPendingCount(makeJob({ generatedCount: 6, savedCount: 2, skippedCount: 3 }))).toBe(4);
    expect(getPendingCount(makeJob({ generatedCount: 1, savedCount: 2, skippedCount: 0 }))).toBe(0);
  });

  it('只允许保存待确认导入项', () => {
    expect(canSaveImportItem(makeItem('pendingReview'))).toBe(true);
    expect(canSaveImportItem(makeItem('saved'))).toBe(false);
    expect(canSaveImportItem(makeItem('failed'))).toBe(false);
  });

  it('只允许重试生成失败导入项', () => {
    expect(canRetryImportItem(makeItem('failed'))).toBe(true);
    expect(canRetryImportItem(makeItem('pendingReview'))).toBe(false);
    expect(canRetryImportItem(makeItem('saved'))).toBe(false);
    expect(canRetryImportItem(makeItem('saved', { savedCaseKey: 'case-1', savedCaseState: 'missing' }))).toBe(true);
  });

  it('只允许打开仍存在的已保存草稿', () => {
    expect(canOpenSavedCase(makeItem('saved', { savedCaseKey: 'case-1', savedCaseState: 'active' }))).toBe(true);
    expect(canOpenSavedCase(makeItem('saved', { savedCaseKey: 'case-1', savedCaseState: 'missing' }))).toBe(false);
  });

  it('显示任务和导入项状态中文', () => {
    expect(formatImportStatus('partialSaved')).toBe('部分保存');
    expect(formatImportItemStatus('pendingReview')).toEqual({ label: '待确认', type: 'warning' });
  });

  it('格式化草稿和源步骤枚举时不显示裸英文', () => {
    expect(formatDraftStepType('click')).toBe('点击');
    expect(formatDraftStepType('fill')).toBe('填写');
    expect(formatDraftStepType('select')).toBe('选择');
    expect(formatDraftStepType('assertVisible')).toBe('检查可见');
    expect(formatTargetType('button')).toBe('按钮');
    expect(formatMatchType('contains')).toBe('包含');
  });

  it('格式化未知枚举时保留可见兜底文本', () => {
    expect(formatDraftStepType()).toBe('-');
    expect(formatTargetType()).toBe('-');
    expect(formatMatchType()).toBe('-');
    expect(formatDraftStepType(null)).toBe('-');
    expect(formatTargetType(null)).toBe('-');
    expect(formatMatchType(null)).toBe('-');
    expect(formatDraftStepType('upload')).toBe('upload');
    expect(formatTargetType('toast')).toBe('toast');
    expect(formatMatchType('startsWith')).toBe('startsWith');
  });

  it('从新版源步骤生成步骤摘要', () => {
    expect(
      getStepSummary({
        caseNo: 'TC001',
        stepNo: 1,
        actionType: 'fill',
        targetType: 'input',
        targetName: '用户名称',
        inputValue: '测试用户001',
        matchType: 'equals',
        actionText: '',
        targetText: '',
        dataKeys: [],
        note: ''
      })
    ).toBe('填写 输入框 用户名称：测试用户001，匹配方式：等于');
  });

  it('从部分缺失的新版源步骤生成步骤摘要时不拼入占位符', () => {
    expect(
      getStepSummary({
        caseNo: 'TC001',
        stepNo: 1,
        actionType: 'fill',
        targetType: undefined,
        targetName: '用户名称',
        inputValue: '测试用户001',
        matchType: undefined,
        actionText: '',
        targetText: '',
        dataKeys: [],
        note: ''
      })
    ).toBe('填写 用户名称：测试用户001');
  });

  it('从旧三表源步骤生成步骤摘要', () => {
    expect(
      getStepSummary({
        caseNo: 'TC001',
        stepNo: 1,
        actionText: '填写用户名称',
        targetText: '用户名称输入框',
        dataKeys: ['username'],
        note: ''
      })
    ).toBe('填写用户名称，用户名称输入框');
  });

  it('真实 Excel 模板可以被解析为两表导入数据', async () => {
    const buffer = readFileSync('docs/ai-case-import/AI自然语言用例导入模板.xlsx');
    const result = await parseImportExcel(buffer);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.caseInfo.caseNo)).toEqual(['TC001', 'TC002']);
    expect(result[0].steps.map((step) => step.stepNo)).toEqual([1, 2, 3, 4]);
    expect(result[1].steps.map((step) => step.stepNo)).toEqual([1, 2]);
  });

  it('真实 Excel 模板保留两张业务表和中文英文动作值', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync('docs/ai-case-import/AI自然语言用例导入模板.xlsx') as unknown as ExcelJS.Buffer);
    const steps = workbook.getWorksheet('步骤明细');

    expect(workbook.getWorksheet('用例清单')).toBeTruthy();
    expect(steps).toBeTruthy();
    expect(workbook.getWorksheet('测试数据')).toBeUndefined();
    expect(steps?.getColumn(3).values).toEqual(
      expect.arrayContaining(['填写(fill)', '选择(select)', '检查可见(assertVisible)'])
    );
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

  it('格式化页面地图状态、缓存年龄和状态数量', () => {
    expect(formatPageMapStatus('ready')).toEqual({ label: '可用', type: 'success' });
    expect(formatPageMapStatus('stale')).toEqual({ label: '建议刷新', type: 'warning' });
    expect(formatPageMapStatus('failed')).toEqual({ label: '采集失败', type: 'danger' });
    expect(formatPageMapAge('2026-05-28T00:00:00.000Z', new Date('2026-05-28T00:30:00.000Z'))).toBe('30 分钟前');
    expect(formatPageMapAge('2026-05-27T00:00:00.000Z', new Date('2026-05-28T01:00:00.000Z'))).toBe('1 天前');
    expect(formatPageMapAge()).toBe('-');
    expect(formatPageMapCount(0)).toBe('0 个状态');
    expect(formatPageMapCount(3)).toBe('3 个状态');
  });

  it('格式化页面地图状态时显示状态名、来源动作和 warning', () => {
    expect(
      formatPageMapState({
        stateId: 'state-action-1',
        name: '菜单展开',
        url: '/users#menu',
        title: '用户管理',
        snapshotPath: 'snapshot.json',
        sourceAction: {
          id: 'action-1',
          type: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          path: ['系统管理']
        },
        warnings: ['探索动作后页面网络未在限定时间内完全空闲，已继续读取当前可见内容。'],
        createdAt: '2026-05-28T00:00:00.000Z'
      })
    ).toEqual({
      name: '菜单展开',
      action: '点击 菜单 系统管理',
      warning: '探索动作后页面网络未在限定时间内完全空闲，已继续读取当前可见内容。'
    });

    expect(
      formatPageMapState({
        stateId: 'state-initial',
        name: '初始页面',
        url: '/users',
        title: '用户管理',
        snapshotPath: 'snapshot.json',
        warnings: [],
        createdAt: '2026-05-28T00:00:00.000Z'
      })
    ).toEqual({ name: '初始页面', action: '直接打开目标页面', warning: '-' });
  });

  it('危险动作 warning 不会被误归类为生成失败', () => {
    const item = makeItem('pendingReview', {
      pageMap: {
        mapId: 'map-1',
        projectKey: 'crm',
        envKey: 'default',
        targetUrl: '/users',
        authHash: 'auth',
        viewport: { width: 1280, height: 720 },
        status: 'ready',
        stateCount: 1,
        updatedAt: '2026-05-28T00:00:00.000Z'
      }
    });

    expect(filterImportItems([item], 'failed')).toEqual([]);
    expect(getItemIssueText(item)).toBe('-');
    expect(getMapWarnings(['已跳过危险动作：保存'])).toEqual(['已跳过危险动作：保存']);
  });

  it('格式化分组状态、页面地图和降级提示', () => {
    const items: ImportItem[] = [
      makeViewItem('pendingReview', {
        groupId: 'pm-group',
        groupIndex: 0,
        pageMapId: 'pm-group',
        genMode: 'group',
        source: makeSource('/users')
      }),
      makeViewItem('failed', {
        caseNo: 'TC002',
        groupId: 'pm-group',
        groupIndex: 1,
        pageMapId: 'pm-group',
        genMode: 'single',
        fallbackReason: '分组生成失败：模型返回不可用',
        source: makeSource('/users')
      })
    ];

    expect(formatGroupState(items[0], items)).toEqual({
      url: '/users',
      mapId: 'pm-group',
      label: '分组生成 1/2',
      type: 'warning'
    });
    expect(getFallbackText(items[0])).toBe('-');
    expect(getFallbackText(items[1])).toBe('已降级为单条生成：分组生成失败：模型返回不可用');
  });

  it('页面地图状态缺失或类型漂移时不会影响调试判断', () => {
    expect(() => hasPageMapDebug(makeBrokenMap({ states: undefined }))).not.toThrow();
    expect(() => hasPageMapDebug(makeBrokenMap({ states: 'bad states' }))).not.toThrow();
    expect(getMapStates(makeBrokenMap({ states: undefined }))).toEqual([]);
    expect(getMapStates(makeBrokenMap({ states: 'bad states' }))).toEqual([]);
    expect(hasPageMapDebug(makeBrokenMap({ states: undefined }))).toBe(false);
    expect(hasPageMapDebug(makeBrokenMap({ states: 'bad states', warnings: ['  采集异常  '] }))).toBe(true);
  });

  it('页面地图 warning 缺失或类型漂移时按空数组处理', () => {
    expect(() => getMapWarnings(undefined)).not.toThrow();
    expect(() => getMapWarnings('bad warnings' as unknown as string[])).not.toThrow();
    expect(() => getMapWarnings(['  采集异常  ', 123, null] as unknown as string[])).not.toThrow();
    expect(getMapWarnings(undefined)).toEqual([]);
    expect(getMapWarnings('bad warnings' as unknown as string[])).toEqual([]);
    expect(getMapWarnings(['  采集异常  ', ''])).toEqual(['采集异常']);
    expect(getMapWarnings(['  采集异常  ', 123, null] as unknown as string[])).toEqual(['采集异常']);
  });

  it('格式化页面地图更新时间用于摘要展示', () => {
    expect(formatImportTime('2026-05-28T08:30:00.000Z')).toBe('2026-05-28 08:30:00');
    expect(formatImportTime()).toBe('-');
  });

  it('模板说明包含两表字段、示例和不推荐写法', () => {
    const doc = readFileSync('docs/ai-case-import/AI自然语言用例导入模板说明.md', 'utf-8');

    expect(doc).toContain('新用户默认使用两表模板');
    expect(doc).toContain('用例清单');
    expect(doc).toContain('步骤明细');
    expect(doc).toContain('输入/期望值');
    expect(doc).toContain('点击(click)');
    expect(doc).toContain('填写(fill)');
    expect(doc).not.toContain('输入(fill)');
    expect(doc).not.toContain('下拉选择(select)');
    expect(doc).not.toContain('检查显示(assertVisible)');
    expect(doc).toContain('不推荐写法');
    expect(doc).toContain('旧三表模板');
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
 * 创建字段异常的页面地图测试数据。
 */
function makeBrokenMap(patch: Record<string, unknown>) {
  return {
    mapId: 'map-1',
    projectKey: 'crm',
    envKey: 'default',
    targetUrl: '/users',
    authHash: 'auth',
    viewport: { width: 1280, height: 720 },
    status: 'ready',
    states: [],
    warnings: [],
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...patch
  } as never;
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
      ...makeSource('/user/list')
    },
    draft: makeDraft(),
    status,
    retryCount: 0,
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...patch
  };
}

/**
 * 创建带预览扩展字段的导入项测试数据。
 */
function makeViewItem(status: ImportItem['status'], patch: Partial<ImportItem> = {}): ImportItem {
  return {
    ...makeItem(status, patch),
    ...patch
  };
}

/**
 * 创建导入源测试数据。
 */
function makeSource(targetUrl: string): ImportItem['source'] {
  return {
    caseInfo: {
      caseNo: 'TC001',
      caseName: '新增用户',
      targetUrl,
      precondition: '',
      expectedResult: '添加成功',
      note: ''
    },
    steps: [],
    data: []
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
