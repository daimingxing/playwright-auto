import type { PageArchive, PageArchiveDetail } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 列出项目下的页面档案。
 */
export function listPageArchives(projectKey: string) {
  return requestJson<PageArchive[]>(`/api/projects/${projectKey}/page-archives`);
}

/**
 * 获取页面档案详情，含 current/previous 版本。
 */
export function getPageArchive(projectKey: string, archiveId: string) {
  return requestJson<PageArchiveDetail>(`/api/projects/${projectKey}/page-archives/${archiveId}`);
}

/**
 * 刷新整个页面档案。
 */
export function refreshPageArchive(projectKey: string, archiveId: string) {
  return requestJson<PageArchiveDetail>(`/api/projects/${projectKey}/page-archives/${archiveId}/refresh`, {
    method: 'POST'
  });
}

/**
 * 删除页面档案，不影响已有测试计划和测试代码。
 */
export function deletePageArchive(projectKey: string, archiveId: string) {
  return requestJson<void>(`/api/projects/${projectKey}/page-archives/${archiveId}`, {
    method: 'DELETE'
  });
}
