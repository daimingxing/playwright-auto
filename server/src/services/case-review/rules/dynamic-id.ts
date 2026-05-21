import { createReviewItem, type ReviewRule } from '../types';

const uuidIdPattern = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export const dynamicIdRule: ReviewRule = {
  code: 'dynamic-id',
  level: 'error',
  title: '动态 UUID id',
  review(context) {
    if (!uuidIdPattern.test(context.selector)) {
      return [];
    }

    return [
      createReviewItem(
        dynamicIdRule,
        context,
        '选择器使用动态 UUID id，重放时该 id 可能不存在。',
        '请改用弹窗标题、字段标签、按钮名称、可见文本或稳定业务属性定位。'
      )
    ];
  }
};
