import type { CaseMeta } from '../../../shared/types';
import { requestJson } from './http';

export interface CreateCaseInput {
  name: string;
  startPath: string;
}

/**
 * 获取项目用例列表。
 */
export function listCases(projectKey: string) {
  return requestJson<CaseMeta[]>(`/api/projects/${projectKey}/cases`);
}

/**
 * 获取项目回收站。
 */
export function listTrash(projectKey: string) {
  return requestJson<CaseMeta[]>(`/api/projects/${projectKey}/trash`);
}

/**
 * 获取单个测试用例。
 */
export function getCase(projectKey: string, caseKey: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}`);
}

/**
 * 创建测试用例。
 */
export function createCase(projectKey: string, input: CreateCaseInput) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 删除测试用例到回收站。
 */
export function deleteCase(projectKey: string, caseKey: string) {
  return requestJson<void>(`/api/projects/${projectKey}/cases/${caseKey}`, {
    method: 'DELETE'
  });
}

/**
 * 更新测试用例。
 */
export function updateCase(projectKey: string, caseKey: string, input: CaseMeta) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}
