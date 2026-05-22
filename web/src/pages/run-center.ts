import type { CaseMeta, PracticalReviewSummary } from '../../../shared/types';

/**
 * 合并用例列表和当前选择，首次加载时默认选中全部用例。
 */
export function mergeSelectedCaseKeys(cases: CaseMeta[], selectedKeys: string[]) {
  if (selectedKeys.length === 0) {
    return cases.map((item) => item.key);
  }

  const caseKeys = new Set(cases.map((item) => item.key));

  return selectedKeys.filter((key) => caseKeys.has(key));
}

/**
 * 判断当前是否可以开始运行测试。
 */
export function canStartRun(hasAuth: boolean, selectedKeys: string[], running: boolean) {
  return hasAuth && selectedKeys.length > 0 && !running;
}

/**
 * 生成运行按钮文案。
 */
export function getRunButtonText(selectedKeys: string[]) {
  return selectedKeys.length > 0 ? `运行已选 ${selectedKeys.length} 条` : '请选择用例';
}

/**
 * 按选中 key 读取用例明细。
 */
export function getSelectedCases(cases: CaseMeta[], selectedKeys: string[]) {
  const selectedSet = new Set(selectedKeys);

  return cases.filter((item) => selectedSet.has(item.key));
}

/**
 * 显示实测检查摘要状态。
 */
export function formatPracticalReviewStatus(summary: PracticalReviewSummary | undefined) {
  if (!summary || summary.status === 'untested') {
    return '未审查';
  }

  const labels: Record<PracticalReviewSummary['status'], string> = {
    untested: '未审查',
    running: '检查中',
    passed: '通过',
    failed: '失败',
    expired: '过期'
  };

  return labels[summary.status];
}

/**
 * 显示实测检查摘要标签类型。
 */
export function getPracticalReviewTagType(summary: PracticalReviewSummary | undefined) {
  if (!summary) {
    return 'info';
  }

  const types: Record<PracticalReviewSummary['status'], 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    untested: 'info',
    running: 'primary',
    passed: 'success',
    failed: 'danger',
    expired: 'warning'
  };

  return types[summary.status];
}

/**
 * 显示最近一次实测检查时间。
 */
export function formatPracticalReviewTime(summary: PracticalReviewSummary | undefined) {
  return summary?.checkedAt ?? '-';
}
