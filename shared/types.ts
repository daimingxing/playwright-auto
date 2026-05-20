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
}

export interface CaseMeta {
  name: string;
  key: string;
  startPath: string;
  steps: CaseStep[];
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
