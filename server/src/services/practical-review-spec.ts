import type { CaseStep } from '../../../shared/types';
import { renderLocatorExpression } from '../../../shared/locator-builder';
import { quoteText } from './code-literal';
import { renderPracticalLocator } from './practical-review-locator';

interface GenerateInput {
  startUrl: string;
  resultPath: string;
  screenshotDir: string;
  steps: CaseStep[];
}

/**
 * 生成带步骤探针的实测检查 Playwright 脚本。
 */
export function generatePracticalReviewSpec(input: GenerateInput) {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "import { mkdir, writeFile } from 'node:fs/promises';",
    '',
    'const results = [];',
    '',
    'async function writeReviewResult() {',
    `  await writeFile(${quote(input.resultPath)}, JSON.stringify({ steps: results }, null, 2), 'utf8');`,
    '}',
    '',
    'async function recordStep(step, action) {',
    '  const startedAt = new Date().toISOString();',
    '  try {',
    '    await action();',
    '    const finishedAt = new Date().toISOString();',
    "    results.push({ ...step, status: 'passed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt) });",
    '  } catch (error) {',
    '    const finishedAt = new Date().toISOString();',
    '    const message = error instanceof Error ? error.message : String(error);',
    `    await mkdir(${quote(input.screenshotDir)}, { recursive: true });`,
    `    const screenshotPath = ${quote(input.screenshotDir)} + '/' + step.stepId + '.png';`,
    '    await step.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);',
    '    results.push({',
    '      ...step,',
    "      status: 'failed',",
    '      startedAt,',
    '      finishedAt,',
    '      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),',
    '      analysis: buildFailureAnalysis(message, step.selector, screenshotPath, step.page.url())',
    '    });',
    '    await writeReviewResult();',
    '    throw error;',
    '  }',
    '}',
    '',
    'function buildFailureAnalysis(message, selector, screenshotPath, currentUrl) {',
    "  const code = message.includes('strict mode violation') ? 'multiple-match' : message.includes('Timeout') ? 'timeout' : 'unknown';",
    '  return {',
    '    code,',
    "    message: code === 'multiple-match' ? '定位匹配到多个元素' : code === 'timeout' ? '等待目标元素超时' : '步骤执行失败',",
    "    suggestion: code === 'multiple-match' ? '请补充更具体的可访问名称、文本或父级范围。' : '请检查页面状态、定位表达式和等待时间。',",
    '    currentUrl,',
    '    selector,',
    "    artifacts: [{ type: 'screenshot', path: screenshotPath, url: screenshotPath }]",
    '  };',
    '}',
    '',
    "test('实测检查', async ({ page }) => {",
    `  await page.goto(${quote(input.startUrl)});`
  ];

  for (const [index, step] of input.steps.entries()) {
    lines.push(...renderStep(step, index));
  }

  lines.push('  await writeReviewResult();', '});', '');

  return lines.join('\n');
}

function renderStep(step: CaseStep, index: number) {
  const meta = `{ stepId: ${quote(step.id)}, stepIndex: ${index}, stepType: ${quote(step.type)}, selector: ${quote(step.selector ?? '')}, page }`;

  switch (step.type) {
    case 'click':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.click(${renderTimeoutArg(step)}));`];
    case 'rightClick':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.click(${renderRightClickArg(step)}));`];
    case 'doubleClick':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.dblclick(${renderTimeoutArg(step)}));`];
    case 'hover':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.hover(${renderTimeoutArg(step)}));`];
    case 'fill':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.fill(${quote(step.value ?? '')}${renderTimeoutOption(step)}));`];
    case 'select':
      return [`  await recordStep(${meta}, async () => ${renderStepLocator(step)}.selectOption(${quote(step.value ?? '')}${renderTimeoutOption(step)}));`];
    case 'assertVisible':
      return [`  await recordStep(${meta}, async () => expect(${renderStepLocator(step)}).toBeVisible());`];
    case 'assertText':
      return [`  await recordStep(${meta}, async () => expect(${renderStepLocator(step)}).toContainText(${quote(step.value ?? '')}));`];
    case 'assertValue':
      return [`  await recordStep(${meta}, async () => expect(${renderStepLocator(step)}).toHaveValue(${quote(step.value ?? '')}));`];
    case 'goto':
      return [`  await recordStep(${meta}, async () => page.goto(${quote(step.value ?? '/')}${renderTimeoutOption(step)}));`];
    case 'wait':
      return [`  await recordStep(${meta}, async () => page.waitForTimeout(${step.timeout ?? 1000}));`];
    case 'assertUrl':
      return [`  await recordStep(${meta}, async () => expect(page).toHaveURL(${quote(step.value ?? '')}));`];
    case 'assertTitle':
      return [`  await recordStep(${meta}, async () => expect(page).toHaveTitle(${quote(step.value ?? '')}));`];
    default:
      return [`  await recordStep(${meta}, async () => undefined);`];
  }
}

/**
 * 根据结构化草稿或历史 selector 生成实测检查定位表达式。
 */
function renderStepLocator(step: CaseStep) {
  if (step.selectorDraft) {
    return renderLocatorExpression(step.selectorDraft, 'page');
  }

  return renderPracticalLocator(step.selector);
}

function renderTimeoutArg(step: CaseStep) {
  return step.timeout === undefined ? '' : `{ timeout: ${step.timeout} }`;
}

function renderRightClickArg(step: CaseStep) {
  return step.timeout === undefined ? `{ button: 'right' }` : `{ button: 'right', timeout: ${step.timeout} }`;
}

function renderTimeoutOption(step: CaseStep) {
  return step.timeout === undefined ? '' : `, { timeout: ${step.timeout} }`;
}

function quote(value: string) {
  return quoteText(value);
}
