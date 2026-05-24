import type { CaseMeta, CaseReview, CheckStatus } from '../../../../shared/types';
import { reviewCaseIntegrity } from '../../../../shared/case-review';
import { createReviewSummary, formatReviewSummary } from './summary';

export { createReviewSummary, formatReviewSummary };

/**
 * 基础检查用例结构和元素定位质量。
 */
export function reviewCase(item: CaseMeta): CaseReview {
  const items = reviewCaseIntegrity(item);

  return {
    summary: createReviewSummary(items),
    items,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 判断基础检查结果是否允许待启用或启用。
 */
export function isReviewPassed(review: CaseReview | undefined) {
  if (!review) {
    return false;
  }

  return review.summary.error === 0 && review.summary.danger === 0;
}

/**
 * 合成列表页展示的检查状态。
 */
export function getCaseCheckStatus(item: Pick<CaseMeta, 'review' | 'practicalReview'>): CheckStatus {
  if (!item.review) {
    return 'unchecked';
  }

  if (!isReviewPassed(item.review)) {
    return 'review-failed';
  }

  if (item.practicalReview?.status === 'passed') {
    return 'practical-passed';
  }

  if (item.practicalReview?.status === 'failed') {
    return 'practical-failed';
  }

  return 'pending-practical';
}
