import { z } from 'zod';
import type { AiCaseDraft, AiDebugInfo, AiDraftStep, AiLevel, ImportCaseSource, ImportDataSource, ImportStepSource, StepType } from '../../../shared/types';
import { AiJsonError, generateAiJson } from './ai-client';
import type { PageContext } from './page-context';

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
const stepTypeSchema = z.enum([
  'goto',
  'click',
  'rightClick',
  'doubleClick',
  'hover',
  'fill',
  'select',
  'wait',
  'assertText',
  'assertVisible',
  'assertValue',
  'assertUrl',
  'assertTitle'
]);
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

/**
 * 构造 AI 草稿生成输入。
 */
export function buildCaseDraftInput(input: DraftInput) {
  return {
    system: [
      '你是自动化测试用例草稿生成助手。',
      '只把自然语言用例转换为平台结构化草稿步骤。',
      '导入阶段只生成草稿，不执行保存、提交、删除、审批等会修改业务数据的动作。',
      '优先使用页面上下文中的语义定位器，无法确定时降低置信度并写入风险提示。',
      '输出必须包含 name、startPath、steps、confidence、warnings、missingInfo。',
      'steps 中每一项必须直接包含 id、type、text、confidence、warnings；不要把步骤内容包在 source、draft、step 等子对象里。',
      'type 必须是平台 StepType 之一，例如 click、fill、select、assertText。'
    ].join('\n'),
    user: JSON.stringify(
      {
        caseInfo: input.caseInfo,
        steps: input.steps,
        data: input.data,
        pageContext: input.pageContext,
        outputRule: '返回 name、startPath、steps、confidence、warnings、missingInfo，steps 使用平台 StepType。'
      },
      null,
      2
    )
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
      draft: normalizeAiDraftWithDebug(result.parsed, prompt, result.response),
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
  return aiLevelSchema.safeParse(value).success ? value as AiLevel : 'medium';
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
