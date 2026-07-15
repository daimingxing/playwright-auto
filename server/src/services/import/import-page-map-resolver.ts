import type { ImportItem, PageMap, UiLibrary } from '../../../../shared/types';
import { createPageMapId, createPageMapKey, getAuthHash } from '../../lib/path';
import { getImportJob } from '../../lib/import-store';
import { readPageMap, readPageMapShot } from '../../lib/page-map-store';
import { getPageMap, refreshPageMap } from '../ai/page-map';
import { collectPageContext, type PageContext } from '../ai/page-context';
import type { DraftPageMap } from '../ai/ai-case-draft';

export interface ImportGroup {
  groupId: string;
  pageMapId: string;
  targetUrl: string;
  authHash: string;
  uiLibrary: UiLibrary;
  items: ImportItem[];
}

// 当前页面地图采集沿用桌面端默认视口，后续若模板支持视口字段再从导入源读取。
export const defaultViewport = {
  width: 1280,
  height: 720
};

/**
 * 为失败项重试解析当前页面地图，确保刷新后的快照会被复用。
 */
export async function resolveRetryPageMap(
  projectKey: string,
  envKey: string,
  item: ImportItem,
  uiLibrary: UiLibrary | undefined,
  pageMapId: string | undefined
) {
  if (pageMapId) {
    const pageMap = await readPageMap(projectKey, pageMapId);

    if (pageMap.status === 'failed') {
      // 历史失败项可能残留 failed pageMapId，重试必须先刷新，避免读取缺失的 state-initial 快照。
      return refreshPageMap(projectKey, pageMap.mapId, { steps: item.source.steps });
    }

    return pageMap;
  }

  if (item.groupId || item.status === 'failed') {
    const authHash = await getAuthHash(projectKey, envKey);
    let pageMap = await getPageMap({
      projectKey,
      envKey,
      targetUrl: item.source.caseInfo.targetUrl,
      viewport: defaultViewport,
      authHash,
      uiLibrary: uiLibrary ?? 'auto',
      steps: item.source.steps
    });

    if (pageMap.status === 'failed') {
      // 失败缓存可能来自上一次页面地图采集，重试时需要重新打开目标 URL，刷新成功后复用新快照。
      pageMap = await refreshPageMap(projectKey, pageMap.mapId, { steps: item.source.steps });
    }

    return pageMap;
  }

  return undefined;
}

/**
 * 生成导入项页面分组，分组键与页面地图缓存键保持一致。
 */
export async function createImportGroups(projectKey: string, importId: string, items: ImportItem[]) {
  const job = await getImportJob(projectKey, importId);
  const authHash = await getAuthHash(projectKey, job.envKey);
  const groups = new Map<string, ImportGroup>();

  for (const item of items) {
    const key = createPageMapKey({
      projectKey,
      envKey: job.envKey,
      targetUrl: item.source.caseInfo.targetUrl,
      authHash,
      viewport: defaultViewport,
      uiLibrary: job.uiLibrary ?? 'auto'
    });
    const groupId = createPageMapId(key);
    const group = groups.get(groupId) ?? {
      groupId,
      pageMapId: groupId,
      targetUrl: key.targetUrl,
      authHash,
      uiLibrary: key.uiLibrary,
      items: []
    };

    group.items.push(item);
    groups.set(groupId, group);
  }

  return Array.from(groups.values());
}

/**
 * 为导入分组准备页面地图。
 */
export async function prepareGroupPageMap(projectKey: string, importId: string, group: ImportGroup) {
  const job = await getImportJob(projectKey, importId);

  return getPageMap({
    projectKey,
    envKey: job.envKey,
    targetUrl: group.targetUrl,
    viewport: defaultViewport,
    authHash: group.authHash,
    uiLibrary: group.uiLibrary,
    steps: group.items.flatMap((item) => item.source.steps)
  });
}

/**
 * 读取页面地图所有状态快照，供分组生成复用。
 */
export async function readDraftPageMap(projectKey: string, pageMap: PageMap): Promise<DraftPageMap> {
  const states = await Promise.all(
    pageMap.states.map(async (state) => ({
      stateId: state.stateId,
      name: state.name,
      actionName: state.sourceAction?.targetName,
      context: await readPageMapShot(projectKey, pageMap.mapId, state.stateId)
    }))
  );

  return {
    mapId: pageMap.mapId,
    targetUrl: pageMap.targetUrl,
    states,
    warnings: pageMap.warnings,
    uiLibrary: pageMap.uiLibrary ?? 'auto'
  };
}

/**
 * 读取单条降级生成使用的页面上下文。
 */
export async function readItemContext(projectKey: string, importId: string, item: ImportItem, pageMap: DraftPageMap) {
  return pageMap.states[0]?.context ?? await readDraftPageContext(projectKey, (await getImportJob(projectKey, importId)).envKey, item, item.pageMapId);
}

/**
 * 读取草稿生成使用的页面上下文，优先复用页面地图初始快照。
 */
export async function readDraftPageContext(
  projectKey: string,
  envKey: string,
  item: ImportItem,
  pageMapId: string | undefined
): Promise<PageContext> {
  if (pageMapId) {
    return readPageMapShot(projectKey, pageMapId, 'state-initial');
  }

  // 手动单项重试可能来自历史导入项，没有页面地图时保留旧采集路径兼容。
  return collectPageContext({
    projectKey,
    envKey,
    caseInfo: item.source.caseInfo,
    steps: item.source.steps,
    data: item.source.data
  });
}

/**
 * 读取页面地图错误说明，统一加上业务阶段前缀。
 */
export function getPageMapError(error: unknown) {
  if (isPageMap(error)) {
    const warning = error.warnings[0] ?? '页面地图不可用';

    return `页面地图生成失败：${warning}`;
  }

  const message = error instanceof Error ? error.message : '未知错误';

  return message.startsWith('页面地图生成失败') ? message : `页面地图生成失败：${message}`;
}

/**
 * 判断值是否为页面地图对象。
 */
function isPageMap(value: unknown): value is PageMap {
  return typeof value === 'object' && value !== null && 'mapId' in value && 'status' in value && 'warnings' in value;
}
