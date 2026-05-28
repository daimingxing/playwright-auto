import { Router } from 'express';
import { deletePageMap, listPageMaps, readPageMap } from '../lib/page-map-store';
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
    res.json(await readPageMap(req.params.projectKey, req.params.mapId));
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
