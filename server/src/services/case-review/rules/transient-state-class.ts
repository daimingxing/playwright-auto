import { createReviewItem, type ReviewRule } from '../types';

const stateClassPattern = /\.(k-hover|is-focus|is-focused|is-active|is-opened|is-expanded)\b/;

export const transientStateClassRule: ReviewRule = {
  code: 'transient-state-class',
  level: 'warning',
  title: '瞬态状态 class',
  review(context) {
    if (!stateClassPattern.test(context.selector)) {
      return [];
    }

    return [
      createReviewItem(
        transientStateClassRule,
        context,
        '选择器包含瞬态状态 class，该状态只代表录制时的鼠标或焦点状态。',
        '请去掉瞬态状态 class，改用稳定的字段、角色或文本定位。'
      )
    ];
  }
};
