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
    lines.push(...renderStep(step));
  }

  lines.push('});', '');

  return lines.join('\n');
}

/**
 * 生成单个步骤的测试代码。
 */
function renderStep(step: CaseStep) {
  const lines: string[] = [];

  if (step.opensPageAlias) {
    lines.push(`  const ${step.opensPageAlias}Promise = ${getPageName(step)}.waitForEvent('popup');`);
  }

  lines.push(renderStepAction(step));

  if (step.opensPageAlias) {
    lines.push(`  const ${step.opensPageAlias} = await ${step.opensPageAlias}Promise;`);
  }

  return lines;
}

/**
 * 生成单个步骤的核心动作代码。
 */
function renderStepAction(step: CaseStep) {
  const pageName = getPageName(step);

  switch (step.type) {
    case 'goto':
      return `  await ${pageName}.goto(${quote(step.value ?? '/')}${renderTimeoutOption(step)});`;
    case 'click':
      return `  await ${renderLocator(step.selector, '点击选择器', pageName)}.click(${renderTimeoutArg(step)});`;
    case 'rightClick':
      return `  await ${renderLocator(step.selector, '右键点击选择器', pageName)}.click(${renderRightClickArg(step)});`;
    case 'doubleClick':
      return `  await ${renderLocator(step.selector, '双击选择器', pageName)}.dblclick(${renderTimeoutArg(step)});`;
    case 'hover':
      return `  await ${renderLocator(step.selector, '悬停选择器', pageName)}.hover(${renderTimeoutArg(step)});`;
    case 'fill':
      return `  await ${renderLocator(step.selector, '输入选择器', pageName)}.fill(${quote(step.value ?? '')}${renderTimeoutOption(step)});`;
    case 'select':
      return `  await ${renderLocator(step.selector, '下拉选择器', pageName)}.selectOption(${quote(step.value ?? '')}${renderTimeoutOption(step)});`;
    case 'wait':
      // 等待时间单位是毫秒，Playwright 的 waitForTimeout 也使用毫秒。
      return `  await ${pageName}.waitForTimeout(${step.timeout ?? 1000});`;
    case 'assertText':
      return renderTextAssert(step, pageName);
    case 'assertVisible':
      return `  await expect(${renderLocator(step.selector, '可见断言选择器', pageName)}).toBeVisible();`;
    case 'assertValue':
      return `  await expect(${renderLocator(step.selector, '输入值断言选择器', pageName)}).toHaveValue(${quote(step.value ?? '')});`;
    case 'assertUrl':
      return `  await expect(${pageName}).toHaveURL(${quote(step.value ?? '')});`;
    case 'assertTitle':
      return `  await expect(${pageName}).toHaveTitle(${quote(step.value ?? '')});`;
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
function renderTextAssert(step: CaseStep, pageName: string) {
  const target = renderLocator(step.selector, '文本断言选择器', pageName);
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
function renderLocator(selector: string | undefined, name: string, pageName = 'page') {
  const value = normalizeSelector(requireText(selector, name));

  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `${pageName}.${value}`;
  }

  return `${pageName}.locator(${quote(value)})`;
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

/**
 * 兼容旧录制数据中的 page1/page2 等页面别名前缀。
 */
function normalizeSelector(value: string) {
  if (/^page\d+\./.test(value)) {
    return value.replace(/^page\d+\./, '');
  }

  return value;
}

/**
 * 获取当前步骤运行的页面变量名。
 */
function getPageName(step: CaseStep) {
  return step.pageAlias ?? 'page';
}
