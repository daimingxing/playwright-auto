import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageMap, PageMapSummary } from '../../../shared/types';
import type { PageContext } from '../services/ai/page-context';
import { ensureDir, readJson, writeJson } from './fs';
import { notFound } from './http-error';
import { getPageMapFile, getPageMapPath, getPageMapsPath, getPageMapShotFile } from './path';

/**
 * 创建页面地图摘要文件。
 */
export async function createPageMap(map: PageMap) {
  await writePageMap(map);

  return map;
}

/**
 * 读取单张页面地图摘要。
 */
export async function readPageMap(projectKey: string, mapId: string) {
  try {
    return await readJson<PageMap>(getPageMapFile(projectKey, mapId));
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('页面地图不存在');
    }

    throw error;
  }
}

/**
 * 读取项目页面地图摘要列表。
 */
export async function listPageMaps(projectKey: string) {
  const root = getPageMapsPath(projectKey);

  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const maps = await Promise.all(
    names.map(async (name) => {
      try {
        return await readPageMap(projectKey, name);
      } catch {
        return null;
      }
    })
  );

  return maps
    .filter((item): item is PageMap => Boolean(item))
    .map(toSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * 删除单张页面地图目录。
 */
export async function deletePageMap(projectKey: string, mapId: string) {
  try {
    await rm(getPageMapPath(projectKey, mapId), { recursive: true, force: false });
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('页面地图不存在');
    }

    throw error;
  }
}

/**
 * 写入页面状态快照。
 */
export async function writePageMapShot(projectKey: string, mapId: string, stateId: string, snapshot: PageContext) {
  const shotPath = getPageMapShotFile(projectKey, mapId, stateId);

  await ensureDir(join(getPageMapPath(projectKey, mapId), 'snapshots'));
  await writeJson(shotPath, snapshot);

  return shotPath;
}

/**
 * 批量写入页面状态快照，避免多状态采集方重复处理目录创建细节。
 */
export async function writePageMapShots(projectKey: string, mapId: string, snapshots: Array<{ stateId: string; snapshot: PageContext }>) {
  const paths: Record<string, string> = {};

  for (const item of snapshots) {
    paths[item.stateId] = await writePageMapShot(projectKey, mapId, item.stateId, item.snapshot);
  }

  return paths;
}

/**
 * 读取页面状态快照。
 */
export async function readPageMapShot(projectKey: string, mapId: string, stateId: string) {
  try {
    return await readJson<PageContext>(getPageMapShotFile(projectKey, mapId, stateId));
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('页面状态快照不存在');
    }

    throw error;
  }
}

/**
 * 标记页面地图为建议刷新状态。
 */
export async function markPageMapStale(projectKey: string, mapId: string, warning: string, now = new Date()) {
  const map = await readPageMap(projectKey, mapId);
  const warnings = map.warnings.includes(warning) ? map.warnings : [...map.warnings, warning];
  const nextMap: PageMap = {
    ...map,
    status: 'stale',
    warnings,
    updatedAt: now.toISOString()
  };

  await writePageMap(nextMap);

  return nextMap;
}

/**
 * 覆盖写入页面地图摘要。
 */
export async function writePageMap(map: PageMap) {
  await writeJson(getPageMapFile(map.projectKey, map.mapId), map);

  return map;
}

/**
 * 转换为页面地图列表摘要。
 */
function toSummary(map: PageMap): PageMapSummary {
  return {
    mapId: map.mapId,
    projectKey: map.projectKey,
    envKey: map.envKey,
    targetUrl: map.targetUrl,
    authHash: map.authHash,
    viewport: map.viewport,
    status: map.status,
    stateCount: map.states.length,
    updatedAt: map.updatedAt
  };
}

/**
 * 判断是否为文件不存在错误。
 */
function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
