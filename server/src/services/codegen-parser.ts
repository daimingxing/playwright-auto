import ts from 'typescript';
import type { CaseStep } from '../../../shared/types';

export interface ParseResult {
  steps: CaseStep[];
}

/**
 * 解析 Playwright codegen 生成的测试脚本。
 */
export function parseCodegenSpec(code: string): ParseResult {
  const source = ts.createSourceFile('record.spec.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const steps: CaseStep[] = [];
  const state: ParseState = {
    popupPromises: new Map(),
    pendingPopupAlias: ''
  };

  walk(source, (node) => {
    updatePopupState(node, state);

    const step = parseAwaitStep(node, source, state);

    if (step) {
      steps.push({
        ...step,
        id: crypto.randomUUID()
      });
    }
  });

  return { steps };
}

interface ParseState {
  popupPromises: Map<string, string>;
  pendingPopupAlias: string;
}

/**
 * 遍历 TypeScript 语法树。
 */
function walk(node: ts.Node, visitor: (node: ts.Node) => void) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

/**
 * 解析单条 await 语句。
 */
function parseAwaitStep(node: ts.Node, source: ts.SourceFile, state: ParseState): Omit<CaseStep, 'id'> | null {
  if (!ts.isExpressionStatement(node) || !ts.isAwaitExpression(node.expression)) {
    return null;
  }

  const call = unwrapCall(node.expression.expression);
  if (!call || !ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const method = call.expression.name.text;
  const target = call.expression.expression;
  const pageAlias = readPageAlias(target);
  const extra = createStepMeta(pageAlias, state);

  if (method === 'goto') {
    return { type: 'goto', value: readTextArg(call, 0) ?? '/', timeout: 20000, ...extra };
  }

  if (method === 'click') {
    if (hasRightButton(call)) {
      return { type: 'rightClick', selector: readSelector(target, source), timeout: 2000, ...extra };
    }

    return { type: 'click', selector: readSelector(target, source), timeout: 2000, ...extra };
  }

  if (method === 'dblclick') {
    return { type: 'doubleClick', selector: readSelector(target, source), timeout: 2000, ...extra };
  }

  if (method === 'hover') {
    return { type: 'hover', selector: readSelector(target, source), timeout: 2000, ...extra };
  }

  if (method === 'fill') {
    return { type: 'fill', selector: readSelector(target, source), value: readTextArg(call, 0) ?? '', timeout: 2000, ...extra };
  }

  if (method === 'selectOption') {
    return {
      type: 'select',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      timeout: 2000,
      ...extra
    };
  }

  return parseExpectStep(call, source, state);
}

/**
 * 解析 expect 断言语句。
 */
function parseExpectStep(call: ts.CallExpression, source: ts.SourceFile, state: ParseState): Omit<CaseStep, 'id'> | null {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const matcher = call.expression.name.text;
  const expectCall = unwrapCall(call.expression.expression);

  if (!expectCall || !isExpectCall(expectCall)) {
    return null;
  }

  const target = expectCall.arguments[0];
  const pageAlias = readPageAlias(target);
  const extra = createStepMeta(pageAlias, state);

  if (matcher === 'toBeVisible') {
    return { type: 'assertVisible', selector: readSelector(target, source), ...extra };
  }

  if (matcher === 'toContainText') {
    return {
      type: 'assertText',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      match: 'contains',
      ...extra
    };
  }

  if (matcher === 'toHaveText') {
    return {
      type: 'assertText',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      match: 'equals',
      ...extra
    };
  }

  if (matcher === 'toHaveValue') {
    return { type: 'assertValue', selector: readSelector(target, source), value: readTextArg(call, 0) ?? '', ...extra };
  }

  if (matcher === 'toHaveURL') {
    return { type: 'assertUrl', value: readExpectValue(call, source), ...extra };
  }

  if (matcher === 'toHaveTitle') {
    return { type: 'assertTitle', value: readExpectValue(call, source), ...extra };
  }

  return null;
}

/**
 * 追踪 codegen 生成的新标签页 promise 和页面变量。
 */
function updatePopupState(node: ts.Node, state: ParseState) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
    return;
  }

  const init = node.initializer;

  if (init && isWaitForPopupCall(init)) {
    state.popupPromises.set(node.name.text, node.name.text.replace(/Promise$/, ''));
    state.pendingPopupAlias = node.name.text.replace(/Promise$/, '');
    return;
  }

  if (init && ts.isAwaitExpression(init) && ts.isIdentifier(init.expression)) {
    const alias = state.popupPromises.get(init.expression.text);

    if (alias) {
      state.popupPromises.set(init.expression.text, node.name.text);
      state.pendingPopupAlias = '';
    }
  }
}

/**
 * 判断表达式是否为 page.waitForEvent('popup')。
 */
function isWaitForPopupCall(node: ts.Expression) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }

  const target = node.expression.expression;

  return (
    node.expression.name.text === 'waitForEvent' &&
    ts.isIdentifier(target) &&
    /^page\d*$/.test(target.text) &&
    readTextArg(node, 0) === 'popup'
  );
}

/**
 * 根据页面变量生成步骤元信息。
 */
function createStepMeta(pageAlias: string, state: ParseState) {
  const meta: Pick<CaseStep, 'pageAlias' | 'opensPageAlias'> = {};

  if (pageAlias && pageAlias !== 'page') {
    meta.pageAlias = pageAlias;
  }

  if (state.pendingPopupAlias) {
    meta.opensPageAlias = state.pendingPopupAlias;
  }

  return meta;
}

/**
 * 读取调用表达式中的文本参数。
 */
function readTextArg(call: ts.CallExpression, index: number) {
  const arg = call.arguments[index];

  if (!arg) {
    return undefined;
  }

  if (ts.isStringLiteralLike(arg)) {
    return arg.text;
  }

  return undefined;
}

/**
 * 判断 click 调用是否为右键点击。
 */
function hasRightButton(call: ts.CallExpression) {
  const arg = call.arguments[0];

  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return false;
  }

  return arg.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      return false;
    }

    if (property.name.text !== 'button') {
      return false;
    }

    // codegen 的右键写法是 click({ button: 'right' })。
    return ts.isStringLiteralLike(property.initializer) && property.initializer.text === 'right';
  });
}

/**
 * 读取 expect 匹配器中的期望值。
 */
function readExpectValue(call: ts.CallExpression, source: ts.SourceFile) {
  const arg = call.arguments[0];

  if (!arg) {
    return '';
  }

  if (ts.isStringLiteralLike(arg)) {
    return arg.text;
  }

  return arg.getText(source);
}

/**
 * 读取 Playwright locator 表达式。
 */
function readSelector(node: ts.Node | undefined, source: ts.SourceFile) {
  if (!node) {
    return '';
  }

  const text = node.getText(source);

  if (text.startsWith('page.')) {
    return text.slice('page.'.length);
  }

  if (/^page\d+\./.test(text)) {
    return text.replace(/^page\d+\./, '');
  }

  return text;
}

/**
 * 读取 locator 所属的页面变量名。
 */
function readPageAlias(node: ts.Node | undefined): string {
  if (!node) {
    return '';
  }

  let current: ts.Node = node;

  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }

    current = current.expression;
  }

  return ts.isIdentifier(current) ? current.text : '';
}

/**
 * 判断调用表达式是否为 expect(...)。
 */
function isExpectCall(call: ts.CallExpression) {
  return ts.isIdentifier(call.expression) && call.expression.text === 'expect';
}

/**
 * 解开链式表达式中的调用节点。
 */
function unwrapCall(node: ts.Expression): ts.CallExpression | null {
  if (ts.isCallExpression(node)) {
    return node;
  }

  return null;
}
