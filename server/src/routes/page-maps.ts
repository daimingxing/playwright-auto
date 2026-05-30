import { Router } from 'express';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ImportStepSource, PageMap, PageState, UiLibrary } from '../../../shared/types';
import { readJson } from '../lib/fs';
import { listImportItems, listImportJobs } from '../lib/import-store';
import { deletePageMap, listPageMaps, readPageMap } from '../lib/page-map-store';
import { getPageMapPath } from '../lib/path';
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
    const steps = await readRefreshSteps(req.params.projectKey, req.params.mapId);

    res.json(await refreshPageMap(req.params.projectKey, req.params.mapId, { steps }));
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
  const states = await Promise.all(map.states.map((state) => expandStateFields(projectKey, mapId, state)));

  return {
    ...map,
    states
  };
}

/**
 * 读取刷新页面地图时可复用的导入源步骤。
 */
async function readRefreshSteps(projectKey: string, mapId: string): Promise<ImportStepSource[]> {
  const map = await readPageMap(projectKey, mapId);
  const jobs = await listImportJobs(projectKey);
  const steps: ImportStepSource[] = [];

  for (const job of jobs) {
    if (!isSameMapScope(map, job.envKey, job.uiLibrary)) {
      continue;
    }

    const items = await listImportItems(projectKey, job.importId);

    for (const item of items) {
      if (item.pageMapId === mapId || item.groupId === mapId || (!item.pageMapId && item.source.caseInfo.targetUrl.trim() === map.targetUrl)) {
        steps.push(...item.source.steps);
      }
    }
  }

  return steps;
}

/**
 * 判断导入任务是否属于当前页面地图的环境和控件库范围。
 */
function isSameMapScope(map: PageMap, envKey: string, uiLibrary: UiLibrary | undefined) {
  return map.envKey === envKey && (map.uiLibrary ?? 'auto') === (uiLibrary ?? 'auto');
}

/**
 * 从状态快照中展开字段语义，兼容旧快照缺失或损坏的情况。
 */
async function expandStateFields(projectKey: string, mapId: string, state: PageState): Promise<PageMap['states'][number] & { fields?: unknown[] }> {
  if (!isSafeSnapshotPath(projectKey, mapId, state.snapshotPath)) {
    return withEmptyFields(state, '页面状态快照路径越界，字段语义未展开');
  }

  try {
    const snapshot = await readJson<{ fields?: unknown[] }>(state.snapshotPath);
    const fields = Array.isArray(snapshot.fields) ? snapshot.fields : [];

    return {
      ...state,
      fields
    };
  } catch {
    return withEmptyFields(state, '页面状态快照读取失败，字段语义未展开');
  }
}

/**
 * 判断快照路径是否仍位于当前页面地图目录内。
 */
function isSafeSnapshotPath(projectKey: string, mapId: string, snapshotPath: string) {
  const mapPath = getPageMapPath(projectKey, mapId);
  const resolvedMapPath = resolve(mapPath);
  const resolvedSnapshotPath = resolve(snapshotPath);
  const childPath = relative(resolvedMapPath, resolvedSnapshotPath);

  // relative 会按路径片段计算包含关系，可避免 C:\foo\bar2 被当作 C:\foo\bar 的子目录。
  return childPath === '' || (!childPath.startsWith('..') && !isAbsolute(childPath));
}

/**
 * 返回字段语义降级后的页面状态。
 */
function withEmptyFields(state: PageState, warning: string): PageMap['states'][number] & { fields: unknown[] } {
  return {
    ...state,
    fields: [],
    // 旧缓存可能只有 map.json 没有 snapshot，详情仍应可打开，同时把降级原因暴露给前端。
    warnings: state.warnings.includes(warning) ? state.warnings : [...state.warnings, warning]
  };
}
