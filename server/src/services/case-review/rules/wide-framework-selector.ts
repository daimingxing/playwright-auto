import { createReviewItem, type ReviewRule } from '../types';

const frameworkClassPattern = /\.(k-picker|k-dropdownlist|el-select|ant-select)\b/;
const semanticAnchorPattern = /(getBy(Label|Role|Text|Placeholder)|hasText|name\s*:)/;

export const wideFrameworkSelectorRule: ReviewRule = {
  code: 'wide-framework-selector',
  level: 'danger',
  title: '宽泛框架控件选择器',
  review(context) {
    if (!frameworkClassPattern.test(context.selector) || semanticAnchorPattern.test(context.selector)) {
      return [];
    }

    return [
      createReviewItem(
        wideFrameworkSelectorRule,
        context,
        '选择器只描述通用框架控件，页面存在多个相似控件时可能点错元素。',
        '请使用弹窗标题加字段名称定位目标控件，例如先限定弹窗或区域，再定位目标字段。'
      )
    ];
  }
};
