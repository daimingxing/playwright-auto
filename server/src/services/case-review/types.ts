import type { CaseReviewItem, CaseStep, ReviewLevel } from '../../../../shared/types';

export interface ReviewContext {
  step: CaseStep;
  stepIndex: number;
  selector: string;
}

export interface ReviewRule {
  code: string;
  level: ReviewLevel;
  title: string;
  review(context: ReviewContext): CaseReviewItem[];
}

/**
 * 创建单条用例审查结果。
 */
export function createReviewItem(
  rule: ReviewRule,
  context: ReviewContext,
  message: string,
  suggestion: string
): CaseReviewItem {
  return {
    id: `${context.step.id}-${rule.code}`,
    stepId: context.step.id,
    stepIndex: context.stepIndex,
    stepType: context.step.type,
    selector: context.selector,
    level: rule.level,
    ruleCode: rule.code,
    message,
    suggestion
  };
}
