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

export const targetTypes = [
  'page',
  'button',
  'input',
  'select',
  'link',
  'menu',
  'tab',
  'dialog',
  'text',
  'table',
  'tree',
  'date',
  'region'
] as const;

export type TargetType = typeof targetTypes[number];

export type MatchType = 'contains' | 'equals' | 'regex';

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

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
}

export type ImportStatus = 'running' | 'pendingReview' | 'partialSaved' | 'completed' | 'failed';

export type ImportItemStatus = 'pending' | 'generating' | 'pendingReview' | 'failed' | 'saved' | 'skipped';

export type SavedCaseState = 'active' | 'missing';

export type AiLevel = 'high' | 'medium' | 'low';

export interface ImportStepSource {
  caseNo: string;
  stepNo: number;
  actionType?: StepType;
  targetType?: TargetType;
  targetName?: string;
  inputValue?: string;
  matchType?: MatchType;
  actionText: string;
  targetText: string;
  dataKeys: string[];
  note: string;
}

export interface ImportDataSource {
  caseNo: string;
  dataKey: string;
  dataName: string;
  dataValue: string;
  note: string;
}

export interface ImportCaseSource {
  caseNo: string;
  caseName: string;
  targetUrl: string;
  precondition: string;
  expectedResult: string;
  note: string;
}

export interface AiDraftStep {
  id: string;
  type: StepType;
  selector?: string;
  value?: string;
  timeout?: number;
  match?: MatchType;
  text: string;
  confidence: AiLevel;
  warnings: string[];
}

export interface AiCaseDraft {
  name: string;
  startPath: string;
  steps: AiDraftStep[];
  confidence: AiLevel;
  warnings: string[];
  missingInfo: string[];
}

export interface AiDebugInfo {
  system: string;
  user: string;
  response?: string;
  parsed?: unknown;
  error?: string;
  updatedAt: string;
}

export interface ImportJob {
  importId: string;
  fileName: string;
  fileHash: string;
  envKey: string;
  status: ImportStatus;
  totalCount: number;
  generatedCount: number;
  savedCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportItem {
  itemId: string;
  caseNo: string;
  caseName: string;
  rowRefs: {
    caseRow: number;
    stepRows: number[];
    dataRows: number[];
  };
  sourceHash: string;
  source: {
    caseInfo: ImportCaseSource;
    steps: ImportStepSource[];
    data: ImportDataSource[];
  };
  draft?: AiCaseDraft;
  aiDebug?: AiDebugInfo;
  review?: CaseReview;
  status: ImportItemStatus;
  errorMessage?: string;
  savedCaseKey?: string;
  savedCaseState?: SavedCaseState;
  savedAt?: string;
  retryCount: number;
  updatedAt: string;
}

export interface ImportSaveResult {
  saved: Array<{ itemId: string; caseKey: string }>;
  failed: Array<{ itemId: string; message: string }>;
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

export interface FullAppConfig {
  server: ServerConfig;
  web: WebConfig;
  runner: RunConfig;
  steps: StepConfig;
  ai: AiConfig;
}

export interface PublicAppConfig {
  steps: StepConfig;
  ai: Omit<AiConfig, 'apiKey'> & { configured: boolean };
}

export type AppConfig = PublicAppConfig;

export interface AuthState {
  path: string;
  createdAt: string;
}

export interface AuthStatus {
  exists: boolean;
  path: string;
}
