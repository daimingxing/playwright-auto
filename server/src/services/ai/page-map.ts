import { createHash } from 'node:crypto';
import type { ImportStepSource, PageAction, PageMap, PageState, UiLibrary } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import { badRequest, HttpError } from '../../lib/http-error';
import { createPageMapKey, createPageMapId, getAuthHash, getPageMapShotFile } from '../../lib/path';
import { createPageMap, markPageMapStale, readPageMap, writePageMapShots } from '../../lib/page-map-store';
import { buildPageActions } from './page-action';
import { collectInitialPage, collectPageMapStates, PageContextError, type CollectedPageState, type PageContext } from './page-context';

interface PageMapInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  authHash?: string;
  uiLibrary?: UiLibrary;
  staleDays?: number;
  steps?: ImportStepSource[];
  now?: Date;
}

interface PageActionPlan {
  actions: PageAction[];
  warnings: string[];
  actionHash?: string;
}

interface RefreshPageMapOptions {
  now?: Date;
  steps?: ImportStepSource[];
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
  const actionPlan = buildActionPlan(input.steps ?? [], pageMapConfig.maxDepth, pageMapConfig.maxActions);
  const key = createPageMapKey({
    projectKey: input.projectKey,
    envKey: input.envKey,
    targetUrl: input.targetUrl,
    authHash: input.authHash ?? await getAuthHash(input.projectKey, input.envKey),
    viewport: input.viewport,
    uiLibrary: input.uiLibrary ?? 'auto',
    actionHash: actionPlan.actionHash
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
      uiLibrary: key.uiLibrary,
      mapId,
      now,
      actionHash: actionPlan.actionHash
    });
  }

  return createInitialMap({
    projectKey: key.projectKey,
    envKey: key.envKey,
    targetUrl: key.targetUrl,
    authHash: key.authHash,
    viewport: key.viewport,
    uiLibrary: key.uiLibrary,
    mapId,
    now,
    actionHash: actionPlan.actionHash,
    actionPlan
  });
}

/**
 * 按已有页面地图关键字段重新采集并覆盖页面地图缓存。
 */
export async function refreshPageMap(projectKey: string, mapId: string, options: RefreshPageMapOptions = {}) {
  const oldMap = await readPageMap(projectKey, mapId);
  const pageMapConfig = getAppConfig().ai.pageMap;
  const actionPlan = buildActionPlan(options.steps ?? [], pageMapConfig.maxDepth, pageMapConfig.maxActions);

  return createInitialMap({
    projectKey: oldMap.projectKey,
    envKey: oldMap.envKey,
    targetUrl: oldMap.targetUrl,
    authHash: oldMap.authHash,
    viewport: oldMap.viewport,
    uiLibrary: oldMap.uiLibrary ?? 'auto',
    mapId: oldMap.mapId,
    now: options.now ?? new Date(),
    actionHash: actionPlan.actionHash ?? oldMap.actionHash,
    actionPlan,
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
  uiLibrary: UiLibrary;
  mapId: string;
  now: Date;
  actionHash?: string;
}): PageMap {
  return {
    mapId: input.mapId,
    projectKey: input.projectKey,
    envKey: input.envKey,
    targetUrl: input.targetUrl,
    authHash: input.authHash,
    viewport: input.viewport,
    uiLibrary: input.uiLibrary,
    actionHash: input.actionHash,
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
  uiLibrary: UiLibrary;
  mapId: string;
  now: Date;
  actionHash?: string;
  actionPlan?: PageActionPlan;
  saveFailed?: boolean;
}) {
  try {
    const appConfig = getAppConfig();
    const actionPlan = input.actionPlan ?? buildActionPlan([], appConfig.ai.pageMap.maxDepth, appConfig.ai.pageMap.maxActions);
    // openTimeoutMs 仅用于浏览器初始打开业务 URL，不影响 AI 模型请求超时或探索动作等待。
    const openTimeoutMs = appConfig.browser.openTimeoutMs;
    const collected = await collectMapStates({
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl,
      actions: actionPlan.actions,
      openTimeoutMs,
      uiLibrary: input.uiLibrary
    });
    const states = await toPageStates(input.projectKey, input.mapId, collected.states, input.now);

    const map: PageMap = {
      mapId: input.mapId,
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl,
      authHash: input.authHash,
      viewport: input.viewport,
      uiLibrary: input.uiLibrary,
      actionHash: input.actionHash ?? actionPlan.actionHash,
      status: 'ready',
      states,
      warnings: uniqueWarnings([...actionPlan.warnings, ...collected.warnings]),
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
      uiLibrary: input.uiLibrary,
      actionHash: input.actionHash,
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
 * 生成页面地图探索动作计划及稳定摘要。
 */
function buildActionPlan(steps: ImportStepSource[], maxDepth: number, maxActions: number): PageActionPlan {
  const actionResult = buildPageActions({ steps, maxDepth });
  // maxActions 限制本次真实浏览器动作数量，避免大模板拖慢导入和页面地图生成。
  const actions = actionResult.actions.slice(0, maxActions);
  const limitWarnings = actionResult.actions.length > maxActions ? [`已截断超过 ${maxActions} 个的页面探索动作。`] : [];

  return {
    actions,
    warnings: [...actionResult.warnings, ...limitWarnings],
    actionHash: createActionHash(actions)
  };
}

/**
 * 为安全探索动作生成缓存摘要。
 */
function createActionHash(actions: PageAction[]) {
  if (actions.length === 0) {
    return undefined;
  }

  const text = JSON.stringify(actions.map((action) => ({
    type: action.type,
    targetType: action.targetType,
    targetName: action.targetName,
    value: action.value,
    path: action.path
  })));

  return `actions-${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}

/**
 * 根据是否存在探索动作采集页面地图状态。
 */
async function collectMapStates(input: {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  actions: PageAction[];
  openTimeoutMs: number;
  uiLibrary: UiLibrary;
}) {
  if (input.actions.length === 0) {
    const context = await collectInitialPage({
      projectKey: input.projectKey,
      envKey: input.envKey,
      targetUrl: input.targetUrl,
      uiLibrary: input.uiLibrary
    });

    return {
      states: [{ context }],
      warnings: context.warnings
    };
  }

  return collectPageMapStates(input);
}

/**
 * 把采集结果包装为页面状态并写入快照。
 */
async function toPageStates(projectKey: string, mapId: string, states: CollectedPageState[], now: Date): Promise<PageState[]> {
  const pageStates = states.map((state, index) => toPageState(projectKey, mapId, state, index, now));

  await writePageMapShots(projectKey, mapId, pageStates.map((state, index) => ({
    stateId: state.stateId,
    snapshot: states[index].context
  })));

  return pageStates;
}

/**
 * 把单个采集结果包装为页面状态。
 */
function toPageState(projectKey: string, mapId: string, state: CollectedPageState, index: number, now: Date): PageState {
  const stateId = index === 0 ? initialStateId : `state-action-${index}`;

  return {
    stateId,
    name: state.action ? state.context.page.title || `${state.action.targetName}后页面` : '初始页面',
    url: state.context.page.url,
    title: state.context.page.title,
    snapshotPath: getPageMapShotFile(projectKey, mapId, stateId),
    ...(state.action ? { sourceAction: state.action } : {}),
    warnings: state.context.warnings,
    createdAt: now.toISOString()
  };
}

/**
 * 去重页面地图风险提示。
 */
function uniqueWarnings(values: string[]) {
  return Array.from(new Set(values));
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
