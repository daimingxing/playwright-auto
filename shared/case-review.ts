import type { CaseMeta, CaseReviewItem, CaseStep, ReviewGroup, ReviewLevel, StepType } from './types';

const reviewStepTypes = new Set<StepType>([
  'click',
  'rightClick',
  'doubleClick',
  'hover',
  'fill',
  'select',
  'assertVisible',
  'assertText',
  'assertValue'
]);
const maxTimeoutMs = 600000;
const uuidIdPattern = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const frameworkClassPattern = /\.(k-picker|k-dropdownlist|el-select|ant-select)\b/;
const semanticAnchorPattern = /(getBy(Label|Role|Text|Placeholder)|hasText|name\s*:)/;
const stateClassPattern = /\.(k-hover|is-focus|is-focused|is-active|is-opened|is-expanded)\b/;
const orderSelectorPattern = /:(nth-child|nth-of-type)\(/;
const longDomPathPattern = /(?:^|['"`])(?:[a-z][\w-]*[.#:\w\s>-]*){1,}/i;
const roleWithoutNamePattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*\)/;
const parentAnchorPattern = /getBy(Label|Text|Placeholder)\(|locator\([^)]*hasText|filter\(\s*\{\s*hasText/;
const locatorMethodPattern = /^getBy(?:Role|Text|Label|Placeholder|TestId|Title|AltText)\s*\(/;
const emptyLocatorCallPattern = /(?:^|\.)locator\(\s*\)|(?:^|\.)filter\(\s*(?:\{\s*\})?\s*\)|(?:^|\.)nth\(\s*\)/;
const weakCssSelectorPattern = /^[a-z][a-z0-9-]*$/i;
const roleWithoutNameOptionPattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*,\s*\{\s*(?:name\s*:\s*['"`]\s*['"`]\s*)?\}\s*\)/;
const roleTrailingCommaPattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*,\s*\)/;
const roleWithNamePattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*,\s*\{[^}]*name\s*:/;
const locatorMethodNamePattern = /(?:^|\.)([A-Za-z_$][\w$]*)\s*\(/g;
const blankFirstArgumentPattern = /\b(?:locator|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|getByAltText)\(\s*(['"`])\s*\1/;
const exactOptionPattern = /\bexact\s*:\s*([^,}]+)/;
const nthArgumentPattern = /\.nth\(\s*([^)]+)\s*\)/;
const roleOptionNames = new Set(['checked', 'description', 'disabled', 'exact', 'expanded', 'includeHidden', 'level', 'name', 'pressed', 'selected']);
const filterOptionNames = new Set(['has', 'hasNot', 'hasText', 'hasNotText', 'visible']);
const locatorMethodNames = new Set([
  'locator',
  'filter',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'getByTitle',
  'getByAltText',
  'nth',
  'first',
  'last'
]);

interface LocatorOption {
  key: string;
  value: string;
  hasValue: boolean;
  blankText: boolean;
  shorthand: boolean;
}

interface OptionParseResult {
  options: LocatorOption[];
  invalid: boolean;
}

/**
 * 检查用例整体结构和每个步骤的必填字段。
 */
export function reviewCaseIntegrity(item: CaseMeta): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];

  if (item.steps.length === 0) {
    items.push(createCaseReviewItem('empty-steps', 'danger', 'integrity', '用例至少需要包含一个测试步骤。', '请录制或手动新增至少一个测试步骤。'));
  }

  for (const [index, step] of item.steps.entries()) {
    items.push(...reviewCaseStep(step, index));
  }

  return items;
}

/**
 * 基础检查单个步骤的完整性和元素定位质量。
 */
export function reviewCaseStep(step: CaseStep, stepIndex: number): CaseReviewItem[] {
  const items = reviewStepIntegrity(step, stepIndex);

  if (!shouldReviewStep(step)) {
    return items;
  }

  const selector = step.selector?.trim() ?? '';

  if (!selector) {
    return items;
  }

  const syntaxIssue = validateSelectorSyntax(step, stepIndex, selector);

  if (syntaxIssue) {
    items.push(syntaxIssue);
    return items;
  }

  items.push(...reviewSelectorQuality(step, stepIndex, selector));
  return items;
}

/**
 * 判断步骤是否依赖元素定位。
 */
export function shouldReviewStep(step: Pick<CaseStep, 'type'>) {
  return reviewStepTypes.has(step.type);
}

/**
 * 判断步骤是否需要值字段。
 */
export function shouldRequireValue(type: StepType) {
  return ['goto', 'fill', 'select', 'assertText', 'assertValue', 'assertUrl', 'assertTitle'].includes(type);
}

/**
 * 检查单个步骤的结构完整性。
 */
function reviewStepIntegrity(step: CaseStep, stepIndex: number): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];

  if (shouldReviewStep(step) && !step.selector?.trim()) {
    items.push(
      createStepReviewItem(
        step,
        stepIndex,
        'missing-selector',
        'error',
        'integrity',
        '步骤缺少元素选择器。',
        '请补充可稳定定位目标元素的 selector。'
      )
    );
  }

  if (shouldRequireValue(step.type) && !step.value?.trim()) {
    items.push(
      createStepReviewItem(
        step,
        stepIndex,
        'missing-value',
        'error',
        getValueGroup(step.type),
        '步骤缺少必填值。',
        '请补充输入内容、断言内容或目标地址。'
      )
    );
  }

  if (step.timeout !== undefined && (!Number.isInteger(step.timeout) || step.timeout < 0 || step.timeout > maxTimeoutMs)) {
    items.push(
      createStepReviewItem(
        step,
        stepIndex,
        'invalid-timeout',
        'error',
        'timeout',
        '等待时间必须是 0 到 600000 之间的整数毫秒。',
        '请把等待时间调整到 0 到 600000 毫秒之间。'
      )
    );
  }

  return items;
}

/**
 * 检查 selector 是否有明显语法问题。
 */
function validateSelectorSyntax(step: CaseStep, stepIndex: number, selector: string) {
  const regexIssue = reviewRegexLiterals(step, stepIndex, selector);

  if (regexIssue) {
    return regexIssue;
  }

  if (!hasBalancedPairs(selector)) {
    return createStepReviewItem(
      { ...step, selector },
      stepIndex,
      'invalid-selector',
      'error',
      'locator',
      '选择器语法不完整。',
      '请检查括号、方括号、引号是否成对闭合。'
    );
  }

  const argumentIssue = reviewLocatorArguments(step, stepIndex, selector);

  if (argumentIssue) {
    return argumentIssue;
  }

  if (locatorMethodPattern.test(selector) && !hasLocatorArgument(selector)) {
    return createStepReviewItem(
      { ...step, selector },
      stepIndex,
      'invalid-selector',
      'error',
      'locator',
      'Playwright 定位表达式缺少目标参数。',
      '请补充角色、文本、标签或测试标识等定位参数。'
    );
  }

  if (emptyLocatorCallPattern.test(selector)) {
    return createStepReviewItem(
      { ...step, selector },
      stepIndex,
      'empty-locator-argument',
      'error',
      'locator',
      '定位器链路缺少关键参数。',
      '请为 locator、filter 或 nth 补充明确的选择器、过滤条件或序号。'
    );
  }

  const methodIssue = reviewLocatorMethods(step, stepIndex, selector);

  if (methodIssue) {
    return methodIssue;
  }

  for (const optionIssue of reviewLocatorOptions(step, stepIndex, selector)) {
    return optionIssue;
  }

  return undefined;
}

/**
 * 检查 selector 的稳定性风险。
 */
function reviewSelectorQuality(step: CaseStep, stepIndex: number, selector: string): CaseReviewItem[] {
  const context = { ...step, selector };
  const items: CaseReviewItem[] = [];

  if (uuidIdPattern.test(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'dynamic-id',
        'error',
        'locator',
        '选择器使用动态 UUID id，重放时该 id 可能不存在。',
        '请改用弹窗标题、字段标签、按钮名称、可见文本或稳定业务属性定位。'
      )
    );
  }

  if (frameworkClassPattern.test(selector) && !semanticAnchorPattern.test(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'wide-framework-selector',
        'danger',
        'locator',
        '选择器只描述通用框架控件，页面存在多个相似控件时可能点错元素。',
        '请使用弹窗标题加字段名称定位目标控件，例如先限定弹窗或区域，再定位目标字段。'
      )
    );
  }

  if (stateClassPattern.test(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'transient-state-class',
        'warning',
        'locator',
        '选择器包含瞬态状态 class，该状态只代表录制时的鼠标或焦点状态。',
        '请去掉瞬态状态 class，改用稳定的字段、角色或文本定位。'
      )
    );
  }

  if (isStructureSelector(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'structure-selector',
        'warning',
        'locator',
        '选择器依赖页面结构顺序，布局调整后容易失效。',
        '请改用字段标签、按钮名称、可见文本或角色名称定位。'
      )
    );
  }

  if (isWeakRoleSelector(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'weak-role-selector',
        'warning',
        'locator',
        '角色定位缺少名称或区域约束，页面存在多个同类元素时可能点错。',
        '请为角色定位增加 name，或先限定弹窗、区域、字段标签。'
      )
    );
  }

  if (isWeakCssSelector(selector)) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'weak-css-selector',
        'warning',
        'locator',
        '选择器缺少可读语义或稳定属性，可能匹配不到目标元素。',
        '请优先使用角色、文本、标签、测试标识或带业务含义的属性定位。'
      )
    );
  }

  return items;
}

/**
 * 检查定位器参数的基础类型和空值问题。
 */
function reviewLocatorArguments(step: CaseStep, stepIndex: number, selector: string) {
  const context = { ...step, selector };

  if (blankFirstArgumentPattern.test(selector)) {
    return createStepReviewItem(
      context,
      stepIndex,
      'empty-locator-argument',
      'error',
      'locator',
      '定位器缺少有效目标参数。',
      '请为 locator、getByText、getByLabel 等方法补充非空文本、测试标识或 CSS 选择器。'
    );
  }

  const exactMatch = selector.match(exactOptionPattern);

  if (exactMatch && !['true', 'false'].includes(exactMatch[1].trim())) {
    return createStepReviewItem(
      context,
      stepIndex,
      'invalid-locator-option',
      'error',
      'locator',
      'exact 配置必须是布尔值。',
      '请把 exact 设置为 true 或 false，或删除该配置。'
    );
  }

  const nthMatch = selector.match(nthArgumentPattern);

  if (nthMatch && !/^(0|[1-9]\d*)$/.test(nthMatch[1].trim())) {
    return createStepReviewItem(
      context,
      stepIndex,
      'invalid-locator-argument',
      'error',
      'locator',
      'nth 参数必须是非负整数。',
      '请把 nth 参数改为 0 或更大的整数。'
    );
  }

  return undefined;
}

/**
 * 检查 Playwright 定位表达式中的方法名是否属于支持白名单。
 */
function reviewLocatorMethods(step: CaseStep, stepIndex: number, selector: string) {
  if (!shouldCheckLocatorMethods(selector)) {
    return undefined;
  }

  for (const methodName of parseLocatorMethodNames(selector)) {
    if (!locatorMethodNames.has(methodName)) {
      return createStepReviewItem(
        { ...step, selector },
        stepIndex,
        'unknown-locator-method',
        'error',
        'locator',
        '选择器使用了不支持的 Playwright 定位方法。',
        '请使用 locator、filter、getByRole、getByText、getByLabel、getByPlaceholder、getByTestId、getByTitle、getByAltText、nth、first 或 last。'
      );
    }
  }

  return undefined;
}

/**
 * 判断 selector 是否需要按 Playwright 定位方法白名单检查。
 */
function shouldCheckLocatorMethods(selector: string) {
  return /(^|\.)[A-Za-z_$][\w$]*\s*\(/.test(selector);
}

/**
 * 提取 Playwright 风格定位表达式中的方法名。
 */
function parseLocatorMethodNames(selector: string) {
  const names: string[] = [];
  locatorMethodNamePattern.lastIndex = 0;

  for (let match = locatorMethodNamePattern.exec(selector); match; match = locatorMethodNamePattern.exec(selector)) {
    names.push(match[1]);
  }

  return names;
}

/**
 * 检查 Playwright 定位器方法的 options 对象是否符合当前 API。
 */
function reviewLocatorOptions(step: CaseStep, stepIndex: number, selector: string): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];
  const context = { ...step, selector };

  const roleResult = parseCallOptions(selector, 'getByRole');
  const filterResult = parseCallOptions(selector, 'filter');

  if (roleResult.invalid || filterResult.invalid) {
    items.push(
      createStepReviewItem(
        context,
        stepIndex,
        'invalid-selector',
        'error',
        'locator',
        '定位器 options 语法不完整。',
        '请检查 getByRole 或 filter 的配置对象是否为合法对象字面量。'
      )
    );

    return items;
  }

  for (const option of roleResult.options) {
    const roleIssue = reviewOption(context, stepIndex, option, roleOptionNames, 'role');

    if (roleIssue) {
      items.push(roleIssue);
    }
  }

  for (const option of filterResult.options) {
    const filterIssue = reviewOption(context, stepIndex, option, filterOptionNames, 'filter');

    if (filterIssue) {
      items.push(filterIssue);
    }
  }

  return items;
}

/**
 * 检查单个 options 字段是否缺值、依赖外部变量或不属于目标方法。
 */
function reviewOption(
  step: CaseStep,
  stepIndex: number,
  option: LocatorOption,
  validNames: Set<string>,
  owner: 'role' | 'filter'
) {
  if (!option.hasValue && !option.shorthand) {
    return createStepReviewItem(
      step,
      stepIndex,
      'empty-locator-option',
      'error',
      'locator',
      '定位器配置项缺少有效值。',
      '请为定位配置补充非空文本、正则、布尔值或定位条件。'
    );
  }

  if (option.shorthand) {
    return createStepReviewItem(
      step,
      stepIndex,
      'external-locator-variable',
      'error',
      'locator',
      '定位器配置依赖外部变量。',
      '请直接填写明确的文本、正则、布尔值或定位条件，避免生成的测试文件运行时变量不存在。'
    );
  }

  if (!validNames.has(option.key)) {
    const ruleCode = owner === 'role' ? 'unknown-role-option' : 'unknown-filter-option';
    const message = owner === 'role' ? 'getByRole 使用了不支持的配置项。' : 'filter 使用了不支持的配置项。';
    const suggestion =
      owner === 'role'
        ? '请只使用 checked、description、disabled、exact、expanded、includeHidden、level、name、pressed、selected。'
        : '请只使用 has、hasNot、hasText、hasNotText、visible。';

    return createStepReviewItem(step, stepIndex, ruleCode, 'error', 'locator', message, suggestion);
  }

  if (option.blankText) {
    return createStepReviewItem(
      step,
      stepIndex,
      'empty-locator-option',
      'error',
      'locator',
      '定位器配置项缺少有效值。',
      '请为定位配置补充非空文本、正则、布尔值或定位条件。'
    );
  }

  const valueIssue = reviewOptionValue(step, stepIndex, option, owner);

  if (valueIssue) {
    return valueIssue;
  }

  return undefined;
}

/**
 * 检查 options 字段值是否符合当前支持的 Playwright 参数形态。
 */
function reviewOptionValue(step: CaseStep, stepIndex: number, option: LocatorOption, owner: 'role' | 'filter') {
  const booleanRoleKeys = new Set(['checked', 'disabled', 'expanded', 'includeHidden', 'pressed', 'selected']);
  const textKeys = new Set(['name', 'description', 'hasText', 'hasNotText']);

  if ((option.key === 'visible' || booleanRoleKeys.has(option.key)) && !isBooleanValue(option.value)) {
    return createStepReviewItem(
      step,
      stepIndex,
      'invalid-locator-option',
      'error',
      'locator',
      `${option.key} 配置必须是布尔值。`,
      `请把 ${option.key} 设置为 true 或 false，或删除该配置。`
    );
  }

  if (option.key === 'level' && !/^[1-6]$/.test(option.value)) {
    return createStepReviewItem(
      step,
      stepIndex,
      'invalid-locator-option',
      'error',
      'locator',
      'level 配置必须是 1 到 6 的标题级别。',
      '请把 level 设置为 1 到 6 之间的整数，或删除该配置。'
    );
  }

  if (owner === 'filter' && (option.key === 'has' || option.key === 'hasNot') && !isSimpleFilterLocator(option.value)) {
    return createStepReviewItem(
      step,
      stepIndex,
      'complex-filter-locator',
      'error',
      'locator',
      'has 或 hasNot 只能使用简单子定位器。',
      '请在 has/hasNot 中使用 getByRole、getByText、getByLabel、getByPlaceholder、getByTestId、getByTitle、getByAltText 或 locator 的单层定位。'
    );
  }

  if (textKeys.has(option.key) && !isTextLikeValue(option.value)) {
    return createStepReviewItem(
      step,
      stepIndex,
      'invalid-locator-option',
      'error',
      'locator',
      `${option.key} 配置必须是文本或正则。`,
      `请把 ${option.key} 设置为非空字符串或合法正则字面量。`
    );
  }

  return undefined;
}

/**
 * 解析指定定位器方法的顶层 options 字段。
 */
function parseCallOptions(selector: string, methodName: string): OptionParseResult {
  const options: LocatorOption[] = [];
  let searchStart = 0;
  let invalid = false;

  while (searchStart < selector.length) {
    const methodIndex = selector.indexOf(`${methodName}(`, searchStart);

    if (methodIndex < 0) {
      break;
    }

    const callStart = methodIndex + methodName.length;
    const callEnd = findPairEnd(selector, callStart, '(', ')');

    if (callEnd < 0) {
      invalid = true;
      break;
    }

    const objectStart = findTopLevelOptionStart(selector, callStart);

    if (objectStart < 0) {
      searchStart = methodIndex + methodName.length;
      continue;
    }

    if (!hasValidOptionPrefix(selector.slice(callStart + 1, objectStart))) {
      invalid = true;
      break;
    }

    const objectEnd = findPairEnd(selector, objectStart, '{', '}');

    if (objectEnd < 0) {
      invalid = true;
      break;
    }

    const objectResult = parseObjectOptions(selector.slice(objectStart + 1, objectEnd));
    options.push(...objectResult.options);
    invalid = invalid || objectResult.invalid;
    searchStart = objectEnd + 1;
  }

  return { options, invalid };
}

/**
 * 找到方法调用中顶层 options 对象的起始位置。
 */
function findTopLevelOptionStart(selector: string, callStart: number) {
  const callEnd = findPairEnd(selector, callStart, '(', ')');

  if (callEnd < 0) {
    return -1;
  }

  for (let index = callStart + 1; index < callEnd; index += 1) {
    if (selector[index] === '{' && isTopLevelChar(selector, callStart, index)) {
      return index;
    }
  }

  return -1;
}

/**
 * 判断 options 对象前是否只有合法的前置参数或逗号。
 */
function hasValidOptionPrefix(prefix: string) {
  const text = prefix.trim();

  if (!text) {
    return true;
  }

  return text.endsWith(',');
}

/**
 * 判断指定字符是否位于当前方法调用的顶层参数中。
 */
function isTopLevelChar(value: string, scopeStart: number, targetIndex: number) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = scopeStart + 1; index < targetIndex; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    }
  }

  return depth === 0;
}

/**
 * 找到成对符号的结束位置。
 */
function findPairEnd(value: string, startIndex: number, openChar: string, closeChar: string) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let inRegex = false;
  let inRegexClass = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inRegex) {
      if (char === '[') {
        inRegexClass = true;
        continue;
      }

      if (char === ']') {
        inRegexClass = false;
        continue;
      }

      if (char === '/' && !inRegexClass) {
        inRegex = false;
      }

      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '/' && canStartRegex(value, index)) {
      inRegex = true;
      inRegexClass = false;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * 解析 options 对象中的顶层字段。
 */
function parseObjectOptions(body: string): OptionParseResult {
  const options: LocatorOption[] = [];
  let invalid = false;

  for (const item of splitTopLevel(body)) {
    const text = item.trim();

    if (!text) {
      continue;
    }

    const option = parseOptionItem(text);

    if (!option) {
      invalid = true;
      continue;
    }

    options.push(option);
  }

  return { options, invalid };
}

/**
 * 按顶层逗号拆分对象字段。
 */
function splitTopLevel(value: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }

    if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

/**
 * 解析单个 options 字段。
 */
function parseOptionItem(item: string): LocatorOption | undefined {
  const text = item.trim();

  if (!text) {
    return undefined;
  }

  const separatorIndex = findTopLevelColon(text);

  if (separatorIndex < 0) {
    return /^[A-Za-z_$][\w$]*$/.test(text) ? { key: text, value: '', hasValue: false, blankText: false, shorthand: true } : undefined;
  }

  const key = text.slice(0, separatorIndex).trim();
  const value = text.slice(separatorIndex + 1).trim();

  if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value,
    hasValue: Boolean(value),
    blankText: isBlankTextValue(value),
    shorthand: false
  };
}

/**
 * 检查 selector 内的正则字面量是否能被 JavaScript 解析。
 */
function reviewRegexLiterals(step: CaseStep, stepIndex: number, selector: string) {
  for (const regexText of findRegexLiterals(selector)) {
    const parsed = parseRegexLiteral(regexText);

    if (!parsed) {
      return createStepReviewItem(
        { ...step, selector },
        stepIndex,
        'invalid-locator-regex',
        'error',
        'locator',
        '定位器中的正则表达式不合法。',
        '请检查正则内容、结束斜杠和 flags，或改用普通文本。'
      );
    }

    try {
      new RegExp(parsed.body, parsed.flags);
    } catch {
      return createStepReviewItem(
        { ...step, selector },
        stepIndex,
        'invalid-locator-regex',
        'error',
        'locator',
        '定位器中的正则表达式不合法。',
        '请检查正则内容、结束斜杠和 flags，或改用普通文本。'
      );
    }
  }

  return undefined;
}

/**
 * 从定位表达式中提取正则字面量候选。
 */
function findRegexLiterals(value: string) {
  const items: string[] = [];
  let quote = '';
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '/' && canStartRegex(value, index)) {
      const end = findRegexEnd(value, index);

      if (end < 0) {
        items.push(value.slice(index));
        continue;
      }

      let flagsEnd = end + 1;

      while (/[A-Za-z]/.test(value[flagsEnd] ?? '')) {
        flagsEnd += 1;
      }

      items.push(value.slice(index, flagsEnd));
      index = flagsEnd - 1;
    }
  }

  return items;
}

/**
 * 判断当前位置的斜杠是否像正则字面量起点。
 */
function canStartRegex(value: string, index: number) {
  const previous = value.slice(0, index).trimEnd().at(-1);

  return !previous || ['(', ',', ':', '[', '{', '='].includes(previous);
}

/**
 * 查找正则字面量的结束斜杠。
 */
function findRegexEnd(value: string, start: number) {
  let escaped = false;
  let inClass = false;

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '[') {
      inClass = true;
      continue;
    }

    if (char === ']') {
      inClass = false;
      continue;
    }

    if (char === '/' && !inClass) {
      return index;
    }
  }

  return -1;
}

/**
 * 拆分正则字面量内容和 flags。
 */
function parseRegexLiteral(value: string) {
  if (!value.startsWith('/')) {
    return undefined;
  }

  const end = findRegexEnd(value, 0);

  if (end <= 0) {
    return undefined;
  }

  const body = value.slice(1, end);
  const flags = value.slice(end + 1);
  const validFlags = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

  // 空正则可执行但语义过宽，这里按基础检查错误处理。
  if (!body.trim()) {
    return undefined;
  }

  if ([...flags].some((flag) => !validFlags.has(flag)) || new Set(flags).size !== flags.length) {
    return undefined;
  }

  return { body, flags };
}

/**
 * 判断值是否为布尔字面量。
 */
function isBooleanValue(value: string) {
  return value === 'true' || value === 'false';
}

/**
 * 判断值是否为基础检查认可的文本或正则。
 */
function isTextLikeValue(value: string) {
  if (isBlankTextValue(value)) {
    return false;
  }

  if (/^(['"`])[\s\S]*\1$/.test(value)) {
    return true;
  }

  return Boolean(parseRegexLiteral(value));
}

/**
 * 判断 has/hasNot 中是否为简单单层定位器。
 */
function isSimpleFilterLocator(value: string) {
  const text = value.trim();

  if (!text) {
    return false;
  }

  if (/\.filter\s*\(|\.nth\s*\(|\.first\s*\(|\.last\s*\(|\.locator\s*\(/.test(text)) {
    return false;
  }

  if (/^(?:page\d?\.)/.test(text)) {
    return false;
  }

  return /^(?:locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|getByAltText)\s*\(/.test(text);
}

/**
 * 找到对象字段名和值之间的顶层冒号。
 */
function findTopLevelColon(value: string) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }

    if (char === ':' && depth === 0) {
      return index;
    }
  }

  return -1;
}

/**
 * 判断字段值是否为空字符串。
 */
function isBlankTextValue(value: string) {
  const match = value.match(/^(['"`])([\s\S]*)\1$/);

  return Boolean(match && !match[2].trim());
}

/**
 * 判断括号和引号是否成对闭合。
 */
function hasBalancedPairs(value: string) {
  const stack: string[] = [];
  let quote = '';
  let escaped = false;
  const pairs: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{'
  };

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== pairs[char]) {
        return false;
      }
    }
  }

  return stack.length === 0 && !quote;
}

/**
 * 判断 Playwright 定位表达式是否包含首个参数。
 */
function hasLocatorArgument(selector: string) {
  return /^getBy(?:Role|Text|Label|Placeholder|TestId|Title|AltText)\s*\(\s*['"`][^'"`]+['"`]/.test(selector);
}

/**
 * 判断是否为缺少名称约束的 role 定位。
 */
function isWeakRoleSelector(selector: string) {
  if (parentAnchorPattern.test(selector) || roleWithNamePattern.test(selector)) {
    return false;
  }

  return roleWithoutNamePattern.test(selector) || roleWithoutNameOptionPattern.test(selector) || roleTrailingCommaPattern.test(selector);
}

/**
 * 判断是否为过弱的裸 CSS 选择器。
 */
function isWeakCssSelector(selector: string) {
  if (!weakCssSelectorPattern.test(selector)) {
    return false;
  }

  return !['html', 'body'].includes(selector.toLowerCase());
}

/**
 * 判断选择器是否明显依赖 DOM 结构。
 */
function isStructureSelector(selector: string) {
  if (orderSelectorPattern.test(selector)) {
    return true;
  }

  const childSegments = selector.split('>').length - 1;

  return childSegments >= 4 && longDomPathPattern.test(selector);
}

/**
 * 获取缺失值问题所属分组。
 */
function getValueGroup(type: StepType): ReviewGroup {
  return type.startsWith('assert') ? 'assertion' : 'integrity';
}

/**
 * 创建用例级基础检查结果。
 */
function createCaseReviewItem(
  ruleCode: string,
  level: ReviewLevel,
  group: ReviewGroup,
  message: string,
  suggestion: string
): CaseReviewItem {
  return {
    id: `case-${ruleCode}`,
    stepId: '',
    stepIndex: -1,
    stepType: 'wait',
    selector: '',
    level,
    group,
    ruleCode,
    message,
    suggestion
  };
}

/**
 * 创建步骤级基础检查结果。
 */
function createStepReviewItem(
  step: CaseStep,
  stepIndex: number,
  ruleCode: string,
  level: ReviewLevel,
  group: ReviewGroup,
  message: string,
  suggestion: string
): CaseReviewItem {
  return {
    id: `${step.id}-${ruleCode}`,
    stepId: step.id,
    stepIndex,
    stepType: step.type,
    selector: step.selector ?? '',
    level,
    group,
    ruleCode,
    message,
    suggestion
  };
}
