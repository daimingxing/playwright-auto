import { describe, expect, it } from 'vitest';
import type { CaseMeta, PracticalReviewSummary } from '../../shared/types';
import {
  canStartRun,
  formatPracticalReviewStatus,
  formatPracticalReviewTime,
  getPracticalReviewTagType,
  getRunButtonText,
  getSelectedCases,
  mergeSelectedCaseKeys
} from '../../web/src/pages/run-center';

describe('运行中心用例选择工具', () => {
  it('首次加载用例时默认选中全部可用用例', () => {
    const cases = [makeCase('case-a'), makeCase('case-b')];

    const keys = mergeSelectedCaseKeys(cases, []);

    expect(keys).toEqual(['case-a', 'case-b']);
  });

  it('刷新用例列表时保留仍然存在的已选用例', () => {
    const cases = [makeCase('case-a'), makeCase('case-c')];

    const keys = mergeSelectedCaseKeys(cases, ['case-a', 'case-b']);

    expect(keys).toEqual(['case-a']);
  });

  it('全不选后运行按钮不可用', () => {
    expect(canStartRun(true, [], false)).toBe(false);
  });

  it('有登录态且选中用例时运行按钮可用', () => {
    expect(canStartRun(true, ['case-a'], false)).toBe(true);
  });

  it('会根据选择数量显示运行按钮文案', () => {
    expect(getRunButtonText([])).toBe('请选择用例');
    expect(getRunButtonText(['case-a', 'case-b'])).toBe('运行已选 2 条');
  });

  it('会根据选中 key 返回用例明细', () => {
    const cases = [makeCase('case-a'), makeCase('case-b')];

    const selectedCases = getSelectedCases(cases, ['case-b']);

    expect(selectedCases.map((item) => item.key)).toEqual(['case-b']);
  });
});

/**
 * 创建运行中心测试用例数据。
 */
function makeCase(key: string): CaseMeta {
  return {
    name: key,
    key,
    startPath: `/${key}`,
    steps: [],
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z'
  };
}

describe('运行中心实测检查展示工具', () => {
  it('最后检查时间只显示实测检查时间', () => {
    expect(formatPracticalReviewTime(undefined)).toBe('-');
    expect(formatPracticalReviewTime(makeRunCenterSummary('passed'))).toBe('2026-05-22T00:00:00.000Z');
    expect(formatPracticalReviewTime(makeRunCenterSummary('expired'))).toBe('-');
  });

  it('运行中心显示实测检查状态', () => {
    expect(formatPracticalReviewStatus(undefined)).toBe('未审查');
    expect(formatPracticalReviewStatus(makeRunCenterSummary('passed'))).toBe('通过');
    expect(getPracticalReviewTagType(makeRunCenterSummary('failed'))).toBe('danger');
  });
});

function makeRunCenterSummary(status: PracticalReviewSummary['status']): PracticalReviewSummary {
  return {
    status,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    caseSnapshotHash: 'hash-a',
    stepCount: 1,
    reviewId: status === 'expired' ? undefined : 'review-1',
    checkedAt: status === 'expired' ? undefined : '2026-05-22T00:00:00.000Z'
  };
}
