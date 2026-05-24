import type { CaseMeta, PracticalReviewSummary } from '../../../shared/types';
import { resolveApiUrl } from '../api/http';
import { formatDateTime } from '../utils/time';
import { getCaseCheckStatus } from './case-editor';

/**
 * 合并用例列表和当前选择，首次加载时默认选中全部用例。
 */
export function mergeSelectedCaseKeys(cases: CaseMeta[], selectedKeys: string[]) {
  const runnableCases = cases.filter(isRunnableCase);

  if (selectedKeys.length === 0) {
    return runnableCases.map((item) => item.key);
  }

  const caseKeys = new Set(runnableCases.map((item) => item.key));

  return selectedKeys.filter((key) => caseKeys.has(key));
}

/**
 * 判断当前是否可以开始运行测试。
 */
export function canStartRun(hasAuth: boolean, selectedKeys: string[], running: boolean) {
  void hasAuth;

  return selectedKeys.length > 0 && !running;
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
 * 从表格多选行中读取用例 key。
 */
export function getSelectedKeys(rows: CaseMeta[]) {
  return rows.map((row) => row.key);
}

/**
 * 判断用例是否允许进入运行中心。
 */
export function isRunnableCase(item: CaseMeta) {
  return item.status === 'active' && getCaseCheckStatus(item) !== 'review-failed' && getCaseCheckStatus(item) !== 'unchecked';
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
  return formatDateTime(summary?.checkedAt);
}

/**
 * 显示测试报告创建时间。
 */
export function formatRunCreatedTime(value?: string) {
  return formatDateTime(value);
}

/**
 * 解析测试报告打开地址。
 */
export function getReportUrl(url: string, apiBase?: string) {
  return url ? resolveApiUrl(url, apiBase) : '';
}
