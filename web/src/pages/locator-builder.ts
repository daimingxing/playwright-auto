export type LocatorMode =
  | 'role'
  | 'text'
  | 'label'
  | 'placeholder'
  | 'testId'
  | 'title'
  | 'altText'
  | 'css'
  | 'advanced';

export interface LocatorBuilderState {
  mode: LocatorMode;
  value: string;
  exact?: boolean;
  role?: string;
  roleOptions?: {
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
    pressed?: boolean;
    includeHidden?: boolean;
    level?: number;
  };
  scope?: string;
  hasText?: string;
  indexMode?: 'none' | 'nth' | 'first' | 'last';
  nth?: number;
  advancedSelector?: string;
}

export interface LocatorOptionItem {
  label: string;
  value: string;
}

export const roleOptions: LocatorOptionItem[] = [
  { label: '按钮', value: 'button' },
  { label: '文本框', value: 'textbox' },
  { label: '复选框', value: 'checkbox' },
  { label: '单选框', value: 'radio' },
  { label: '下拉框', value: 'combobox' },
  { label: '链接', value: 'link' },
  { label: '标题', value: 'heading' },
  { label: '弹窗', value: 'dialog' },
  { label: '选项', value: 'option' },
  { label: '表格', value: 'table' },
  { label: '行', value: 'row' },
  { label: '单元格', value: 'cell' }
];

export const locatorModes: LocatorOptionItem[] = [
  { label: '角色', value: 'role' },
  { label: '文本', value: 'text' },
  { label: '标签', value: 'label' },
  { label: '占位符', value: 'placeholder' },
  { label: '测试ID', value: 'testId' },
  { label: '标题', value: 'title' },
  { label: '图片文本', value: 'altText' },
  { label: 'CSS', value: 'css' },
  { label: '高级', value: 'advanced' }
];

const modeLabels: Record<LocatorMode, string> = {
  role: '角色',
  text: '文本',
  label: '标签',
  placeholder: '占位符',
  testId: '测试ID',
  title: '标题',
  altText: '图片文本',
  css: 'CSS',
  advanced: '高级'
};

const methodModes: Record<string, LocatorMode> = {
  getByText: 'text',
  getByLabel: 'label',
  getByPlaceholder: 'placeholder',
  getByTestId: 'testId',
  getByTitle: 'title',
  getByAltText: 'altText'
};

interface LocatorParseResult {
  selector: string;
  scope?: string;
  hasText?: string;
  indexMode?: 'none' | 'nth' | 'first' | 'last';
  nth?: number;
}

/**
 * 创建默认定位器构建器状态。
 */
export function createDefaultLocatorState(selector = ''): LocatorBuilderState {
  if (!selector.trim()) {
    return { mode: 'role', value: '', role: 'button', indexMode: 'none' };
  }

  return parseLocatorSelector(selector);
}

/**
 * 根据构建器状态生成 Playwright selector。
 */
export function buildLocatorSelector(state: LocatorBuilderState) {
  if (state.mode === 'advanced') {
    return state.advancedSelector?.trim() ?? '';
  }

  let selector = buildBaseSelector(state);

  if (state.scope?.trim()) {
    selector = `locator(${quoteValue(state.scope.trim())}).${selector}`;
  }

  if (state.hasText?.trim()) {
    selector += `.filter({ hasText: ${quoteValue(state.hasText.trim())} })`;
  }

  if (state.indexMode === 'nth') {
    selector += `.nth(${Number.isInteger(state.nth) ? state.nth : 0})`;
  } else if (state.indexMode === 'first') {
    selector += '.first()';
  } else if (state.indexMode === 'last') {
    selector += '.last()';
  }

  return selector;
}

/**
 * 尝试把 selector 解析回构建器状态。
 */
export function parseLocatorSelector(selector: string): LocatorBuilderState {
  const text = selector.trim();
  const result = parseIndex(parseFilter(parseScope(text)));
  const base = parseBaseSelector(result.selector);

  if (!base) {
    return { mode: 'advanced', value: '', indexMode: 'none', advancedSelector: selector };
  }

  return {
    ...base,
    scope: result.scope,
    hasText: result.hasText,
    indexMode: result.indexMode,
    nth: result.nth
  };
}

/**
 * 生成步骤表中的 selector 摘要。
 */
export function formatLocatorSummary(selector?: string) {
  if (!selector?.trim()) {
    return '未设置定位';
  }

  const state = parseLocatorSelector(selector);

  if (state.mode === 'advanced') {
    return '高级选择器';
  }

  const parts = [modeLabels[state.mode]];

  if (state.mode === 'role') {
    parts.push(state.role || '未选角色');
  }

  if (state.value) {
    parts.push(state.value);
  }

  if (state.exact) {
    parts.push('精确');
  }

  if (state.scope) {
    parts.push('限定区域');
  }

  if (state.hasText) {
    parts.push('包含文本');
  }

  if (state.indexMode && state.indexMode !== 'none') {
    parts.push(formatIndexMode(state));
  }

  return parts.join(' / ');
}

/**
 * 生成基础定位器片段。
 */
function buildBaseSelector(state: LocatorBuilderState) {
  if (state.mode === 'css') {
    return `locator(${quoteValue(state.value.trim())})`;
  }

  if (state.mode === 'role') {
    const role = state.role?.trim() || 'button';
    const options = buildRoleOptions(state);

    return options ? `getByRole(${quoteValue(role)}, ${options})` : `getByRole(${quoteValue(role)})`;
  }

  const methodName = getMethodName(state.mode);
  const options = state.exact ? ', { exact: true }' : '';

  return `${methodName}(${quoteValue(state.value.trim())}${options})`;
}

/**
 * 生成 role 定位的 options 对象。
 */
function buildRoleOptions(state: LocatorBuilderState) {
  const entries: string[] = [];

  if (state.value.trim()) {
    entries.push(`name: ${quoteValue(state.value.trim())}`);
  }

  if (state.exact) {
    entries.push('exact: true');
  }

  for (const key of ['checked', 'disabled', 'expanded', 'selected', 'pressed', 'includeHidden'] as const) {
    const value = state.roleOptions?.[key];

    if (value !== undefined) {
      entries.push(`${key}: ${value}`);
    }
  }

  if (state.roleOptions?.level !== undefined) {
    entries.push(`level: ${state.roleOptions.level}`);
  }

  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '';
}

/**
 * 读取定位方式对应的 Playwright 方法名。
 */
function getMethodName(mode: LocatorMode) {
  const methods: Partial<Record<LocatorMode, string>> = {
    text: 'getByText',
    label: 'getByLabel',
    placeholder: 'getByPlaceholder',
    testId: 'getByTestId',
    title: 'getByTitle',
    altText: 'getByAltText'
  };

  return methods[mode] ?? 'getByText';
}

/**
 * 生成单引号字符串字面量。
 */
function quoteValue(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

/**
 * 解析区域限定。
 */
function parseScope(selector: string) {
  const match = selector.match(/^locator\((['"])(.*?)\1\)\.(.+)$/);

  if (!match) {
    return { selector };
  }

  return {
    selector: match[3],
    scope: unescapeValue(match[2])
  };
}

/**
 * 解析 hasText 过滤。
 */
function parseFilter(input: { selector: string; scope?: string }) {
  const match = input.selector.match(/^(.*)\.filter\(\{\s*hasText:\s*(['"])(.*?)\2\s*\}\)$/);

  if (!match) {
    return input;
  }

  return {
    ...input,
    selector: match[1],
    hasText: unescapeValue(match[3])
  };
}

/**
 * 解析序号增强。
 */
function parseIndex(input: { selector: string; scope?: string; hasText?: string }): LocatorParseResult {
  const nth = input.selector.match(/^(.*)\.nth\((\d+)\)$/);

  if (nth) {
    return { ...input, selector: nth[1], indexMode: 'nth' as const, nth: Number(nth[2]) };
  }

  const first = input.selector.match(/^(.*)\.first\(\)$/);

  if (first) {
    return { ...input, selector: first[1], indexMode: 'first' as const };
  }

  const last = input.selector.match(/^(.*)\.last\(\)$/);

  if (last) {
    return { ...input, selector: last[1], indexMode: 'last' as const };
  }

  return { ...input, indexMode: 'none' as const };
}

/**
 * 解析基础定位器。
 */
function parseBaseSelector(selector: string): LocatorBuilderState | undefined {
  const role = selector.match(/^getByRole\((['"])(.*?)\1(?:,\s*\{\s*(.*?)\s*\})?\)$/);

  if (role) {
    const options = parseSimpleOptions(role[3] ?? '');
    return {
      mode: 'role',
      role: unescapeValue(role[2]),
      value: readOptionValue(options.name),
      exact: options.exact === 'true',
      roleOptions: parseRoleOptions(options),
      indexMode: 'none'
    };
  }

  const css = selector.match(/^locator\((['"])(.*?)\1\)$/);

  if (css) {
    return { mode: 'css', value: unescapeValue(css[2]), indexMode: 'none' };
  }

  for (const [method, mode] of Object.entries(methodModes)) {
    const match = selector.match(new RegExp(`^${method}\\((['"])(.*?)\\1(?:,\\s*\\{\\s*(.*?)\\s*\\})?\\)$`));

    if (match) {
      const options = parseSimpleOptions(match[3] ?? '');
      return {
        mode,
        value: unescapeValue(match[2]),
        exact: options.exact === 'true',
        indexMode: 'none'
      };
    }
  }

  return undefined;
}

/**
 * 解析简单 options 对象。
 */
function parseSimpleOptions(value: string) {
  const options: Record<string, string> = {};

  for (const item of value.split(',')) {
    const [key, rawValue] = item.split(':').map((part) => part?.trim());

    if (key && rawValue) {
      options[key] = rawValue;
    }
  }

  return options;
}

/**
 * 解析 role 状态选项。
 */
function parseRoleOptions(options: Record<string, string>): LocatorBuilderState['roleOptions'] {
  const result: NonNullable<LocatorBuilderState['roleOptions']> = {};

  for (const key of ['checked', 'disabled', 'expanded', 'selected', 'pressed', 'includeHidden'] as const) {
    if (options[key] === 'true' || options[key] === 'false') {
      result[key] = options[key] === 'true';
    }
  }

  if (options.level && /^\d+$/.test(options.level)) {
    result.level = Number(options.level);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 读取字符串 options 值。
 */
function readOptionValue(value?: string) {
  if (!value) {
    return '';
  }

  const match = value.match(/^(['"])(.*?)\1$/);
  return match ? unescapeValue(match[2]) : '';
}

/**
 * 还原字符串中的转义字符。
 */
function unescapeValue(value: string) {
  return value.replace(/\\'/g, '\'').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * 显示序号增强摘要。
 */
function formatIndexMode(state: LocatorBuilderState) {
  if (state.indexMode === 'first') {
    return '第一个';
  }

  if (state.indexMode === 'last') {
    return '最后一个';
  }

  return `第 ${state.nth ?? 0} 个`;
}
