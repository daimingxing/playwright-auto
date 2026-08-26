import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  importActionTypes,
  type ImportActionType,
  type ImportAgentFailureKind,
  type ImportTaskCase,
  type IntentPendingItem,
  type IntentStep,
  type TestIntent
} from '../../../../shared/types';
import { writeJson } from '../../lib/fs';

export type AgentOutcomeKind = 'success' | 'ambiguity' | ImportAgentFailureKind;

export interface AgentRunInput {
  projectKey: string;
  taskId: string;
  item: ImportTaskCase;
  workDir: string;
  outputDir: string;
  diagnosticsDir: string;
}

export type AgentRunResult =
  | { kind: 'success' | 'ambiguity'; intent: TestIntent }
  | { kind: ImportAgentFailureKind; message: string };

/**
 * 可替换的 Agent 执行接缝。本工单默认 Fake，后续可换成 OpenCode 实现。
 */
export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface FakeAgentOptions {
  outcomeFor?(item: ImportTaskCase): AgentOutcomeKind;
}

const FAILURE_MESSAGES: Record<ImportAgentFailureKind, string> = {
  'login-blocked': '探索被登录态阻塞，请更新项目登录态后重试',
  'explore-failed': '页面探索失败，无法生成测试意图',
  'locator-failed': '未能定位到所需页面目标'
};

/**
 * 创建默认 Fake AgentRunner。
 */
export function createFakeAgentRunner(options: FakeAgentOptions = {}): AgentRunner {
  return new FakeAgentRunner(options);
}

/**
 * 按固定规则产出 TestIntent 或失败结果，不调用真实模型或浏览器。
 */
export class FakeAgentRunner implements AgentRunner {
  constructor(private readonly options: FakeAgentOptions = {}) {}

  /**
   * 根据解析用例生成候选测试意图，或返回固定失败类型。
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const kind = this.options.outcomeFor?.(input.item) ?? inferFakeOutcome(input.item);
    await writeJson(join(input.workDir, 'input.json'), {
      caseId: input.item.id,
      caseNumber: input.item.caseNumber,
      kind
    });

    if (kind === 'login-blocked' || kind === 'explore-failed' || kind === 'locator-failed') {
      const result = { kind, message: FAILURE_MESSAGES[kind] };
      await writeJson(join(input.diagnosticsDir, 'agent.json'), result);
      return result;
    }

    const intent = toTestIntent(input.item, kind === 'ambiguity');
    await writeJson(join(input.workDir, 'intent-draft.json'), intent);
    return { kind, intent };
  }
}

/**
 * 把已解析的业务步骤转成 TestIntent，动作用 Excel 业务类型而不是 Playwright 步骤。
 */
export function toTestIntent(item: ImportTaskCase, ambiguous = false): TestIntent {
  const usedStepIds = new Set<string>();
  const steps: IntentStep[] = item.steps.map((step) => ({
    id: createUniquePrefixedId('stp', usedStepIds),
    action: step.action,
    target: step.target,
    data: step.data,
    note: step.note,
    sourceRefs: [step.source]
  }));
  const pendingItems: IntentPendingItem[] = [];

  if (ambiguous) {
    const target = steps.find((step) => Boolean(step.target)) ?? steps[0];
    pendingItems.push({
      id: createPrefixedId('cfm'),
      stepId: target?.id,
      message: '目标描述存在歧义，请确认具体页面对象后再继续'
    });
  }

  return {
    id: item.id,
    caseNumber: item.caseNumber,
    name: item.name,
    startPath: item.startPath,
    preconditions: item.preconditions,
    expected: item.expected,
    remark: item.remark,
    source: item.source,
    steps,
    pendingItems
  };
}

/**
 * 根据备注或名称推断 Fake 结果，便于用 Excel 夹具覆盖各类结果。
 */
export function inferFakeOutcome(item: ImportTaskCase): AgentOutcomeKind {
  const text = `${item.remark} ${item.name} ${item.caseNumber}`.toLowerCase();

  if (includesAny(text, ['歧义', 'ambiguity'])) {
    return 'ambiguity';
  }

  if (includesAny(text, ['登录', 'login'])) {
    return 'login-blocked';
  }

  if (includesAny(text, ['探索失败', 'explore-fail', 'explore failed'])) {
    return 'explore-failed';
  }

  if (includesAny(text, ['定位失败', 'locator-fail', 'locator failed'])) {
    return 'locator-failed';
  }

  return 'success';
}

/**
 * 判断文本是否包含任一关键词。
 */
function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

/**
 * 生成带前缀的稳定标识，不使用 Excel 行号或数组下标。
 */
function createPrefixedId(prefix: string) {
  return `${prefix}-${formatDatePart(new Date())}-${formatTimePart(new Date())}-${randomBytes(2).toString('hex')}`;
}

/**
 * 生成任务内唯一的带前缀标识。
 */
function createUniquePrefixedId(prefix: string, used: Set<string>) {
  let id = createPrefixedId(prefix);

  while (used.has(id)) {
    id = createPrefixedId(prefix);
  }

  used.add(id);
  return id;
}

/**
 * 格式化标识中的日期部分。
 */
function formatDatePart(date: Date) {
  return `${date.getFullYear()}${padNumber(date.getMonth() + 1)}${padNumber(date.getDate())}`;
}

/**
 * 格式化标识中的时间部分。
 */
function formatTimePart(date: Date) {
  return `${padNumber(date.getHours())}${padNumber(date.getMinutes())}${padNumber(date.getSeconds())}`;
}

/**
 * 将数字补齐为两位字符串。
 */
function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * 保留动作类型符号，供 Fake 与校验共用。
 */
export function isIntentActionType(value: string): value is ImportActionType {
  return (importActionTypes as readonly string[]).includes(value);
}
