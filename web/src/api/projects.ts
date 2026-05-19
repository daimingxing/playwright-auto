import type { ProjectMeta } from '../../../shared/types';
import { requestJson } from './http';

export interface CreateProjectInput {
  name: string;
  key: string;
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
