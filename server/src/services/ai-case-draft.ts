import { z } from 'zod';
import type { AiCaseDraft, AiDraftStep, AiLevel, ImportCaseSource, ImportDataSource, ImportStepSource, StepType } from '../../../shared/types';
import { generateAiJson } from './ai-client';
import type { PageContext } from './page-context';

export interface DraftInput {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  pageContext: PageContext;
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
  id: z.string().min(1),
  type: stepTypeSchema,
  selector: z.string().optional(),
  value: z.string().optional(),
  timeout: z.number().int().nonnegative().optional(),
  match: z.enum(['contains', 'equals', 'regex']).optional(),
  text: z.string().min(1),
  confidence: aiLevelSchema,
  warnings: z.array(z.string())
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
      '优先使用页面上下文中的语义定位器，无法确定时降低置信度并写入风险提示。'
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
    return createTestDraft(input);
  }

  const prompt = buildCaseDraftInput(input);
  const draft = await generateAiJson({
    ...prompt,
    schema: draftSchema
  });

  return normalizeAiDraft(draft);
}

/**
 * 归一化 AI 草稿为平台可保存结构。
 */
export function normalizeAiDraft(value: unknown): AiCaseDraft {
  const draft = draftSchema.parse(value);

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
