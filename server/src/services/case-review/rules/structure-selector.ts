import { createReviewItem, type ReviewRule } from '../types';

const orderSelectorPattern = /:(nth-child|nth-of-type)\(/;
const longDomPathPattern = /(?:^|['"`])(?:[a-z][\w-]*[.#:\w\s>-]*){1,}/i;

export const structureSelectorRule: ReviewRule = {
  code: 'structure-selector',
  level: 'warning',
  title: '结构顺序选择器',
  review(context) {
    if (!isStructureSelector(context.selector)) {
      return [];
    }

    return [
      createReviewItem(
        structureSelectorRule,
        context,
        '选择器依赖页面结构顺序，布局调整后容易失效。',
        '请改用字段标签、按钮名称、可见文本或角色名称定位。'
      )
    ];
  }
};

/**
 * 判断选择器是否明显依赖 DOM 结构。
 */
function isStructureSelector(selector: string) {
  if (orderSelectorPattern.test(selector)) {
    return true;
  }

  const childSegments = selector.split('>').length - 1;

  return childSegments >= 4 && longDomPathPattern.test(selector);
}
