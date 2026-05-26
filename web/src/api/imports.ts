import type { ImportItem, ImportJob, ImportSaveResult } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 上传 Excel 并创建 AI 导入任务。
 */
export function createAiImport(projectKey: string, file: File, envKey?: string) {
  const form = new FormData();
  form.append('file', file);

  if (envKey) {
    form.append('envKey', envKey);
  }

  return requestJson<ImportJob & { reused?: boolean }>(`/api/projects/${projectKey}/imports/ai`, {
    method: 'POST',
    body: form,
    headers: {}
  });
}

/**
 * 读取项目 AI 导入任务列表。
 */
export function listImports(projectKey: string) {
  return requestJson<ImportJob[]>(`/api/projects/${projectKey}/imports`);
}

/**
 * 读取单个 AI 导入任务。
 */
export function getImport(projectKey: string, importId: string) {
  return requestJson<ImportJob>(`/api/projects/${projectKey}/imports/${importId}`);
}

/**
 * 读取 AI 导入项列表。
 */
export function listImportItems(projectKey: string, importId: string) {
  return requestJson<ImportItem[]>(`/api/projects/${projectKey}/imports/${importId}/items`);
}

/**
 * 重试生成失败的导入项。
 */
export function retryImportItem(projectKey: string, importId: string, itemId: string) {
  return requestJson<ImportItem>(`/api/projects/${projectKey}/imports/${importId}/items/${itemId}/retry`, {
    method: 'POST'
  });
}

/**
 * 跳过无需保存的导入项。
 */
export function skipImportItem(projectKey: string, importId: string, itemId: string) {
  return requestJson<ImportItem>(`/api/projects/${projectKey}/imports/${importId}/items/${itemId}/skip`, {
    method: 'POST'
  });
}

/**
 * 保存导入项为草稿。
 */
export function saveImportItems(projectKey: string, importId: string, itemIds: string[]) {
  return requestJson<ImportSaveResult>(`/api/projects/${projectKey}/imports/${importId}/save`, {
    method: 'POST',
    body: JSON.stringify({ itemIds })
  });
}
