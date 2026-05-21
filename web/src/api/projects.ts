import type { EnvMeta, ProjectMeta } from '../../../shared/types';
import { requestJson } from './http';

export interface CreateProjectInput {
  name: string;
  key: string;
  baseUrl: string;
}

export interface EnvList {
  envs: EnvMeta[];
  defaultEnv: string;
}

export interface UpdateEnvInput {
  name: string;
  baseUrl: string;
}

/**
 * 获取项目列表。
 */
export function listProjects() {
  return requestJson<ProjectMeta[]>('/api/projects');
}

/**
 * 创建测试项目。
 */
export function createProject(input: CreateProjectInput) {
  return requestJson<ProjectMeta>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 获取单个测试项目。
 */
export function getProject(projectKey: string) {
  return requestJson<ProjectMeta>(`/api/projects/${projectKey}`);
}

/**
 * 获取项目环境列表。
 */
export function listProjectEnvs(projectKey: string) {
  return requestJson<EnvList>(`/api/projects/${projectKey}/envs`);
}

/**
 * 新增项目环境。
 */
export function addProjectEnv(projectKey: string, input: EnvMeta) {
  return requestJson<ProjectMeta>(`/api/projects/${projectKey}/envs`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 更新项目环境名称和地址。
 */
export function updateProjectEnv(projectKey: string, envKey: string, input: UpdateEnvInput) {
  return requestJson<ProjectMeta>(`/api/projects/${projectKey}/envs/${envKey}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

/**
 * 删除项目环境。
 */
export function deleteProjectEnv(projectKey: string, envKey: string) {
  return requestJson<void>(`/api/projects/${projectKey}/envs/${envKey}`, {
    method: 'DELETE'
  });
}
