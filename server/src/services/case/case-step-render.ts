import type { CaseStep } from '../../../../shared/types';
import { quoteText } from './code-literal';

/**
 * 判断 selector 是否明显指向非原生下拉控件。
 */
export function isCustomSelect(step: CaseStep) {
  const value = normalizeSelector(step.selector ?? '');

  if (step.selectorDraft || isNativeSelect(value)) {
    return false;
  }

  // 仅在 selector 自身包含 Kendo 或同类组件证据时改用点击，避免误伤原生 select 的 combobox role。
  return /\.k-(dropdownlist|picker|combobox|multiselect|dropdowntree)\b|data-role=["']?(dropdownlist|combobox)/.test(value);
}

/**
 * 判断 selector 是否明确选择原生 select 元素。
 */
export function isNativeSelect(value: string) {
  return /(^|[("'`\s>])select(\b|[#.:[\s>])/.test(value);
}

/**
 * 生成自定义下拉选项定位器。
 */
export function renderOptionLocator(value: string, pageName = 'page') {
  return `${pageName}.getByRole('option', { name: ${quote(value)} }).or(${pageName}.getByText(${quote(value)}, { exact: true })).first()`;
}

/**
 * 兼容历史数据中的页面别名前缀。
 */
export function normalizeSelector(value: string) {
  if (/^page\d+\./.test(value)) {
    return value.replace(/^page\d+\./, '');
  }

  return value;
}

/**
 * 生成安全字符串字面量。
 */
function quote(value: string) {
  return quoteText(value);
}
