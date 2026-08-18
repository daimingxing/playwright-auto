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
}

export interface PublicAppConfig {
  browser: BrowserConfig;
  steps: StepConfig;
}

export interface AuthState {
  path: string;
  createdAt: string;
}
