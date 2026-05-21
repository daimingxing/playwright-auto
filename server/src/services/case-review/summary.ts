import type { CaseReviewItem, CaseReviewSummary, ReviewLevel } from '../../../../shared/types';

const labels: Record<ReviewLevel, string> = {
  error: '错误',
  danger: '高危',
  warning: '警告',
  info: '提示'
};

/**
 * 聚合用例审查结果摘要。
 */
export function createReviewSummary(items: CaseReviewItem[]): CaseReviewSummary {
  const summary: CaseReviewSummary = {
    level: 'pass',
    error: 0,
    danger: 0,
    warning: 0,
    info: 0
  };

  for (const item of items) {
    summary[item.level] += 1;
  }

  if (summary.error > 0) {
    summary.level = 'error';
  } else if (summary.danger > 0) {
    summary.level = 'danger';
  } else if (summary.warning > 0) {
    summary.level = 'warning';
  } else if (summary.info > 0) {
    summary.level = 'info';
  }

  return summary;
}

/**
 * 格式化列表页用例审查摘要。
 */
export function formatReviewSummary(summary: CaseReviewSummary | undefined) {
  if (!summary) {
    return '未审查';
  }

  const parts = (['error', 'danger', 'warning', 'info'] as ReviewLevel[])
    .filter((level) => summary[level] > 0)
    .map((level) => `${labels[level]} ${summary[level]}`);

  return parts.length > 0 ? parts.join(' / ') : '通过';
}
