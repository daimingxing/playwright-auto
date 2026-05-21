import type { CaseMeta, CaseReview, CaseReviewItem, CaseStep, StepType } from '../../../../shared/types';
import { createReviewSummary, formatReviewSummary } from './summary';
import { reviewRules } from './rules';

const reviewStepTypes = new Set<StepType>([
  'click',
  'rightClick',
  'doubleClick',
  'hover',
  'fill',
  'select',
  'assertVisible',
  'assertText',
  'assertValue'
]);

export { createReviewSummary, formatReviewSummary };

/**
 * 静态审查用例中的元素定位步骤。
 */
export function reviewCase(item: CaseMeta): CaseReview {
  const items = item.steps.flatMap((step, index) => reviewStep(step, index));

  return {
    summary: createReviewSummary(items),
    items,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 静态审查单个步骤的元素定位质量。
 */
function reviewStep(step: CaseStep, stepIndex: number): CaseReviewItem[] {
  if (!shouldReviewStep(step) || !step.selector) {
    return [];
  }

  return reviewRules.flatMap((rule) =>
    rule.review({
      step,
      stepIndex,
      selector: step.selector ?? ''
    })
  );
}

/**
 * 判断步骤是否依赖元素定位。
 */
function shouldReviewStep(step: CaseStep) {
  return reviewStepTypes.has(step.type);
}
