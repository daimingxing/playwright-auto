import { renderLocatorExpression, type LocatorBuilderState } from '../../../../shared/locator-builder';
import type { IntentStep, VerifiedLocator } from '../../../../shared/types';

const MAIN_PAGE_ALIAS = 'page';
const SEMANTIC_LOCATOR_MODES = new Set<LocatorBuilderState['mode']>([
  'role',
  'text',
  'label',
  'placeholder',
  'testId',
  'title',
  'altText'
]);

/**
 * 按业务动作构造 Fake 探索定位器。仅 Fake runner 使用，正式编译不得再猜测。
 */
export function createFakeExplorationLocator(step: IntentStep): VerifiedLocator | null {
  switch (step.action) {
    case '打开页面':
      return null;
    case '填写':
      return createSemanticLocator('label', step.target);
    case '选择':
      return createSemanticLocator('role', step.target, 'combobox');
    case '点击':
      return createSemanticLocator('role', step.target, 'button');
    case '检查可见':
    case '检查文本':
      return createSemanticLocator('text', step.target);
  }
}

/**
 * 把意图步骤转成 Fake 探索定位器表，跳过打开页面和空目标。
 */
export function createFakeExplorationLocators(steps: IntentStep[]): Record<string, VerifiedLocator> {
  const locators: Record<string, VerifiedLocator> = {};

  for (const step of steps) {
    const locator = createFakeExplorationLocator(step);

    if (locator) {
      locators[step.id] = locator;
    }
  }

  return locators;
}

/**
 * 把 Agent 候选中的定位器规范为已验证结构；非法项丢弃。
 */
export function normalizeExplorationLocators(value: unknown): Record<string, VerifiedLocator> {
  if (!isRecord(value)) {
    return {};
  }

  const locators: Record<string, VerifiedLocator> = {};

  for (const [stepId, raw] of Object.entries(value)) {
    const locator = normalizeLocator(raw);

    if (locator) {
      locators[stepId] = locator;
    }
  }

  return locators;
}

/**
 * 按步骤顺序把数组形态的探索定位器对齐到意图步骤。
 */
export function assignLocatorsByOrder(steps: IntentStep[], raw: unknown): Record<string, VerifiedLocator> {
  if (Array.isArray(raw)) {
    const locators: Record<string, VerifiedLocator> = {};

    for (const [index, step] of steps.entries()) {
      const locator = normalizeLocator(raw[index]);

      if (locator) {
        locators[step.id] = locator;
      }
    }

    return locators;
  }

  const byId = normalizeExplorationLocators(raw);

  if (steps.some((step) => byId[step.id])) {
    return byId;
  }

  if (!isRecord(raw)) {
    return {};
  }

  const locators: Record<string, VerifiedLocator> = {};
  const values = Object.values(raw);

  for (const [index, step] of steps.entries()) {
    const locator = normalizeLocator(values[index]);

    if (locator) {
      locators[step.id] = locator;
    }
  }

  return locators;
}

/**
 * 判断定位器是否带有可发布的语义结构，而不是未验证的 CSS 猜测。
 */
export function isVerifiedLocator(
  locator: { selector?: string; selectorDraft?: LocatorBuilderState } | undefined
): locator is VerifiedLocator {
  const draft = locator?.selectorDraft;

  if (!draft || !SEMANTIC_LOCATOR_MODES.has(draft.mode)) {
    return false;
  }

  const text = typeof draft.value === 'string' ? draft.value : draft.value?.text;
  return Boolean(text?.trim()) && Boolean(locator?.selector?.trim());
}

/**
 * 从用户提供的目标文本构造结构化语义定位器，不猜测 CSS。
 */
export function createSemanticLocator(
  mode: Extract<LocatorBuilderState['mode'], 'role' | 'text' | 'label'>,
  target: string,
  role?: string
): VerifiedLocator | null {
  const text = target.trim();

  if (!text) {
    return null;
  }

  const selectorDraft: LocatorBuilderState = {
    mode,
    value: { kind: 'text', text },
    exact: true,
    ...(role ? { role } : {})
  };

  return {
    selectorDraft,
    selector: toSelector(selectorDraft)
  };
}

/**
 * 把未知候选规范成已验证定位器。
 */
function normalizeLocator(value: unknown): VerifiedLocator | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isVerifiedLocator({ selector: String(value.selector ?? ''), selectorDraft: value.selectorDraft as LocatorBuilderState })) {
    return {
      selector: String(value.selector),
      selectorDraft: value.selectorDraft as LocatorBuilderState
    };
  }

  const mode = typeof value.mode === 'string' ? value.mode : '';
  const text = readLocatorText(value);

  if (!text || !isSemanticMode(mode)) {
    return null;
  }

  return createSemanticLocator(mode, text, typeof value.role === 'string' ? value.role : undefined);
}

/**
 * 把构建器状态渲染为不含页面前缀的 selector 字符串。
 */
function toSelector(draft: LocatorBuilderState) {
  const expression = renderLocatorExpression(draft, MAIN_PAGE_ALIAS);
  return expression.startsWith(`${MAIN_PAGE_ALIAS}.`)
    ? expression.slice(MAIN_PAGE_ALIAS.length + 1)
    : expression;
}

/**
 * 读取候选定位器中的可见文本。
 */
function readLocatorText(value: Record<string, unknown>) {
  if (typeof value.text === 'string' && value.text.trim()) {
    return value.text.trim();
  }

  if (typeof value.value === 'string' && value.value.trim()) {
    return value.value.trim();
  }

  if (isRecord(value.value) && typeof value.value.text === 'string') {
    return value.value.text.trim();
  }

  return '';
}

/**
 * 判断模式是否属于可发布的语义定位。
 */
function isSemanticMode(mode: string): mode is Extract<LocatorBuilderState['mode'], 'role' | 'text' | 'label'> {
  return mode === 'role' || mode === 'text' || mode === 'label';
}

/**
 * 判断未知值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
