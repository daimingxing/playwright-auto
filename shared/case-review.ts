import {
  hasStepSelector,
  hasStepTimeout,
  hasStepValue,
  type CaseMeta,
  type CaseReviewItem,
  type CaseStep,
  type ReviewGroup,
  type ReviewLevel
} from './types';

const maxTimeoutMs = 600000;
const uuidIdPattern = /#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const frameworkClassPattern = /\.(k-picker|k-dropdownlist|el-select|ant-select)\b/;
const semanticAnchorPattern = /(getBy(Label|Role|Text|Placeholder)|hasText|name\s*:)/;
const transientClassPattern = /\.(k-hover|is-focus|is-focused|is-active|is-opened|is-expanded)\b/;
const orderSelectorPattern = /:(nth-child|nth-of-type)\(/;
const roleWithoutNamePattern = /getByRole\(\s*['"`][^'"`]+['"`]\s*\)/;
const parentAnchorPattern = /getBy(Label|Text|Placeholder)\(|locator\([^)]*hasText|filter\(\s*\{\s*hasText/;
const weakCssSelectorPattern = /^[a-z][a-z0-9-]*$/i;

/**
 * 检查用例和步骤的必要字段、数值边界及高价值定位风险。
 */
export function reviewCaseIntegrity(item: CaseMeta): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];

  if (item.steps.length === 0) {
    items.push(createCaseReviewItem('empty-steps', 'danger', 'integrity', '用例至少需要包含一个测试步骤。', '请新增至少一个测试步骤。'));
  }

  for (const [index, step] of item.steps.entries()) {
    items.push(...reviewCaseStep(step, index));
  }

  return items;
}

/**
 * 检查单个步骤；Playwright 表达式语法由实际运行负责验证。
 */
function reviewCaseStep(step: CaseStep, stepIndex: number): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];
  const selector = step.selector?.trim() ?? '';

  if (hasStepSelector(step.type) && !selector) {
    items.push(createStepReviewItem(step, stepIndex, 'missing-selector', 'error', 'integrity', '步骤缺少元素选择器。', '请补充可稳定定位目标元素的 selector。'));
  }

  if (hasStepValue(step.type) && !step.value?.trim()) {
    items.push(createStepReviewItem(step, stepIndex, 'missing-value', 'error', getValueGroup(step), '步骤缺少输入值或断言值。', '请补充当前步骤需要的值。'));
  }

  if (hasStepTimeout(step.type) && step.timeout !== undefined && (!Number.isInteger(step.timeout) || step.timeout < 0 || step.timeout > maxTimeoutMs)) {
    items.push(createStepReviewItem(step, stepIndex, 'invalid-timeout', 'error', 'timeout', '等待时间必须是 0 到 600000 的整数。', '请填写合法的毫秒数。'));
  }

  if (selector) {
    items.push(...reviewSelector(step, stepIndex, selector));
  }

  return items;
}

/**
 * 检查无需解析 Playwright 语法即可确定的 selector 风险。
 */
function reviewSelector(step: CaseStep, stepIndex: number, selector: string): CaseReviewItem[] {
  const items: CaseReviewItem[] = [];

  if (uuidIdPattern.test(selector)) {
    items.push(createStepReviewItem(step, stepIndex, 'dynamic-id', 'error', 'locator', '选择器使用动态 UUID id。', '请改用稳定业务属性、角色或可见文本。'));
  }

  if (frameworkClassPattern.test(selector) && !semanticAnchorPattern.test(selector)) {
    items.push(createStepReviewItem(step, stepIndex, 'wide-framework-selector', 'danger', 'locator', '选择器只描述通用框架控件。', '请增加字段名称、可见文本或父级范围。'));
  }

  if (transientClassPattern.test(selector)) {
    items.push(createStepReviewItem(step, stepIndex, 'transient-state-class', 'warning', 'locator', '选择器包含瞬态状态 class。', '请移除 hover、focus、active 等状态 class。'));
  }

  if (orderSelectorPattern.test(selector) || selector.split('>').length >= 5) {
    items.push(createStepReviewItem(step, stepIndex, 'structure-selector', 'warning', 'locator', '选择器依赖页面结构顺序。', '请改用标签、角色、文本或稳定属性。'));
  }

  if (roleWithoutNamePattern.test(selector) && !parentAnchorPattern.test(selector)) {
    items.push(createStepReviewItem(step, stepIndex, 'weak-role-selector', 'warning', 'locator', '角色定位缺少名称或区域约束。', '请增加 name 或限定父级范围。'));
  }

  if (weakCssSelectorPattern.test(selector) && !['html', 'body'].includes(selector.toLowerCase())) {
    items.push(createStepReviewItem(step, stepIndex, 'weak-css-selector', 'warning', 'locator', '选择器仅使用宽泛标签名。', '请增加稳定属性、角色或可见文本。'));
  }

  return items;
}

/**
 * 获取缺失值问题所属分组。
 */
function getValueGroup(step: CaseStep): ReviewGroup {
  return step.type.startsWith('assert') ? 'assertion' : 'integrity';
}

/**
 * 创建用例级基础检查结果。
 */
function createCaseReviewItem(ruleCode: string, level: ReviewLevel, group: ReviewGroup, message: string, suggestion: string): CaseReviewItem {
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
