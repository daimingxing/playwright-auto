import type { CaseMeta, CaseReview, CaseStep } from '../../../../shared/types';
import { reviewCase } from '../case-review';

/**
 * 把 AI 草稿转成基础检查结果，统一 worker 与分组生成路径。
 */
export function buildDraftReview(draft: { name: string; startPath: string; steps: CaseStep[] }): CaseReview {
  return reviewCase(createReviewCase(draft));
}

/**
 * 创建用于基础检查的临时用例对象。
 */
function createReviewCase(draft: { name: string; startPath: string; steps: CaseStep[] }): CaseMeta {
  const now = new Date().toISOString();

  return {
    name: draft.name,
    key: 'ai-import-draft',
    status: 'draft',
    startPath: draft.startPath,
    steps: draft.steps,
    createdAt: now,
    updatedAt: now
  };
}
