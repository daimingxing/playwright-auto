/**
 * 将保存的定位表达式渲染为当前页面可执行的 Playwright 表达式。
 */
export function renderPracticalLocator(selector: string | undefined, pageName = 'page') {
  if (!selector) {
    throw new Error('定位不能为空');
  }

  const value = selector.replace(/^page\d+\./, '');

  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `${pageName}.${value}`;
  }

  return `${pageName}.locator(${JSON.stringify(value)})`;
}
