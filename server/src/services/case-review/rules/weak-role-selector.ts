import { createReviewItem, type ReviewRule } from '../types';

const roleWithoutNamePattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*\)/;
const parentAnchorPattern = /getBy(Label|Text|Placeholder)\(|locator\([^)]*hasText|filter\(\s*\{\s*hasText/;

export const weakRoleSelectorRule: ReviewRule = {
  code: 'weak-role-selector',
  level: 'warning',
  title: '弱角色定位',
  review(context) {
    if (!roleWithoutNamePattern.test(context.selector) || parentAnchorPattern.test(context.selector)) {
      return [];
    }

    return [
      createReviewItem(
        weakRoleSelectorRule,
        context,
        '角色定位缺少名称或区域约束，页面存在多个同类元素时可能点错。',
        '请为角色定位增加 name，或先限定弹窗、区域、字段标签。'
      )
    ];
  }
};
