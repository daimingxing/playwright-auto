import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  importActionTypes,
  type ExplorationResult,
  type ImportActionType,
  type ImportAgentFailureKind,
  type ImportTaskCase,
  type IntentPendingItem,
  type IntentStep,
  type TestIntent
} from '../../../../shared/types';
import { buildStartUrl } from '../../../../shared/url';
import { writeJson } from '../../lib/fs';
import { createFakeExplorationLocators } from './verified-locator';

export type AgentOutcomeKind = 'success' | 'ambiguity' | ImportAgentFailureKind;

export interface AgentRunInput {
  projectKey: string;
  taskId: string;
  item: ImportTaskCase;
  workDir: string;
  outputDir: string;
  diagnosticsDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: string;
  storageStatePath?: string;
  executablePath?: string;
}

export type AgentRunResult =
  | { kind: 'success' | 'ambiguity'; intent: TestIntent; exploration?: ExplorationResult }
  | { kind: ImportAgentFailureKind; message: string };

/**
 * 可替换的 Agent 执行接缝。生产默认 OpenCode，测试可注入 Fake。
 */
export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface FakeAgentOptions {
  outcomeFor?(item: ImportTaskCase): AgentOutcomeKind;
  delayMs?: number;
}

const FAILURE_MESSAGES: Record<ImportAgentFailureKind, string> = {
  'login-blocked': '探索被登录态阻塞，请更新项目登录态后重试',
  'explore-failed': '页面探索失败，无法生成测试意图',
  'locator-failed': '未能定位到所需页面目标',
  cancelled: '页面探索已取消',
  timeout: '页面探索超时',
  'process-failed': 'OpenCode 进程失败，无法完成页面探索',
  'model-failed': '模型调用失败，无法完成页面探索'
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
    await writeJson(join(input.workDir, 'input.json'), {
      caseId: input.item.id,
      caseNumber: input.item.caseNumber,
      baseUrl: input.baseUrl ?? '',
      hasStorageState: Boolean(input.storageStatePath)
    });

    const aborted = await waitUnlessAborted(input, this.options.delayMs ?? 0);

    if (aborted) {
      const result = { kind: aborted, message: FAILURE_MESSAGES[aborted] };
      await writeJson(join(input.diagnosticsDir, 'agent.json'), result);
      return result;
    }

    const kind = this.options.outcomeFor?.(input.item) ?? inferFakeOutcome(input.item);

    if (kind !== 'success' && kind !== 'ambiguity') {
      const result = { kind, message: FAILURE_MESSAGES[kind] };
      await writeJson(join(input.diagnosticsDir, 'agent.json'), result);
      return result;
    }

    const intent = toTestIntent(input.item, kind === 'ambiguity');
    const exploration: ExplorationResult = {
      locators: createFakeExplorationLocators(intent.steps),
      ...(input.baseUrl ? { pageUrl: joinFakeUrl(input.baseUrl, input.item.startPath) } : {})
    };
    await writeJson(join(input.workDir, 'intent-draft.json'), intent);
    await writeJson(join(input.outputDir, 'exploration.json'), exploration);
    return { kind, intent, exploration };
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
    applyAmbiguityPending({ pendingItems, steps }, undefined);
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

const DEFAULT_AMBIGUITY_PENDING = '目标描述存在歧义，请确认具体页面对象后再继续';

/**
 * 把探索发现的歧义挂到最相关的意图步骤上，优先使用探索给出的说明。
 */
export function applyAmbiguityPending(
  intent: Pick<TestIntent, 'pendingItems' | 'steps'>,
  message?: string
) {
  const step =
    intent.steps.find((item) => item.action === '检查文本') ??
    intent.steps.find((item) => Boolean(item.target)) ??
    intent.steps[0];
  intent.pendingItems.splice(0, intent.pendingItems.length, {
    id: createPrefixedId('cfm'),
    stepId: step?.id,
    message: message?.trim() || DEFAULT_AMBIGUITY_PENDING
  });
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

  if (includesAny(text, ['取消', 'cancel'])) {
    return 'cancelled';
  }

  if (includesAny(text, ['超时', 'timeout'])) {
    return 'timeout';
  }

  if (includesAny(text, ['进程失败', 'process-fail', 'process failed'])) {
    return 'process-failed';
  }

  if (includesAny(text, ['模型失败', 'model-fail', 'model failed'])) {
    return 'model-failed';
  }

  return 'success';
}

/**
 * 等待 Fake 延迟，取消或超时立即结束。
 */
async function waitUnlessAborted(
  input: AgentRunInput,
  delayMs: number
): Promise<Extract<AgentOutcomeKind, 'cancelled' | 'timeout'> | null> {
  if (input.signal?.aborted) {
    return 'cancelled';
  }

  const timeoutMs = input.timeoutMs;

  if (delayMs <= 0 && timeoutMs === undefined) {
    return null;
  }

  if (timeoutMs !== undefined && timeoutMs <= 0) {
    return 'timeout';
  }

  return new Promise((resolve) => {
    const finish = (kind: Extract<AgentOutcomeKind, 'cancelled' | 'timeout'> | null) => {
      clearTimeout(delayTimer);
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      input.signal?.removeEventListener('abort', onAbort);
      resolve(kind);
    };
    const onAbort = () => finish('cancelled');
    const delayTimer = setTimeout(() => finish(null), Math.max(delayMs, 0));
    const timeoutTimer =
      timeoutMs === undefined ? undefined : setTimeout(() => finish('timeout'), timeoutMs);
    input.signal?.addEventListener('abort', onAbort, { once: true });
  });
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
 * 拼接 Fake 探索用的页面地址，仅写入过程资料。
 */
function joinFakeUrl(baseUrl: string, startPath: string) {
  return buildStartUrl(baseUrl, startPath);
}

/**
 * 保留动作类型符号，供 Fake 与校验共用。
 */
export function isIntentActionType(value: string): value is ImportActionType {
  return (importActionTypes as readonly string[]).includes(value);
}
