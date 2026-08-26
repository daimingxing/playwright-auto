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
