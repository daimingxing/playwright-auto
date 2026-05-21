export type StepType =
  | 'goto'
  | 'click'
  | 'rightClick'
  | 'doubleClick'
  | 'hover'
  | 'fill'
  | 'select'
  | 'wait'
  | 'assertText'
  | 'assertVisible'
  | 'assertValue'
  | 'assertUrl'
  | 'assertTitle';

export type MatchType = 'contains' | 'equals' | 'regex';

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
  value?: string;
  timeout?: number;
  match?: MatchType;
  pageAlias?: string;
  opensPageAlias?: string;
}

export type ReviewLevel = 'error' | 'danger' | 'warning' | 'info';

export interface CaseReviewItem {
  id: string;
  stepId: string;
  stepIndex: number;
  stepType: StepType;
  selector: string;
  level: ReviewLevel;
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

export interface CaseMeta {
  name: string;
  key: string;
  startPath: string;
  steps: CaseStep[];
  review?: CaseReview;
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

export interface AuthState {
  path: string;
  createdAt: string;
}

export interface AuthStatus {
  exists: boolean;
  path: string;
}
