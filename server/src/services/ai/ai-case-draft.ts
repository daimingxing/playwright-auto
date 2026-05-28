import { z } from 'zod';
import { stepTypes, type AiCaseDraft, type AiDebugInfo, type AiDraftStep, type AiLevel, type ImportCaseSource, type ImportDataSource, type ImportStepSource, type StepType, type TargetType } from '../../../../shared/types';
import { AiJsonError, generateAiJson } from './ai-client';
import type { PageContext, PageElement } from './page-context';
import { buildAiCaseDraftGroupSystemPrompt, buildAiCaseDraftGroupUserPrompt, buildAiCaseDraftSystemPrompt, buildAiCaseDraftUserPrompt } from '../../prompts/ai-case-draft-prompt';

export interface DraftInput {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  pageContext: PageContext;
}

export interface DraftCaseInput {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
}

export interface DraftPageState {
  stateId: string;
  name: string;
  actionName?: string;
  context: PageContext;
}

export interface DraftPageMap {
  mapId: string;
  targetUrl: string;
  states: DraftPageState[];
  warnings: string[];
}

export interface DraftGroupInput {
  pageMap: DraftPageMap;
  cases: DraftCaseInput[];
}

export interface DraftResult {
  draft: AiCaseDraft;
  aiDebug: AiDebugInfo;
}

export interface DraftGroupItem {
  caseNo: string;
  draft?: AiCaseDraft;
  error?: string;
}

export interface DraftGroupResult {
  items: DraftGroupItem[];
  groupErrors: string[];
  aiDebug: AiDebugInfo;
}

interface SelectorCompleteInput {
  steps: ImportStepSource[];
  pageContext: PageContext;
  stateName?: string;
}

interface GroupSelectorInput {
  steps: ImportStepSource[];
  pageMap: DraftPageMap;
}

interface SelectorCandidate extends PageElement {
  stateId?: string;
  stateName?: string;
  isInitial?: boolean;
}

export class AiDraftError extends Error {
  aiDebug: AiDebugInfo;

  /**
   * 创建携带 AI 调试信息的草稿生成错误。
   */
  constructor(message: string, aiDebug: AiDebugInfo) {
    super(message);
    this.name = 'AiDraftError';
    this.aiDebug = aiDebug;
  }
}

const aiLevelSchema = z.enum(['high', 'medium', 'low']);
const stepTypeSchema = z.enum(stepTypes);
const draftStepSchema = z.object({
  id: z.string().min(1).optional(),
  type: stepTypeSchema,
  selector: z.string().optional(),
  value: z.string().optional(),
  timeout: z.number().int().nonnegative().optional(),
  match: z.enum(['contains', 'equals', 'regex']).optional(),
  text: z.string().min(1),
  confidence: aiLevelSchema.default('medium'),
  warnings: z.array(z.string()).default([])
});
const draftSchema = z.object({
  name: z.string().min(1),
  startPath: z.string().min(1),
  steps: z.array(draftStepSchema),
  confidence: aiLevelSchema,
  warnings: z.array(z.string()),
  missingInfo: z.array(z.string())
});
// 兼容模型输出 0-1 或 0-100 数字置信度时的三档映射边界。
const highScoreMin = 0.75;
const mediumScoreMin = 0.4;
const percentScoreMax = 100;
const assertTypes: StepType[] = ['assertText', 'assertVisible', 'assertValue', 'assertUrl', 'assertTitle'];
const typeFixWarning = '平台按模板动作类型修正 AI 返回步骤类型，请确认草稿步骤。';

interface SelectorKind {
  type: StepType;
  target?: TargetType;
}

/**
 * 构造 AI 草稿生成输入。
 */
export function buildCaseDraftInput(input: DraftInput) {
  return {
    system: buildAiCaseDraftSystemPrompt(),
    user: buildAiCaseDraftUserPrompt({
      caseInfo: input.caseInfo,
      steps: input.steps,
      data: input.data,
      pageContext: input.pageContext
    })
  };
}

/**
 * 构造 AI 分组草稿生成输入。
 */
export function buildCaseDraftGroupInput(input: DraftGroupInput) {
  return {
    system: buildAiCaseDraftGroupSystemPrompt(),
    user: buildAiCaseDraftGroupUserPrompt({
      pageMap: summarizePageMap(input.pageMap),
      cases: input.cases
    })
  };
}

/**
 * 调用 AI 生成结构化用例草稿。
 */
export async function generateCaseDraft(input: DraftInput) {
  if (process.env.NODE_ENV === 'test') {
    const prompt = buildCaseDraftInput(input);

    return {
      draft: createTestDraft(input),
      aiDebug: createDebugInfo(prompt, '测试环境固定草稿', createTestDraft(input))
    } satisfies DraftResult;
  }

  const prompt = buildCaseDraftInput(input);

  try {
    const result = await generateAiJson<unknown>(prompt);

    return {
      draft: completeDraftSelectors(normalizeAiDraftWithDebug(result.parsed, prompt, result.response), input),
      aiDebug: createDebugInfo(prompt, result.response, result.parsed)
    } satisfies DraftResult;
  } catch (error) {
    if (error instanceof AiDraftError) {
      throw error;
    }

    if (error instanceof AiJsonError) {
      throw new AiDraftError('AI 返回内容不是可用 JSON，请在详情查看模型输出', createDebugInfo(prompt, error.response, error.parsed, error.message));
    }

    throw error;
  }
}

/**
 * 调用 AI 按页面地图分组生成结构化用例草稿。
 */
export async function generateCaseDraftGroup(input: DraftGroupInput) {
  if (process.env.NODE_ENV === 'test') {
    const prompt = buildCaseDraftGroupInput(input);
    const items = input.cases.map((item) => ({
      caseNo: item.caseInfo.caseNo,
      draft: completeDraftSelectorsFromPageMap(createTestDraft({
        ...item,
        pageContext: input.pageMap.states[0]?.context ?? createEmptyContext(input.pageMap.targetUrl)
      }), {
        steps: item.steps,
        pageMap: input.pageMap
      })
    }));

    return {
      items,
      groupErrors: [],
      aiDebug: createDebugInfo(prompt, '测试环境固定分组草稿', { items })
    } satisfies DraftGroupResult;
  }

  const prompt = buildCaseDraftGroupInput(input);

  try {
    const result = await generateAiJson<unknown>(prompt);
    const draftGroup = normalizeAiDraftGroup(result.parsed, input);

    return {
      items: draftGroup.items,
      groupErrors: draftGroup.groupErrors,
      aiDebug: createDebugInfo(prompt, result.response, result.parsed)
    } satisfies DraftGroupResult;
  } catch (error) {
    if (error instanceof AiDraftError) {
      throw error;
    }

    if (error instanceof AiJsonError) {
      throw new AiDraftError('AI 返回内容不是可用 JSON，请在详情查看模型输出', createDebugInfo(prompt, error.response, error.parsed, error.message));
    }

    throw error;
  }
}

/**
 * 归一化 AI 草稿为平台可保存结构。
 */
export function normalizeAiDraft(value: unknown): AiCaseDraft {
  const draft = draftSchema.parse(normalizeDraftShape(value));

  return {
    name: draft.name,
    startPath: draft.startPath,
    steps: draft.steps.map((step, index) => normalizeStep(step, index)),
    confidence: draft.confidence,
    warnings: draft.warnings,
    missingInfo: draft.missingInfo
  };
}

/**
 * 归一化 AI 分组草稿输出，并把单条错误限制在对应用例内。
 */
export function normalizeAiDraftGroup(value: unknown, input: DraftGroupInput): { items: DraftGroupItem[]; groupErrors: string[] } {
  const rawItems = readGroupItems(value);
  const seen = new Set<string>();
  const errors = new Map<string, string[]>();
  const groupErrors: string[] = [];
  const drafts = new Map<string, AiCaseDraft>();
  const caseMap = new Map(input.cases.map((item) => [item.caseInfo.caseNo, item]));

  rawItems.forEach((item, index) => {
    const caseNo = readText((item as Record<string, unknown>)?.caseNo);

    if (!caseNo) {
      groupErrors.push(`AI 返回项缺少 caseNo（第 ${index + 1} 项）`);
      return;
    }

    if (seen.has(caseNo)) {
      pushFirstError(errors, caseNo, `AI 返回重复用例编号：${caseNo}`);
      return;
    }

    seen.add(caseNo);

    const caseInput = caseMap.get(caseNo);

    if (!caseInput) {
      groupErrors.push(`AI 返回未知用例编号：${caseNo}`);
      return;
    }

    const error = readText((item as Record<string, unknown>).error);

    if (error) {
      pushError(errors, caseNo, error);
      return;
    }

    try {
      const draftValue = (item as Record<string, unknown>).draft ?? (item as Record<string, unknown>).result ?? (item as Record<string, unknown>).caseDraft;
      const draft = normalizeAiDraft(draftValue);

      drafts.set(caseNo, completeDraftSelectorsFromPageMap(draft, {
        steps: caseInput.steps,
        pageMap: input.pageMap
      }));
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : '结构不符合要求';

      pushError(errors, caseNo, `AI 返回草稿结构不合法：${message}`);
    }
  });

  const items = input.cases.map((item) => {
    const caseNo = item.caseInfo.caseNo;
    const draft = drafts.get(caseNo);
    const itemErrors = errors.get(caseNo);

    if (itemErrors?.[0]) {
      return { caseNo, error: itemErrors[0] };
    }

    if (draft) {
      return { caseNo, draft };
    }

    return {
      caseNo,
      error: itemErrors?.[0] ?? `AI 未返回该用例结果：${caseNo}`
    };
  });

  return {
    items,
    groupErrors
  };
}

/**
 * 根据已采集页面上下文补全模型遗漏的 selector。
 */
export function completeDraftSelectors(draft: AiCaseDraft, input: SelectorCompleteInput): AiCaseDraft {
  return {
    ...draft,
    steps: draft.steps.map((step, index) => completeStepSelector(step, input.steps[index], input.pageContext))
  };
}

/**
 * 归一化模型输出，失败时保留本次模型输入输出。
 */
function normalizeAiDraftWithDebug(value: unknown, prompt: { system: string; user: string }, response: string): AiCaseDraft {
  try {
    return normalizeAiDraft(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 返回结构不符合要求';

    throw new AiDraftError('AI 返回结构不符合平台草稿要求，请在详情查看模型输出', createDebugInfo(prompt, response, value, message));
  }
}

/**
 * 读取 AI 分组输出中的 items 数组。
 */
function readGroupItems(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;

  return Array.isArray(record.items) ? record.items : [];
}

/**
 * 记录分组归一化错误。
 */
function pushError(errors: Map<string, string[]>, caseNo: string | undefined, message: string) {
  const key = caseNo ?? '';
  const values = errors.get(key) ?? [];

  errors.set(key, [...values, message]);
}

/**
 * 在同一用例存在多类结构错误时，把更关键的错误放在前面。
 */
function pushFirstError(errors: Map<string, string[]>, caseNo: string | undefined, message: string) {
  const key = caseNo ?? '';
  const values = errors.get(key) ?? [];

  errors.set(key, [message, ...values]);
}

/**
 * 创建 AI 调试信息，便于页面查看模型输入输出。
 */
export function createDebugInfo(prompt: { system: string; user: string }, response: string, parsed?: unknown, error?: string): AiDebugInfo {
  return {
    system: prompt.system,
    user: prompt.user,
    response,
    parsed,
    error,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 压缩页面地图给模型读取，避免把无关运行字段暴露给 prompt。
 */
function summarizePageMap(pageMap: DraftPageMap) {
  return {
    mapId: pageMap.mapId,
    targetUrl: pageMap.targetUrl,
    warnings: pageMap.warnings,
    states: pageMap.states.map((state) => ({
      stateId: state.stateId,
      name: state.name,
      actionName: state.actionName,
      page: state.context.page,
      elements: state.context.elements,
      warnings: state.context.warnings
    }))
  };
}

/**
 * 兼容模型把步骤包在子对象里的输出形态。
 */
function normalizeDraftShape(value: unknown) {
  const draftValue = readDraftShape(value);

  if (!draftValue || typeof draftValue !== 'object' || !Array.isArray((draftValue as { steps?: unknown }).steps)) {
    return draftValue;
  }

  return {
    ...draftValue,
    confidence: readAiLevel((draftValue as { confidence?: unknown }).confidence),
    steps: (draftValue as { steps: unknown[] }).steps.map(readStepShape)
  };
}

/**
 * 兼容模型把整份草稿包在子对象中的输出形态。
 */
function readDraftShape(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;

  return record.draft ?? record.result ?? record.caseDraft ?? value;
}

/**
 * 读取模型输出中的单个步骤对象。
 */
function readStepShape(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const step = record.source ?? record.draft ?? record.step ?? value;

  if (!step || typeof step !== 'object') {
    return step;
  }

  const stepRecord = step as Record<string, unknown>;
  const text = readText(stepRecord.text) ?? readText(stepRecord.actionText) ?? readText(stepRecord.action) ?? readText(stepRecord.description);

  return {
    ...stepRecord,
    id: readText(stepRecord.id),
    type: readStepType(stepRecord.type) ?? inferStepType(text ?? ''),
    text,
    confidence: readAiLevel(stepRecord.confidence),
    warnings: readWarnings(stepRecord.warnings)
  };
}

/**
 * 归一化单个 AI 步骤。
 */
function normalizeStep(step: z.infer<typeof draftStepSchema>, index: number): AiDraftStep {
  return {
    id: step.id || `ai-${index + 1}`,
    type: step.type,
    selector: step.selector,
    value: step.value,
    timeout: step.timeout,
    match: step.match,
    text: step.text,
    confidence: step.confidence,
    warnings: step.warnings
  };
}

/**
 * 补全单个步骤的定位器。
 */
function completeStepSelector(step: AiDraftStep, source: ImportStepSource | undefined, context: PageContext): AiDraftStep {
  const kind = readSelectorKind(step, source);
  const fixedStep = fixStepType(step, source);

  if (fixedStep.selector || !source || !needsSelector(kind.type) || isLazyMenuStep(source)) {
    return fixedStep;
  }

  const candidate = findSelectorCandidate(source, fixedStep, context, kind);

  if (!candidate) {
    return fixedStep;
  }

  return {
    ...fixedStep,
    selector: candidate.locator,
    confidence: candidate.unique ? fixedStep.confidence : lowerLevel(fixedStep.confidence),
    warnings: buildSelectorWarnings(fixedStep.warnings, candidate, false)
  };
}

/**
 * 根据多状态页面地图补全模型遗漏的 selector。
 */
export function completeDraftSelectorsFromPageMap(draft: AiCaseDraft, input: GroupSelectorInput): AiCaseDraft {
  return {
    ...draft,
    steps: draft.steps.map((step, index) => completeStepSelectorFromPageMap(step, input.steps[index], input.pageMap))
  };
}

/**
 * 使用多状态页面地图补全单个步骤定位器。
 */
function completeStepSelectorFromPageMap(step: AiDraftStep, source: ImportStepSource | undefined, pageMap: DraftPageMap): AiDraftStep {
  const kind = readSelectorKind(step, source);
  const fixedStep = fixStepType(step, source);

  if (fixedStep.selector || !source || !needsSelector(kind.type) || isLazyMenuStep(source)) {
    return fixedStep;
  }

  const candidate = findSelectorCandidateFromPageMap(source, fixedStep, pageMap, kind);

  if (!candidate) {
    return fixedStep;
  }

  return {
    ...fixedStep,
    selector: candidate.locator,
    confidence: candidate.unique ? fixedStep.confidence : lowerLevel(fixedStep.confidence),
    warnings: buildSelectorWarnings(fixedStep.warnings, candidate, true)
  };
}

/**
 * 构造 selector 自动补全风险提示。
 */
function buildSelectorWarnings(warnings: string[], candidate: SelectorCandidate, includeState: boolean) {
  const next = [...warnings];

  if (!candidate.unique) {
    next.push('平台根据页面上下文自动补充 selector，但该定位器当前匹配不唯一，请人工确认。');
  }

  if (includeState && candidate.stateName && !candidate.isInitial) {
    next.push(`selector 候选来自页面状态：${candidate.stateName}。`);
  }

  return uniqueWarnings(next);
}

/**
 * 按模板动作类型修正 AI 返回的步骤类型。
 */
function fixStepType(step: AiDraftStep, source: ImportStepSource | undefined): AiDraftStep {
  if (!source?.actionType) {
    return step;
  }

  const sameType = source.actionType === step.type;
  const fixed: AiDraftStep = {
    ...step,
    type: source.actionType,
    warnings: sameType ? step.warnings : uniqueWarnings([...step.warnings, typeFixWarning])
  };

  if (!sameType) {
    // 类型错位时模型 selector 往往来自错误候选集，必须丢弃后按模板字段重新补全。
    delete fixed.selector;
  }

  return cleanStepFields(fixed, source.actionType);
}

/**
 * 按模板动作类型清理草稿步骤不适用字段。
 */
function cleanStepFields(step: AiDraftStep, type: StepType): AiDraftStep {
  const fixed = { ...step };

  if (!usesMatch(type)) {
    // match 只服务文本和值断言，assertVisible/assertUrl/assertTitle 也不能继承模型误写。
    delete fixed.match;
  }

  if (!isValueType(type)) {
    // click/hover/assertVisible 等不需要 value 的动作，不能继承模型误判时写出的值。
    delete fixed.value;
  }

  return fixed;
}

/**
 * 判断步骤是否需要元素定位器。
 */
function needsSelector(type: StepType) {
  return ['click', 'rightClick', 'doubleClick', 'hover', 'fill', 'select', 'assertVisible', 'assertText', 'assertValue'].includes(type);
}

/**
 * 判断步骤是否依赖展开后的懒加载菜单。
 */
function isLazyMenuStep(source: ImportStepSource) {
  const text = `${source.actionText} ${source.targetText} ${source.note}`;

  // 子菜单通常需要先点击父级后才渲染，第一阶段不凭静态初始 DOM 盲补定位器。
  return /子菜单|下级菜单|展开后|二级菜单|三级菜单/.test(text);
}

/**
 * 查找与自然语言步骤匹配的页面元素候选。
 */
function findSelectorCandidate(source: ImportStepSource, step: AiDraftStep, context: PageContext, kind: SelectorKind) {
  const target = `${readTargetName(source)} ${source.targetText} ${source.actionText} ${step.text}`;
  const items = getSelectorItems(kind, context).filter((item) => item.text && target.includes(item.text));

  return items.sort((left, right) => (right.text?.length ?? 0) - (left.text?.length ?? 0))[0];
}

/**
 * 从多状态页面地图查找与自然语言步骤匹配的元素候选。
 */
function findSelectorCandidateFromPageMap(source: ImportStepSource, step: AiDraftStep, pageMap: DraftPageMap, kind: SelectorKind) {
  const target = `${readTargetName(source)} ${source.targetText} ${source.actionText} ${step.text}`;
  const items = pageMap.states.flatMap((state, index) =>
    getSelectorItems(kind, state.context)
      .filter((item) => item.text && target.includes(item.text))
      .map((item) => ({
        ...item,
        stateId: state.stateId,
        stateName: state.name,
        isInitial: index === 0
      }))
  );

  return items.sort((left, right) => (right.text?.length ?? 0) - (left.text?.length ?? 0))[0];
}

/**
 * 根据步骤类型读取可用的元素候选。
 */
function getSelectorItems(kind: SelectorKind, context: PageContext) {
  const targetItems = getTargetItems(kind.target, context);

  if (targetItems.length > 0) {
    return targetItems;
  }

  if (kind.type === 'fill') {
    return mapInputItems(context.elements.inputs);
  }

  if (kind.type === 'select') {
    return context.elements.selects.map((item) => ({ ...item, text: item.label ?? item.placeholder }));
  }

  return [
    ...context.elements.buttons,
    ...context.elements.links,
    ...context.elements.navigation
  ];
}

/**
 * 读取 selector 补全应该使用的动作和目标类型。
 */
function readSelectorKind(step: AiDraftStep, source: ImportStepSource | undefined): SelectorKind {
  return {
    // 结构化 actionType 来自平台解析，比模型返回的 type 更可信；缺失时才回退模型类型。
    type: source?.actionType ?? step.type,
    target: source?.targetType
  };
}

/**
 * 根据结构化目标类型读取候选集合。
 */
function getTargetItems(target: TargetType | undefined, context: PageContext): PageElement[] {
  if (target === 'input') {
    return mapInputItems(context.elements.inputs);
  }

  if (target === 'select') {
    return context.elements.selects.map((item) => ({ ...item, text: item.label ?? item.placeholder }));
  }

  if (target === 'date') {
    // 日期控件可能是输入框、下拉面板或触发按钮，三类候选都需要保留。
    return [
      ...mapInputItems(context.elements.inputs),
      ...context.elements.selects.map((item) => ({ ...item, text: item.label ?? item.placeholder })),
      ...context.elements.buttons
    ];
  }

  if (target === 'button') {
    return context.elements.buttons;
  }

  if (target === 'link') {
    return context.elements.links;
  }

  if (target === 'menu' || target === 'tab' || target === 'tree') {
    return context.elements.navigation;
  }

  if (target === 'text') {
    // 文本类断言可能来自按钮、链接或导航文案，按现有可定位元素集合兜底。
    return [
      ...context.elements.buttons,
      ...context.elements.links,
      ...context.elements.navigation
    ];
  }

  return [];
}

/**
 * 归一化输入框候选文本。
 */
function mapInputItems(items: PageElement[]) {
  return items.map((item) => ({ ...item, text: item.label ?? item.placeholder }));
}

/**
 * 降低非唯一补全步骤的置信度。
 */
function lowerLevel(level: AiLevel): AiLevel {
  return level === 'high' ? 'medium' : level;
}

/**
 * 去重风险提示。
 */
function uniqueWarnings(values: string[]) {
  return Array.from(new Set(values));
}

/**
 * 读取模型返回的普通文本字段。
 */
function readText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 读取模型返回的步骤类型。
 */
function readStepType(value: unknown): StepType | undefined {
  return stepTypeSchema.safeParse(value).success ? value as StepType : undefined;
}

/**
 * 读取模型返回的置信度。
 */
function readAiLevel(value: unknown): AiLevel {
  if (aiLevelSchema.safeParse(value).success) {
    return value as AiLevel;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'medium';
  }

  // 兼容模型把置信度输出为 0-1 小数或 0-100 百分制数字。
  const score = value > 1 && value <= percentScoreMax ? value / percentScoreMax : value;

  if (score >= highScoreMin) {
    return 'high';
  }

  if (score >= mediumScoreMin) {
    return 'medium';
  }

  return 'low';
}

/**
 * 读取模型返回的风险提示列表。
 */
function readWarnings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}

/**
 * 创建测试环境固定草稿，避免真实模型调用。
 */
function createTestDraft(input: DraftInput): AiCaseDraft {
  const actionSteps = input.steps.map((step, index) => createTestStep(step, index, input));
  const steps = input.caseInfo.expectedResult
    ? [...actionSteps, createExpectedStep(input.caseInfo.expectedResult, actionSteps.length)]
    : actionSteps;

  return {
    name: input.caseInfo.caseName,
    startPath: input.caseInfo.targetUrl,
    steps,
    confidence: getMinLevel(actionSteps.map((step) => step.confidence)),
    warnings: [],
    missingInfo: []
  };
}

/**
 * 创建空页面上下文，供测试环境分组入口在缺少状态时兜底。
 */
function createEmptyContext(targetUrl: string): PageContext {
  return {
    page: { url: targetUrl, title: '', headings: [] },
    elements: {
      buttons: [],
      inputs: [],
      selects: [],
      links: [],
      navigation: [],
      tables: []
    },
    warnings: []
  };
}

/**
 * 创建单个测试环境草稿步骤。
 */
function createTestStep(step: ImportStepSource, index: number, input: DraftInput): AiDraftStep {
  const type = readStepType(step.actionType) ?? inferStepType(step.actionText);
  const draft: AiDraftStep = {
    id: `ai-${index + 1}`,
    type,
    selector: inferSelector(step, type, input.pageContext),
    value: inferStepValue(step, type, input.data),
    text: buildStepText(step, type),
    confidence: 'medium',
    warnings: []
  };

  if (usesMatch(type)) {
    // matchType 只对文本和值断言有意义，其他检查动作不能写入 match。
    draft.match = step.matchType ?? 'contains';
  }

  return draft;
}

/**
 * 创建用例级预期结果兜底断言步骤。
 */
function createExpectedStep(expected: string, index: number): AiDraftStep {
  return {
    id: `ai-${index + 1}`,
    type: 'assertText',
    selector: 'body',
    value: expected,
    match: 'contains',
    text: `检查：${expected}`,
    confidence: 'low',
    warnings: ['检查步骤为 AI 生成草稿，需要用户确认。']
  };
}

/**
 * 根据自然语言动作推断步骤类型。
 */
function inferStepType(text: string): StepType {
  if (/输入|填写/.test(text)) {
    return 'fill';
  }

  if (/选择|下拉/.test(text)) {
    return 'select';
  }

  return 'click';
}

/**
 * 推断测试环境使用的定位器。
 */
function inferSelector(step: ImportStepSource, type: StepType, context: PageContext) {
  if (['assertText', 'assertUrl', 'assertTitle'].includes(type)) {
    return 'body';
  }

  const target = `${readTargetName(step)} ${step.targetText || step.actionText}`;
  const items = getSelectorItems({ type, target: step.targetType }, context);
  const match = items.find((item) => item.text && target.includes(item.text));

  if (match) {
    return match.locator;
  }

  const button = context.elements.buttons.find((item) => target.includes(item.text ?? ''));

  if (button) {
    return button.locator;
  }

  const navigation = context.elements.navigation.find((item) => target.includes(item.text ?? ''));

  if (navigation) {
    return navigation.locator;
  }

  // body 是稳定兜底，仅用于测试环境和 AI 草稿预览，保存前仍会显示低置信风险。
  return 'body';
}

/**
 * 根据数据引用推断输入值。
 */
function inferValue(step: ImportStepSource, data: ImportDataSource[]) {
  const key = step.dataKeys[0];

  if (!key) {
    return undefined;
  }

  return data.find((item) => item.dataKey === key)?.dataValue;
}

/**
 * 读取草稿步骤需要写入的值。
 */
function inferStepValue(step: ImportStepSource, type: StepType, data: ImportDataSource[]) {
  if (isValueType(type)) {
    // 新版两表把输入值和期望值直接放在 inputValue，旧版才通过 dataKeys 查测试数据。
    return step.inputValue || inferValue(step, data);
  }

  return undefined;
}

/**
 * 判断步骤类型是否需要 value 字段。
 */
function isValueType(type: StepType) {
  return ['goto', 'fill', 'select', 'assertText', 'assertValue', 'assertUrl', 'assertTitle'].includes(type);
}

/**
 * 判断步骤类型是否属于检查类动作。
 */
function isAssertType(type: StepType) {
  return assertTypes.includes(type);
}

/**
 * 判断步骤类型是否使用 match 字段。
 */
function usesMatch(type: StepType) {
  return ['assertText', 'assertValue'].includes(type);
}

/**
 * 读取结构化目标名，缺失时兼容旧目标描述。
 */
function readTargetName(step: ImportStepSource) {
  // targetName 是新版两表的人读对象名；旧字段仅在存量模板缺失时兜底。
  return step.targetName || step.targetText || step.actionText;
}

/**
 * 构造测试环境固定草稿的步骤文案。
 */
function buildStepText(step: ImportStepSource, type: StepType) {
  const target = readTargetName(step);

  if (isAssertType(type)) {
    return `检查 ${target}`;
  }

  if (step.actionType && step.targetName) {
    return `${readActionName(type)} ${target}`;
  }

  return step.actionText;
}

/**
 * 读取常见动作中文名。
 */
function readActionName(type: StepType) {
  const names: Partial<Record<StepType, string>> = {
    goto: '打开',
    click: '点击',
    rightClick: '右键',
    doubleClick: '双击',
    hover: '悬停',
    fill: '填写',
    select: '选择',
    wait: '等待',
    assertText: '检查',
    assertVisible: '检查',
    assertValue: '检查',
    assertUrl: '检查',
    assertTitle: '检查'
  };

  return names[type] ?? '操作';
}

/**
 * 取草稿步骤中的最低置信度。
 */
function getMinLevel(levels: AiLevel[]): AiLevel {
  if (levels.includes('low')) {
    return 'low';
  }

  if (levels.includes('medium')) {
    return 'medium';
  }

  return 'high';
}
