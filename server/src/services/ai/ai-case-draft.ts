import { z } from 'zod';
import { stepTypes, type AiCaseDraft, type AiDebugInfo, type AiDraftStep, type AiLevel, type ImportCaseSource, type ImportDataSource, type ImportStepSource, type StepType } from '../../../../shared/types';
import { AiJsonError, generateAiJson } from './ai-client';
import type { PageContext } from './page-context';
import { buildAiCaseDraftSystemPrompt, buildAiCaseDraftUserPrompt } from '../../prompts/ai-case-draft-prompt';

export interface DraftInput {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  pageContext: PageContext;
}

export interface DraftResult {
  draft: AiCaseDraft;
  aiDebug: AiDebugInfo;
}

interface SelectorCompleteInput {
  steps: ImportStepSource[];
  pageContext: PageContext;
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
  if (step.selector || !source || !needsSelector(step.type) || isLazyMenuStep(source)) {
    return step;
  }

  const candidate = findSelectorCandidate(source, step, context);

  if (!candidate) {
    return step;
  }

  return {
    ...step,
    selector: candidate.locator,
    confidence: candidate.unique ? step.confidence : lowerLevel(step.confidence),
    warnings: candidate.unique
      ? step.warnings
      : uniqueWarnings([...step.warnings, '平台根据页面上下文自动补充 selector，但该定位器当前匹配不唯一，请人工确认。'])
  };
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
function findSelectorCandidate(source: ImportStepSource, step: AiDraftStep, context: PageContext) {
  const target = `${source.targetText} ${source.actionText} ${step.text}`;
  const items = getSelectorItems(step.type, context).filter((item) => item.text && target.includes(item.text));

  return items.sort((left, right) => (right.text?.length ?? 0) - (left.text?.length ?? 0))[0];
}

/**
 * 根据步骤类型读取可用的元素候选。
 */
function getSelectorItems(type: StepType, context: PageContext) {
  if (type === 'fill') {
    return context.elements.inputs.map((item) => ({ ...item, text: item.placeholder ?? item.label }));
  }

  if (type === 'select') {
    return context.elements.selects.map((item) => ({ ...item, text: item.label ?? item.placeholder }));
  }

  return [
    ...context.elements.buttons,
    ...context.elements.links,
    ...context.elements.navigation
  ];
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
  const actionSteps = input.steps.map((step, index): AiDraftStep => ({
    id: `ai-${index + 1}`,
    type: inferStepType(step.actionText),
    selector: inferSelector(step, input.pageContext),
    value: inferValue(step, input.data),
    text: step.actionText,
    confidence: 'medium',
    warnings: []
  }));
  const assertStep: AiDraftStep = {
    id: `ai-${actionSteps.length + 1}`,
    type: 'assertText',
    selector: 'body',
    value: input.caseInfo.expectedResult,
    match: 'contains',
    text: `检查：${input.caseInfo.expectedResult}`,
    confidence: 'low',
    warnings: ['检查步骤为 AI 生成草稿，需要用户确认。']
  };

  return {
    name: input.caseInfo.caseName,
    startPath: input.caseInfo.targetUrl,
    steps: [...actionSteps, assertStep],
    confidence: getMinLevel(actionSteps.map((step) => step.confidence)),
    warnings: [],
    missingInfo: []
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
function inferSelector(step: ImportStepSource, context: PageContext) {
  const target = step.targetText || step.actionText;
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
