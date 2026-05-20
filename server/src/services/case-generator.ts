import type { CaseMeta, CaseStep } from '../../../shared/types';

/**
 * 生成 Playwright TypeScript 测试文件。
 */
export function generateSpec(item: CaseMeta) {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    '',
    `test(${quote(item.name)}, async ({ page }) => {`,
    `  await page.goto(${quote(item.startPath)});`
  ];

  for (const step of item.steps) {
    lines.push(renderStep(step));
  }

  lines.push('});', '');

  return lines.join('\n');
}

/**
 * 生成单个步骤的测试代码。
 */
function renderStep(step: CaseStep) {
  switch (step.type) {
    case 'goto':
      return `  await page.goto(${quote(step.value ?? '/')}${renderTimeoutOption(step)});`;
    case 'click':
      return `  await ${renderLocator(step.selector, '点击选择器')}.click(${renderTimeoutArg(step)});`;
    case 'rightClick':
      return `  await ${renderLocator(step.selector, '右键点击选择器')}.click(${renderRightClickArg(step)});`;
    case 'doubleClick':
      return `  await ${renderLocator(step.selector, '双击选择器')}.dblclick(${renderTimeoutArg(step)});`;
    case 'hover':
      return `  await ${renderLocator(step.selector, '悬停选择器')}.hover(${renderTimeoutArg(step)});`;
    case 'fill':
      return `  await ${renderLocator(step.selector, '输入选择器')}.fill(${quote(step.value ?? '')}${renderTimeoutOption(step)});`;
    case 'select':
      return `  await ${renderLocator(step.selector, '下拉选择器')}.selectOption(${quote(step.value ?? '')}${renderTimeoutOption(step)});`;
    case 'wait':
      // 等待时间单位是毫秒，Playwright 的 waitForTimeout 也使用毫秒。
      return `  await page.waitForTimeout(${step.timeout ?? 1000});`;
    case 'assertText':
      return renderTextAssert(step);
    case 'assertVisible':
      return `  await expect(${renderLocator(step.selector, '可见断言选择器')}).toBeVisible();`;
    case 'assertValue':
      return `  await expect(${renderLocator(step.selector, '输入值断言选择器')}).toHaveValue(${quote(step.value ?? '')});`;
    case 'assertUrl':
      return `  await expect(page).toHaveURL(${quote(step.value ?? '')});`;
    case 'assertTitle':
      return `  await expect(page).toHaveTitle(${quote(step.value ?? '')});`;
    default:
      return `  // 暂不支持的步骤类型：${String(step.type)}`;
  }
}

/**
 * 生成只有超时配置的动作参数。
 */
function renderTimeoutArg(step: CaseStep) {
  if (step.timeout === undefined) {
    return '';
  }

  return `{ timeout: ${step.timeout} }`;
}

/**
 * 生成右键点击参数。
 */
function renderRightClickArg(step: CaseStep) {
  if (step.timeout === undefined) {
    return `{ button: 'right' }`;
  }

  return `{ button: 'right', timeout: ${step.timeout} }`;
}

/**
 * 生成追加到已有动作参数后的超时配置。
 */
function renderTimeoutOption(step: CaseStep) {
  if (step.timeout === undefined) {
    return '';
  }

  return `, { timeout: ${step.timeout} }`;
}

/**
 * 生成文本断言代码。
 */
function renderTextAssert(step: CaseStep) {
  const target = renderLocator(step.selector, '文本断言选择器');
  const value = step.value ?? '';

  if (step.match === 'equals') {
    return `  await expect(${target}).toHaveText(${quote(value)});`;
  }

  if (step.match === 'regex') {
    return `  await expect(${target}).toContainText(new RegExp(${quote(value)}));`;
  }

  return `  await expect(${target}).toContainText(${quote(value)});`;
}

/**
 * 生成 Playwright locator 表达式。
 */
function renderLocator(selector: string | undefined, name: string) {
  const value = requireText(selector, name);

  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `page.${value}`;
  }

  return `page.locator(${quote(value)})`;
}

/**
 * 生成安全字符串字面量。
 */
function quote(value: string) {
  return JSON.stringify(value).replace(/^"|"$/g, "'");
}

/**
 * 要求字段必须存在。
 */
function requireText(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name}不能为空`);
  }

  return value;
}
