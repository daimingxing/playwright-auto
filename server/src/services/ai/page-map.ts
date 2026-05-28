import type { PageMap, PageState } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import { badRequest, HttpError } from '../../lib/http-error';
import { createPageMapKey, createPageMapId, getAuthHash, getPageMapShotFile } from '../../lib/path';
import { createPageMap, markPageMapStale, readPageMap, writePageMapShot } from '../../lib/page-map-store';
import { collectInitialPage, PageContextError, type PageContext } from './page-context';

interface PageMapInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  staleDays?: number;
  now?: Date;
}

const msPerDay = 24 * 60 * 60 * 1000;
const initialStateId = 'state-initial';

/**
 * 获取可复用页面地图，没有缓存时执行初始静态采集。
 */
export async function getPageMap(input: PageMapInput) {
  const now = input.now ?? new Date();
  const pageMapConfig = getAppConfig().ai.pageMap;
  const staleDays = input.staleDays ?? pageMapConfig.staleDays;
  const key = createPageMapKey({
    projectKey: input.projectKey,
    envKey: input.envKey,
    targetUrl: input.targetUrl,
    authHash: await getAuthHash(input.projectKey, input.envKey),
    viewport: input.viewport
  });
  const mapId = createPageMapId(key);
  const cached = await readCache(input.projectKey, mapId);

  if (cached) {
    return markStaleIfNeeded(cached, staleDays, now);
  }

  if (!pageMapConfig.autoCreate) {
    return createMissingMap({
      projectKey: key.projectKey,
      envKey: key.envKey,
      targetUrl: key.targetUrl,
      authHash: key.authHash,
      viewport: key.viewport,
      mapId,
      now
    });
  }

  return createInitialMap({
    projectKey: key.projectKey,
    envKey: key.envKey,
    targetUrl: key.targetUrl,
    authHash: key.authHash,
    viewport: key.viewport,
    mapId,
    now
  });
}

/**
 * 按已有页面地图关键字段重新采集并覆盖页面地图缓存。
 */
export async function refreshPageMap(projectKey: string, mapId: string, now = new Date()) {
  const oldMap = await readPageMap(projectKey, mapId);

  return createInitialMap({
    projectKey: oldMap.projectKey,
    envKey: oldMap.envKey,
    targetUrl: oldMap.targetUrl,
    authHash: oldMap.authHash,
    viewport: oldMap.viewport,
    mapId: oldMap.mapId,
    now,
    saveFailed: false
  });
}

/**
 * 创建未落盘的页面地图不可用结果。
 */
function createMissingMap(input: {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  authHash: string;
  viewport: {
    width: number;
    height: number;
  };
  mapId: string;
  now: Date;
}): PageMap {
  return {
    mapId: input.mapId,
    projectKey: input.projectKey,
    envKey: input.envKey,
    targetUrl: input.targetUrl,
    authHash: input.authHash,
    viewport: input.viewport,
    status: 'failed',
    states: [],
    // 自动创建关闭时只能返回内存态诊断结果，避免误写 map.json 或 snapshot。
    warnings: ['页面地图缓存不存在，且已关闭自动创建。请开启页面地图自动创建，或先手动生成页面地图缓存。'],
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString()
  };
}

/**
 * 创建初始页面地图并持久化 snapshot。
 */
async function createInitialMap(input: {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  authHash: string;
  viewport: {
    width: number;
    height: number;
  };
  mapId: string;
  now: Date;
  saveFailed?: boolean;
}) {
  try {
    const context = await collectInitialPage({
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl
    });
    await writePageMapShot(input.projectKey, input.mapId, initialStateId, context);

    const map: PageMap = {
      mapId: input.mapId,
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl,
      authHash: input.authHash,
      viewport: input.viewport,
      status: 'ready',
      states: [toInitialState(input.projectKey, input.mapId, context, input.now)],
      warnings: context.warnings,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };

    return createPageMap(map);
  } catch (error) {
    const warning = getErrorText(error);

    if (input.saveFailed === false) {
      throw badRequest(`页面地图刷新失败：${warning}`);
    }

    const map: PageMap = {
      mapId: input.mapId,
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl,
      authHash: input.authHash,
      viewport: input.viewport,
      status: 'failed',
      states: [],
      warnings: [warning],
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };

    return createPageMap(map);
  }
}

/**
 * 把页面上下文包装为初始页面状态。
 */
function toInitialState(projectKey: string, mapId: string, context: PageContext, now: Date): PageState {
  return {
    stateId: initialStateId,
    name: '初始页面',
    url: context.page.url,
    title: context.page.title,
    snapshotPath: getPageMapShotFile(projectKey, mapId, initialStateId),
    warnings: context.warnings,
    createdAt: now.toISOString()
  };
}

/**
 * 缓存超过建议天数时只标记 stale，不清理历史文件。
 */
async function markStaleIfNeeded(map: PageMap, staleDays: number, now: Date) {
  const updatedTime = new Date(map.updatedAt).getTime();

  if (!Number.isFinite(updatedTime)) {
    return map;
  }

  // staleDays 是按自然天配置的建议刷新阈值，超过后仍保留缓存，避免历史快照被意外删除。
  const isStale = now.getTime() - updatedTime > staleDays * msPerDay;

  if (!isStale || map.status === 'stale' || map.status === 'failed') {
    return map;
  }

  return markPageMapStale(map.projectKey, map.mapId, `页面地图已超过 ${staleDays} 天，建议刷新后再使用。`, now);
}

/**
 * 尝试读取已有页面地图缓存。
 */
async function readCache(projectKey: string, mapId: string) {
  try {
    return await readPageMap(projectKey, mapId);
  } catch (error) {
    if (isMissingMap(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * 读取页面采集错误的中文说明。
 */
function getErrorText(error: unknown) {
  if (error instanceof PageContextError) {
    return error.message;
  }

  return error instanceof Error ? `页面地图初始采集失败：${error.message}` : '页面地图初始采集失败：未知错误';
}

/**
 * 判断错误是否表示页面地图不存在。
 */
function isMissingMap(error: unknown) {
  return error instanceof HttpError && error.status === 404;
}
