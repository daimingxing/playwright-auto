import { quoteText } from './code-literal';

/**
 * 规范化实测检查用的定位表达式。
 */
export function normalizePracticalSelector(selector: string) {
  return selector.replace(/^page\d+\./, '');
}

/**
 * 将保存的定位表达式渲染为当前页面可执行的 Playwright 表达式。
 */
export function renderPracticalLocator(selector: string | undefined, pageName = 'page') {
  if (!selector) {
    throw new Error('定位不能为空');
  }

  const value = normalizePracticalSelector(selector);

  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `${pageName}.${value}`;
  }

  return `${pageName}.locator(${quote(value)})`;
}

function quote(value: string) {
  return quoteText(value);
}
