import type { ImportResumeResult, ImportTask, ImportTaskDetail } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 获取项目下的 AI 导入任务列表。
 */
export function listImportTasks(projectKey: string) {
  return requestJson<ImportTask[]>(`/api/projects/${projectKey}/imports`);
}

/**
 * 上传双表 Excel 并创建导入任务。
 */
export function createImportTask(projectKey: string, file: File) {
  const body = new FormData();
  body.append('file', file);

  return requestJson<ImportTaskDetail>(`/api/projects/${projectKey}/imports`, {
    method: 'POST',
    body
  });
}

/**
 * 获取导入任务详情和解析结果。
 */
export function getImportTask(projectKey: string, taskId: string) {
  return requestJson<ImportTaskDetail>(`/api/projects/${projectKey}/imports/${taskId}`);
}

/**
 * 从检查点恢复导入任务，跳过已成功项并继续未完成项。
 */
export function resumeImportTask(projectKey: string, taskId: string) {
  return requestJson<ImportResumeResult>(`/api/projects/${projectKey}/imports/${taskId}/resume`, {
    method: 'POST'
  });
}

/**
 * 对已解析用例运行 Agent，生成可审阅的 TestIntent。
 */
export function reviewImportTask(projectKey: string, taskId: string) {
  return requestJson<ImportTaskDetail>(`/api/projects/${projectKey}/imports/${taskId}/review`, {
    method: 'POST'
  });
}

/**
 * 确认一条待确认用例。确认后变为可发布，不会写入正式用例。
 */
export function confirmImportCase(projectKey: string, taskId: string, caseId: string) {
  return requestJson<ImportTaskDetail>(
    `/api/projects/${projectKey}/imports/${taskId}/cases/${caseId}/confirm`,
    { method: 'POST' }
  );
}

/**
 * 只重试目标用例，不影响已确认条目。
 */
export function retryImportCase(projectKey: string, taskId: string, caseId: string) {
  return requestJson<ImportTaskDetail>(
    `/api/projects/${projectKey}/imports/${taskId}/cases/${caseId}/retry`,
    { method: 'POST' }
  );
}

/**
 * 取消确认，回到待确认。未发布前可以重试。
 */
export function unconfirmImportCase(projectKey: string, taskId: string, caseId: string) {
  return requestJson<ImportTaskDetail>(
    `/api/projects/${projectKey}/imports/${taskId}/cases/${caseId}/unconfirm`,
    { method: 'POST' }
  );
}

/**
 * 显式发布一条已确认用例，写入正式 case.json 并生成 case.spec.ts。
 */
export function publishImportCase(projectKey: string, taskId: string, caseId: string) {
  return requestJson<ImportTaskDetail>(
    `/api/projects/${projectKey}/imports/${taskId}/cases/${caseId}/publish`,
    { method: 'POST' }
  );
}

/**
 * 删除整个导入任务。不影响已发布正式用例和项目资产库。
 */
export function deleteImportTask(projectKey: string, taskId: string) {
  return requestJson<void>(`/api/projects/${projectKey}/imports/${taskId}`, {
    method: 'DELETE'
  });
}
