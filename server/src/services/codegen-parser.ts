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

  walk(source, (node) => {
    const step = parseAwaitStep(node, source);

    if (step) {
      steps.push({
        ...step,
        id: crypto.randomUUID()
      });
    }
  });

  return { steps };
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
function parseAwaitStep(node: ts.Node, source: ts.SourceFile): Omit<CaseStep, 'id'> | null {
  if (!ts.isExpressionStatement(node) || !ts.isAwaitExpression(node.expression)) {
    return null;
  }

  const call = unwrapCall(node.expression.expression);
  if (!call || !ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const method = call.expression.name.text;
  const target = call.expression.expression;

  if (method === 'goto') {
    return { type: 'goto', value: readTextArg(call, 0) ?? '/', timeout: 10000 };
  }

  if (method === 'click') {
    if (hasRightButton(call)) {
      return { type: 'rightClick', selector: readSelector(target, source), timeout: 1000 };
    }

    return { type: 'click', selector: readSelector(target, source), timeout: 1000 };
  }

  if (method === 'dblclick') {
    return { type: 'doubleClick', selector: readSelector(target, source), timeout: 1000 };
  }

  if (method === 'hover') {
    return { type: 'hover', selector: readSelector(target, source), timeout: 1000 };
  }

  if (method === 'fill') {
    return { type: 'fill', selector: readSelector(target, source), value: readTextArg(call, 0) ?? '', timeout: 1000 };
  }

  if (method === 'selectOption') {
    return {
      type: 'select',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      timeout: 1000
    };
  }

  return parseExpectStep(call, source);
}

/**
 * 解析 expect 断言语句。
 */
function parseExpectStep(call: ts.CallExpression, source: ts.SourceFile): Omit<CaseStep, 'id'> | null {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const matcher = call.expression.name.text;
  const expectCall = unwrapCall(call.expression.expression);

  if (!expectCall || !isExpectCall(expectCall)) {
    return null;
  }

  const target = expectCall.arguments[0];

  if (matcher === 'toBeVisible') {
    return { type: 'assertVisible', selector: readSelector(target, source) };
  }

  if (matcher === 'toContainText') {
    return {
      type: 'assertText',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      match: 'contains'
    };
  }

  if (matcher === 'toHaveText') {
    return {
      type: 'assertText',
      selector: readSelector(target, source),
      value: readTextArg(call, 0) ?? '',
      match: 'equals'
    };
  }

  if (matcher === 'toHaveValue') {
    return { type: 'assertValue', selector: readSelector(target, source), value: readTextArg(call, 0) ?? '' };
  }

  if (matcher === 'toHaveURL') {
    return { type: 'assertUrl', value: readExpectValue(call, source) };
  }

  if (matcher === 'toHaveTitle') {
    return { type: 'assertTitle', value: readExpectValue(call, source) };
  }

  return null;
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

  return text;
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
