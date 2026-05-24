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
    return /^[A-Za-z_$][\w$]*$/.test(text) ? { key: text, hasValue: false, blankText: false, shorthand: true } : undefined;
  }

  const key = text.slice(0, separatorIndex).trim();
  const value = text.slice(separatorIndex + 1).trim();

  if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    hasValue: Boolean(value),
    blankText: isBlankTextValue(value),
    shorthand: false
  };
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
