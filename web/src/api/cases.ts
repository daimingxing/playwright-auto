import type { CaseMeta } from '../../../shared/types';
import { downloadFile } from './http';
import { requestJson } from './http';

export interface CreateCaseInput {
  name: string;
  startPath: string;
}

export interface RecordSessionResult {
  sessionId: string;
  url: string;
}

export interface RecordInput {
  envKey?: string;
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
 * 下载单条测试用例压缩包。
 */
export function exportCase(projectKey: string, caseKey: string) {
  return downloadFile(`/api/projects/${projectKey}/cases/${caseKey}/export`, `${projectKey}-${caseKey}.zip`);
}

/**
 * 恢复回收站中的测试用例。
 */
export function restoreCase(projectKey: string, caseKey: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/trash/${caseKey}/restore`, {
    method: 'POST'
  });
}

/**
 * 彻底删除回收站中的测试用例。
 */
export function removeTrashCase(projectKey: string, caseKey: string) {
  return requestJson<void>(`/api/projects/${projectKey}/trash/${caseKey}`, {
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

/**
 * 开始录制当前测试用例。
 */
export function startRecord(projectKey: string, caseKey: string, input: RecordInput = {}) {
  return requestJson<RecordSessionResult>(`/api/projects/${projectKey}/cases/${caseKey}/record/start`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 停止录制并导入当前测试用例。
 */
export function stopRecord(projectKey: string, caseKey: string, sessionId: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}/record/stop`, {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}
