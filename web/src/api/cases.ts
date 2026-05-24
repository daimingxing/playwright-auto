import type { CaseMeta, CaseStatus, PracticalReviewRecord, RunMode } from '../../../shared/types';
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

export interface PracticalReviewInput {
  envKey?: string;
  mode?: RunMode;
}

export interface BatchStatusInput {
  caseKeys: string[];
  status: CaseStatus;
}

export interface BatchStatusResult {
  updated: Array<{ caseKey: string; status: CaseStatus }>;
  failed: Array<{ caseKey: string; message: string; issues?: unknown[] }>;
}

/**
 * 读取用例状态并兼容历史接口数据。
 */
function readCaseStatus(status: unknown): CaseStatus {
  return status === 'ready' || status === 'active' ? status : 'draft';
}

/**
 * 归一化单条用例，避免历史数据缺少状态时影响界面展示。
 */
function normalizeCase(item: CaseMeta): CaseMeta {
  return {
    ...item,
    status: readCaseStatus(item.status)
  };
}

/**
 * 归一化用例列表。
 */
function normalizeCases(items: CaseMeta[]): CaseMeta[] {
  return items.map(normalizeCase);
}

/**
 * 获取项目用例列表。
 */
export function listCases(projectKey: string) {
  return requestJson<CaseMeta[]>(`/api/projects/${projectKey}/cases`).then(normalizeCases);
}

/**
 * 获取项目回收站。
 */
export function listTrash(projectKey: string) {
  return requestJson<CaseMeta[]>(`/api/projects/${projectKey}/trash`).then(normalizeCases);
}

/**
 * 获取单个测试用例。
 */
export function getCase(projectKey: string, caseKey: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}`).then(normalizeCase);
}

/**
 * 创建测试用例。
 */
export function createCase(projectKey: string, input: CreateCaseInput) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases`, {
    method: 'POST',
    body: JSON.stringify(input)
  }).then(normalizeCase);
}

/**
 * 复制测试用例。
 */
export function copyCase(projectKey: string, caseKey: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}/copy`, {
    method: 'POST'
  }).then(normalizeCase);
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
  }).then(normalizeCase);
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
  }).then(normalizeCase);
}

/**
 * 保存测试用例草稿。
 */
export function saveCaseDraft(projectKey: string, caseKey: string, input: CaseMeta) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}/draft`, {
    method: 'PUT',
    body: JSON.stringify(input)
  }).then(normalizeCase);
}

/**
 * 更新单条测试用例状态。
 */
export function updateCaseStatus(projectKey: string, caseKey: string, status: CaseStatus) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  }).then(normalizeCase);
}

/**
 * 批量更新测试用例状态。
 */
export function batchUpdateCaseStatus(projectKey: string, input: BatchStatusInput) {
  return requestJson<BatchStatusResult>(`/api/projects/${projectKey}/cases/status`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

/**
 * 触发当前用例的实测检查。
 */
export function startPracticalReview(projectKey: string, caseKey: string, input: PracticalReviewInput = {}) {
  return requestJson<PracticalReviewRecord>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 获取当前用例的实测检查历史。
 */
export function listPracticalReviews(projectKey: string, caseKey: string) {
  return requestJson<PracticalReviewRecord[]>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`);
}

/**
 * 获取单条实测检查记录。
 */
export function getPracticalReview(projectKey: string, caseKey: string, reviewId: string) {
  return requestJson<PracticalReviewRecord>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews/${reviewId}`);
}

/**
 * 清理当前用例的实测检查历史。
 */
export function clearPracticalReviews(projectKey: string, caseKey: string) {
  return requestJson<void>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`, {
    method: 'DELETE'
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
  }).then(normalizeCase);
}
