import { Router } from 'express';
import type { PageMap, PageState } from '../../../shared/types';
import { deletePageMap, listPageMaps, readPageMap, readPageMapShot } from '../lib/page-map-store';
import { refreshPageMap } from '../services/ai/page-map';

interface ProjectParams {
  [key: string]: string;
  projectKey: string;
}

interface PageMapParams extends ProjectParams {
  mapId: string;
}

export const pageMapsRouter = Router({ mergeParams: true });

/**
 * 返回项目下全部页面地图摘要。
 */
pageMapsRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listPageMaps(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

/**
 * 返回单张页面地图详情。
 */
pageMapsRouter.get<PageMapParams>('/:mapId', async (req, res, next) => {
  try {
    res.json(await readPageMapDetail(req.params.projectKey, req.params.mapId));
  } catch (error) {
    next(error);
  }
});

/**
 * 重新采集单张页面地图。
 */
pageMapsRouter.post<PageMapParams>('/:mapId/refresh', async (req, res, next) => {
  try {
    res.json(await refreshPageMap(req.params.projectKey, req.params.mapId));
  } catch (error) {
    next(error);
  }
});

/**
 * 删除单张页面地图缓存。
 */
pageMapsRouter.delete<PageMapParams>('/:mapId', async (req, res, next) => {
  try {
    await deletePageMap(req.params.projectKey, req.params.mapId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * 读取带字段语义的页面地图详情。
 */
async function readPageMapDetail(projectKey: string, mapId: string) {
  const map = await readPageMap(projectKey, mapId);
  const states = await Promise.all(map.states.map((state) => expandStateFields(projectKey, map.mapId, state)));

  return {
    ...map,
    states
  };
}

/**
 * 从状态快照中展开字段语义，兼容旧快照缺失或损坏的情况。
 */
async function expandStateFields(projectKey: string, mapId: string, state: PageState): Promise<PageMap['states'][number] & { fields?: unknown[] }> {
  try {
    const snapshot = await readPageMapShot(projectKey, mapId, state.stateId);
    const fields = Array.isArray(snapshot.fields) ? snapshot.fields : [];

    return {
      ...state,
      fields
    };
  } catch {
    const warning = '页面状态快照读取失败，字段语义未展开';

    return {
      ...state,
      fields: [],
      // 旧缓存可能只有 map.json 没有 snapshot，详情仍应可打开，同时把降级原因暴露给前端。
      warnings: state.warnings.includes(warning) ? state.warnings : [...state.warnings, warning]
    };
  }
}
