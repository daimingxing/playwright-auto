import type { LocatorBuilderState } from './locator-builder';

export const stepTypes = [
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
] as const;

export type StepType = typeof stepTypes[number];

export const stepTypeLabels: Record<StepType, string> = {
  goto: '打开页面',
  click: '点击',
  rightClick: '右键点击',
  doubleClick: '双击',
  hover: '悬停',
  fill: '填写',
  select: '选择',
  wait: '等待',
  assertText: '检查文本',
  assertVisible: '检查可见',
  assertValue: '检查输入值',
  assertUrl: '检查地址',
  assertTitle: '检查标题'
};

export type MatchType = 'contains' | 'equals' | 'regex';

/**
 * 格式化动作类型中文名。
 */
export function formatStepType(type: StepType) {
  return stepTypeLabels[type];
}

export type CaseStatus = 'draft' | 'ready' | 'active';

export interface EnvMeta {
  name: string;
  key: string;
  baseUrl: string;
}

export interface ProjectMeta {
  name: string;
  key: string;
  envs: EnvMeta[];
  defaultEnv: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 用例步骤，也是发布后保存在 case.json 中的 Action IR。
 * 由封闭 Playwright 原语、结构化定位器和可观察等待条件组成。
 */
export interface CaseStep {
  id: string;
  type: StepType;
  selector?: string;
  selectorDraft?: LocatorBuilderState;
  value?: string;
  timeout?: number;
  match?: MatchType;
  pageAlias?: string;
  opensPageAlias?: string;
}

export interface BrowserConfig {
  openTimeoutMs: number;
}
export type ReviewLevel = 'error' | 'danger' | 'warning' | 'info';

export type ReviewGroup = 'integrity' | 'locator' | 'assertion' | 'timeout';

export type CheckStatus = 'unchecked' | 'review-failed' | 'pending-practical' | 'practical-failed' | 'practical-passed';

export interface CaseReviewItem {
  id: string;
  stepId: string;
  stepIndex: number;
  stepType: StepType;
  selector: string;
  level: ReviewLevel;
  group: ReviewGroup;
  ruleCode: string;
  message: string;
  suggestion: string;
}

export interface CaseReviewSummary {
  level: ReviewLevel | 'pass';
  error: number;
  danger: number;
  warning: number;
  info: number;
}

export interface CaseReview {
  summary: CaseReviewSummary;
  items: CaseReviewItem[];
  updatedAt: string;
}

export type PracticalReviewStatus = 'untested' | 'running' | 'passed' | 'failed' | 'expired';

export type PracticalStepReviewStatus = 'passed' | 'failed' | 'skipped';

export type PracticalFailureCode =
  | 'navigation-failed'
  | 'auth-required'
  | 'selector-invalid'
  | 'no-match'
  | 'multiple-match'
  | 'hidden'
  | 'disabled'
  | 'not-editable'
  | 'covered'
  | 'assertion-mismatch'
  | 'timeout'
  | 'unknown';

export interface PracticalReviewArtifact {
  type: 'screenshot' | 'dom' | 'trace';
  path: string;
  url: string;
}

export interface PracticalFailureAnalysis {
  code: PracticalFailureCode;
  message: string;
  suggestion: string;
  currentUrl?: string;
  selector?: string;
  matchCount?: number;
  nearbyText?: string[];
  blockingSelector?: string;
  artifacts?: PracticalReviewArtifact[];
}

export interface PracticalStepReview {
  stepId: string;
  stepIndex: number;
  stepType: StepType;
  status: PracticalStepReviewStatus;
  selector?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  analysis?: PracticalFailureAnalysis;
}

export interface PracticalReviewSummary {
  status: PracticalReviewStatus;
  envKey: string;
  envBaseUrl: string;
  caseSnapshotHash: string;
  stepCount: number;
  reviewId?: string;
  checkedAt?: string;
  failedStepId?: string;
  failedStepIndex?: number;
  failureMessage?: string;
}

export interface PracticalReviewRecord {
  id: string;
  projectKey: string;
  caseKey: string;
  envKey: string;
  envBaseUrl: string;
  status: Exclude<PracticalReviewStatus, 'untested' | 'expired' | 'running'>;
  caseSnapshotHash: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: PracticalStepReview[];
  summary: PracticalReviewSummary;
  artifacts: PracticalReviewArtifact[];
}

export interface CaseMeta {
  name: string;
  key: string;
  status: CaseStatus;
  startPath: string;
  steps: CaseStep[];
  review?: CaseReview;
  practicalReview?: PracticalReviewSummary;
  createdAt: string;
  updatedAt: string;
}

export interface RunMeta {
  id: string;
  projectKey: string;
  envKey: string;
  status: 'created' | 'running' | 'passed' | 'failed';
  reportPath: string;
  reportUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunMode = 'headless' | 'headed';

export interface RunInput {
  envKey?: string;
  mode?: RunMode;
  workers?: number;
  caseKeys?: string[];
}

export interface RunConfig {
  headlessWorkers: number;
  headedWorkers: number;
  maxWorkers: number;
}

export interface ServerConfig {
  port: number;
  dataRoot: string;
  corsOrigins: string[];
}

export interface WebConfig {
  origin: string;
  apiBase: string;
}

export interface StepTimeoutConfig {
  navigation: number;
  action: number;
  wait: number;
}

export interface StepConfig {
  timeouts: StepTimeoutConfig;
}

/**
 * Agent 模型协议。本地只配置一种，由 OpenCode Provider 切换实现。
 */
export type AgentProtocol = 'chat-completions' | 'responses';

/**
 * OpenCode 自定义模型可识别的思考档位。空字符串表示不写入，交给模型服务默认。
 */
export type AgentReasoningEffort = '' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * AI 导入 Agent 本地设置。
 * `apiKey` 只存在于 gitignore 的本地配置或进程环境变量，不进仓库、不进 `/api/app-config`、不进任务目录。
 * `contextLimit` / `outputLimit` / `reasoningEffort` 为 0 或空时不写入 OpenCode 模型段。
 */
export interface AgentConfig {
  protocol: AgentProtocol;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  opencodePath: string;
  playwrightMcpPath: string;
  timeoutMs: number;
  contextLimit: number;
  outputLimit: number;
  reasoningEffort: AgentReasoningEffort;
}

/**
 * 判断当前步骤是否需要选择器。
 */
export function hasStepSelector(type: StepType) {
  return !['goto', 'assertUrl', 'assertTitle', 'wait'].includes(type);
}

/**
 * 判断当前步骤是否需要值输入。
 */
export function hasStepValue(type: StepType) {
  return ['goto', 'fill', 'select', 'assertText', 'assertValue', 'assertUrl', 'assertTitle'].includes(type);
}

/**
 * 判断当前步骤是否需要超时时间。
 */
export function hasStepTimeout(type: StepType) {
  return ['goto', 'click', 'rightClick', 'doubleClick', 'hover', 'fill', 'select', 'wait'].includes(type);
}

/**
 * 按步骤类型读取统一默认超时时间。
 */
export function readStepTimeout(type: StepType, timeouts: StepTimeoutConfig) {
  if (type === 'goto') {
    return timeouts.navigation;
  }

  if (type === 'wait') {
    return timeouts.wait;
  }

  if (hasStepTimeout(type)) {
    return timeouts.action;
  }

  return undefined;
}

export interface FullAppConfig {
  server: ServerConfig;
  web: WebConfig;
  runner: RunConfig;
  browser: BrowserConfig;
  steps: StepConfig;
  agent: AgentConfig;
}

export interface PublicAppConfig {
  browser: BrowserConfig;
  steps: StepConfig;
}

export interface AuthState {
  path: string;
  createdAt: string;
}

export const importActionTypes = ['打开页面', '填写', '选择', '点击', '检查可见', '检查文本'] as const;

export type ImportActionType = (typeof importActionTypes)[number];

/**
 * 导入用例阶段。`parsed` / `parse-failed` 来自 Excel 解析；其后为 Agent 审阅阶段。
 * `pending-review`：已有可审阅 TestIntent，等待确认。
 * `publishable`：已确认，仍未写入正式用例。
 * `published`：已显式发布，正式 case.json 已写入。
 */
export type ImportCaseStatus =
  | 'parsed'
  | 'parse-failed'
  | 'exploring'
  | 'generating'
  | 'pending-review'
  | 'publishable'
  | 'published'
  | 'failed';

/**
 * Agent 失败原因。成功和歧义不是失败，歧义进入待确认。
 */
export type ImportAgentFailureKind =
  | 'login-blocked'
  | 'explore-failed'
  | 'locator-failed'
  | 'cancelled'
  | 'timeout'
  | 'process-failed'
  | 'model-failed';

/**
 * 单条用例的 Agent 失败信息。
 */
export interface ImportCaseFailure {
  kind: ImportAgentFailureKind;
  message: string;
}

/**
 * 意图步骤：业务动作或断言，可引用一个或多个自然语言来源行。
 * 动作类型与 Excel 业务选项一致，不是 Playwright `stepTypes`。
 */
export interface IntentStep {
  id: string;
  action: ImportActionType;
  target: string;
  data: string;
  note: string;
  sourceRefs: ImportSourceRow[];
}

/**
 * 待确认项。歧义或缺失关键条件时标出，不由 Agent 擅自补全。
 */
export interface IntentPendingItem {
  id: string;
  stepId?: string;
  message: string;
}

/**
 * 页面探索得到的已验证结构化定位器。不属于 TestIntent，随探索结果单独保存。
 */
export interface VerifiedLocator {
  selector: string;
  selectorDraft: LocatorBuilderState;
}

/**
 * 单次页面探索产出。供发布编译使用，不写入正式 case.json，直到显式发布。
 */
export interface ExplorationResult {
  locators: Record<string, VerifiedLocator>;
  pageUrl?: string;
}

/**
 * 一条测试用例的业务规格。不描述页面组件、定位器或具体浏览器操作。
 */
export interface TestIntent {
  id: string;
  caseNumber: string;
  name: string;
  startPath: string;
  preconditions: string;
  expected: string;
  remark: string;
  source: ImportSourceRow;
  steps: IntentStep[];
  pendingItems: IntentPendingItem[];
}

/**
 * 导入任务恢复机状态。只覆盖检查点落盘是否完成，不表示探索、审阅或发布。
 * `interrupted`：输入/解析/逐用例检查点尚未全部写完，可恢复。
 * `completed`：本工单负责的检查点已全部落盘，恢复时跳过已成功项。
 */
export type ImportTaskStatus = 'interrupted' | 'completed';

/**
 * 导入任务已成功落盘的最高阶段。
 * `input`：输入快照；`parse`：解析快照；`items`：部分逐用例状态；`completed`：全部检查点已写入。
 */
export type ImportCheckpointStage = 'input' | 'parse' | 'items' | 'completed';

/**
 * 项目级测试资产。内容按 SHA-256 寻址，逻辑文件名由引用方保存。
 */
export interface TestAsset {
  id: string;
  hash: string;
  byteSize: number;
  createdAt: string;
}

/**
 * 任务或用例对测试资产的引用。恢复后仍指向同一资产标识。
 */
export interface TestAssetRef {
  assetId: string;
  fileName: string;
}

/**
 * 检查点中已成功写入的逐用例记录。
 */
export interface ImportCheckpointItem {
  id: string;
  status: ImportCaseStatus;
}

/**
 * 导入任务原子检查点。崩溃时只依赖完整 JSON，不依赖半截文件。
 */
export interface ImportCheckpoint {
  stage: ImportCheckpointStage;
  updatedAt: string;
  items: ImportCheckpointItem[];
  error?: {
    message: string;
    at: string;
  };
}

/**
 * Excel 来源行引用。工作表名、行号和用例编号用于定位，数组下标和 Excel 行号都不是对象标识。
 */
export interface ImportSourceRow {
  sheet: string;
  row: number;
  caseNumber: string;
  cells: Record<string, string>;
}

/**
 * Excel 解析错误，定位到工作表和行号。
 */
export interface ImportParseError {
  sheet: string;
  row: number;
  caseNumber?: string;
  reason: string;
  cells?: Record<string, string>;
}

/**
 * 从「步骤」表解析出的业务步骤，动作为业务级封闭选项。
 */
export interface ImportExcelStep {
  order: number;
  action: ImportActionType;
  target: string;
  data: string;
  note: string;
  source: ImportSourceRow;
}

/**
 * 导入任务中的单条用例。解析后可附带 TestIntent 与 Agent 失败信息。
 */
export interface ImportTaskCase {
  id: string;
  caseNumber: string;
  name: string;
  startPath: string;
  preconditions: string;
  expected: string;
  remark: string;
  status: ImportCaseStatus;
  source: ImportSourceRow;
  steps: ImportExcelStep[];
  errors: ImportParseError[];
  intent?: TestIntent;
  exploration?: ExplorationResult;
  failure?: ImportCaseFailure;
  publishedCaseKey?: string;
}

export type ImportParsedCase = Omit<ImportTaskCase, 'id'>;

/**
 * AI 导入任务摘要。`status` 只表示检查点是否写完，不表示探索或发布。
 */
export interface ImportTask {
  id: string;
  projectKey: string;
  fileName: string;
  fileHash: string;
  assetId: string;
  status: ImportTaskStatus;
  createdAt: string;
  updatedAt: string;
  parsedCount: number;
  failedCount: number;
}

export interface ImportTaskDetail extends ImportTask {
  cases: ImportTaskCase[];
  checkpoint: ImportCheckpoint;
  input: TestAssetRef;
}

/**
 * 恢复导入任务的结果。`processedItemIds` 是本次补写的条目，已成功项在 `skippedItemIds`。
 */
export interface ImportResumeResult extends ImportTaskDetail {
  skippedItemIds: string[];
  processedItemIds: string[];
}
