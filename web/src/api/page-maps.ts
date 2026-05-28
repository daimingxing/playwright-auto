import type { PageMap, PageMapSummary } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 读取项目页面地图摘要列表。
 */
export function listPageMaps(projectKey: string) {
  return requestJson<PageMapSummary[]>(`/api/projects/${projectKey}/page-maps`);
}

/**
 * 读取单张页面地图详情。
 */
export function getPageMap(projectKey: string, mapId: string) {
  return requestJson<PageMap>(`/api/projects/${projectKey}/page-maps/${mapId}`);
}

/**
 * 刷新单张页面地图。
 */
export function refreshPageMap(projectKey: string, mapId: string) {
  return requestJson<PageMap>(`/api/projects/${projectKey}/page-maps/${mapId}/refresh`, {
    method: 'POST'
  });
}

/**
 * 删除单张页面地图。
 */
export function deletePageMap(projectKey: string, mapId: string) {
  return requestJson<void>(`/api/projects/${projectKey}/page-maps/${mapId}`, {
    method: 'DELETE'
  });
}
