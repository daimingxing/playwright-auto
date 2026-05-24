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

export type LocatorTextKind = 'text' | 'regex' | 'regexLiteral';

export interface LocatorTextValue {
  kind: LocatorTextKind;
  text: string;
  flags?: string;
}

export interface LocatorBuilderState {
  mode: LocatorMode;
  value: string | LocatorTextValue;
  exact?: boolean;
  role?: string;
  description?: string | LocatorTextValue;
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
  childSelector?: string;
  hasText?: string | LocatorTextValue;
  hasNotText?: string | LocatorTextValue;
  visible?: boolean;
  has?: SimpleLocatorState;
  hasNot?: SimpleLocatorState;
  indexMode?: 'none' | 'nth' | 'first' | 'last';
  nth?: number;
  advancedSelector?: string;
}

export type SimpleLocatorState = Omit<
  LocatorBuilderState,
  'scope' | 'childSelector' | 'hasText' | 'hasNotText' | 'visible' | 'has' | 'hasNot' | 'indexMode' | 'nth' | 'advancedSelector'
> & {
  mode: Exclude<LocatorMode, 'advanced'>;
};

export interface LocatorOptionItem {
  label: string;
  value: string;
}

const commonRoles: LocatorOptionItem[] = [
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
const allRoleValues = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem'
];

export const roleOptions: LocatorOptionItem[] = [
  ...commonRoles,
  ...allRoleValues
    .filter((role) => !commonRoles.some((item) => item.value === role))
    .map((role) => ({ label: role, value: role }))
];

export const locatorModes: LocatorOptionItem[] = [
  { label: '角色', value: 'role' },
  { label: '文本', value: 'text' },
  { label: '标签', value: 'label' },
  { label: '占位符', value: 'placeholder' },
  { label: '测试ID', value: 'testId' },
  { label: '标题', value: 'title' },
  { label: '图片文本', value: 'altText' },
  { label: 'CSS（高级）', value: 'css' },
  { label: '手写定位', value: 'advanced' }
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
  advanced: '手写定位'
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
 * 根据构建器状态生成无页面前缀的 Playwright selector。
 */
export function buildLocatorSelector(state: LocatorBuilderState) {
  if (state.mode === 'advanced') {
    return state.advancedSelector?.trim() ?? '';
  }

  let selector = buildBaseSelector(state);

  if (state.scope?.trim()) {
    selector = `locator(${quoteValue(state.scope.trim())}).${selector}`;
  }

  if (state.childSelector?.trim()) {
    selector += `.locator(${quoteValue(state.childSelector.trim())})`;
  }

  const filters = buildFilterEntries(state, false);

  if (filters.length > 0) {
    selector += `.filter({ ${filters.join(', ')} })`;
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
 * 根据构建器状态生成可直接写入测试文件的 Locator 表达式。
 */
export function renderLocatorExpression(state: LocatorBuilderState, pageName = 'page') {
  if (state.mode === 'advanced') {
    return `${pageName}.${state.advancedSelector?.trim() ?? ''}`;
  }

  let selector = buildBaseSelector(state, pageName);

  if (state.scope?.trim()) {
    selector = `${pageName}.locator(${quoteValue(state.scope.trim())}).${stripPagePrefix(selector, pageName)}`;
  }

  if (!state.scope?.trim() && !selector.startsWith(`${pageName}.`)) {
    selector = `${pageName}.${selector}`;
  }

  if (state.childSelector?.trim()) {
    selector += `.locator(${quoteValue(state.childSelector.trim())})`;
  }

  const filters = buildFilterEntries(state, true, pageName);

  if (filters.length > 0) {
    selector += `.filter({ ${filters.join(', ')} })`;
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
    return '手写定位';
  }

  const parts = [modeLabels[state.mode]];

  if (state.mode === 'role') {
    parts.push(state.role || '未选角色');
  }

  const valueText = readTextValue(state.value);

  if (valueText) {
    parts.push(valueText);
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

  if (state.hasNotText) {
    parts.push('排除文本');
  }

  if (state.has || state.hasNot) {
    parts.push('子定位');
  }

  if (state.indexMode && state.indexMode !== 'none') {
    parts.push(formatIndexMode(state));
  }

  return parts.join(' / ');
}

/**
 * 生成基础定位器片段。
 */
function buildBaseSelector(state: LocatorBuilderState | SimpleLocatorState, pageName?: string) {
  const prefix = pageName ? `${pageName}.` : '';

  if (state.mode === 'css') {
    return `${prefix}locator(${quoteValue(readTextValue(state.value))})`;
  }

  if (state.mode === 'role') {
    const role = state.role?.trim() || 'button';
    const options = buildRoleOptions(state);

    return options ? `${prefix}getByRole(${quoteValue(role)}, ${options})` : `${prefix}getByRole(${quoteValue(role)})`;
  }

  const methodName = getMethodName(state.mode);
  const options = state.exact ? ', { exact: true }' : '';

  return `${prefix}${methodName}(${formatTextValue(state.value)}${options})`;
}

/**
 * 生成 role 定位的 options 对象。
 */
function buildRoleOptions(state: LocatorBuilderState | SimpleLocatorState) {
  const entries: string[] = [];
  const valueText = readTextValue(state.value);

  if (valueText) {
    entries.push(`name: ${formatTextValue(state.value)}`);
  }

  const description = readTextValue(state.description);

  if (description) {
    entries.push(`description: ${formatTextValue(state.description)}`);
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
 * 生成 filter 配置片段。
 */
function buildFilterEntries(state: LocatorBuilderState, executable: boolean, pageName = 'page') {
  const entries: string[] = [];

  if (readTextValue(state.hasText)) {
    entries.push(`hasText: ${formatTextValue(state.hasText)}`);
  }

  if (readTextValue(state.hasNotText)) {
    entries.push(`hasNotText: ${formatTextValue(state.hasNotText)}`);
  }

  if (state.visible !== undefined) {
    entries.push(`visible: ${state.visible}`);
  }

  if (state.has) {
    entries.push(`has: ${executable ? buildBaseSelector(state.has, pageName) : buildBaseSelector(state.has)}`);
  }

  if (state.hasNot) {
    entries.push(`hasNot: ${executable ? buildBaseSelector(state.hasNot, pageName) : buildBaseSelector(state.hasNot)}`);
  }

  return entries;
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
 * 生成文本或正则字面量。
 */
function formatTextValue(value: string | LocatorTextValue | undefined) {
  if (!value) {
    return quoteValue('');
  }

  if (typeof value === 'string') {
    return quoteValue(value.trim());
  }

  if (value.kind === 'regexLiteral') {
    return value.text.trim();
  }

  if (value.kind === 'regex') {
    return `/${value.text}/${value.flags ?? ''}`;
  }

  return quoteValue(value.text.trim());
}

/**
 * 读取文本值的可显示内容。
 */
function readTextValue(value: string | LocatorTextValue | undefined) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value.text.trim();
}

/**
 * 生成单引号字符串字面量。
 */
function quoteValue(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

/**
 * 去掉当前页面前缀。
 */
function stripPagePrefix(value: string, pageName: string) {
  return value.startsWith(`${pageName}.`) ? value.slice(pageName.length + 1) : value;
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
