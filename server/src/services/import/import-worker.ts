import type { CaseMeta, CaseStep, ImportItem, PageMap } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import {
  getImportItem,
  getImportJob,
  listImportItems,
  listImportJobs,
  recoverImportItems,
  updateImportJobSummary
} from '../../lib/import-store';
import { listProjects } from '../../lib/project-store';
import { createPageMapId, createPageMapKey, getAuthHash } from '../../lib/path';
import { readPageMapShot } from '../../lib/page-map-store';
import { reviewCase } from '../case-review';
import { AiDraftError, generateCaseDraft, type DraftPageMap } from '../ai/ai-case-draft';
import { getPageMap } from '../ai/page-map';
import { collectPageContext, PageContextError, type PageContext } from '../ai/page-context';
import { generateItems } from './import-gen-flow';
import { bindGroupMeta, markDraftReady, markFailed, markGenerating, markMapFailed } from './import-state-repo';

interface QueueTask {
  projectKey: string;
  importId: string;
  itemId: string;
  pageMapId?: string;
}

interface ImportGroup {
  groupId: string;
  pageMapId: string;
  targetUrl: string;
  authHash: string;
  items: ImportItem[];
}

const queue: QueueTask[] = [];
let runningCount = 0;
// 当前页面地图采集沿用桌面端默认视口，后续若模板支持视口字段再从导入源读取。
const defaultViewport = {
  width: 1280,
  height: 720
};

/**
 * 恢复服务启动前未完成的导入任务。
 */
export async function recoverImportJobs() {
  const projects = await listProjects();

  for (const project of projects) {
    const jobs = await listImportJobs(project.key);

    for (const job of jobs) {
      await recoverImportItems(project.key, job.importId);
      await enqueueImportJob(project.key, job.importId);
    }
  }
}

/**
 * 把导入任务中的待处理项加入本地后台队列。
 */
export async function enqueueImportJob(projectKey: string, importId: string) {
  const items = await listImportItems(projectKey, importId);
  const pendingItems = items.filter((item) => item.status === 'pending');
  const groups = await createImportGroups(projectKey, importId, pendingItems);

  for (const group of groups) {
    await prepareGroupMap(projectKey, importId, group);
  }

  drainQueue();
}

/**
 * 把单个导入项加入本地后台队列。
 */
export function enqueueImportItem(projectKey: string, importId: string, itemId: string) {
  queue.push({ projectKey, importId, itemId });
  drainQueue();
}

/**
 * 处理单个导入项。
 */
export async function processImportItem(projectKey: string, importId: string, itemId: string, pageMapId?: string): Promise<void> {
  const config = getAppConfig().ai;
  let item = await getImportItem(projectKey, importId, itemId);

  if (item.status !== 'pending' && item.status !== 'failed') {
    return;
  }

  for (let attempt = item.retryCount; attempt <= config.maxRetries; attempt += 1) {
    try {
      item = await markGenerating(projectKey, importId, itemId, {
        mode: 'single',
        retryCount: attempt
      });

      const job = await getImportJob(projectKey, importId);
      const pageContext = await readDraftPageContext(projectKey, job.envKey, item, pageMapId ?? item.pageMapId);
      const draftInput = {
        caseInfo: item.source.caseInfo,
        steps: item.source.steps,
        data: item.source.data,
        pageContext
      };
      const result = await generateCaseDraft(draftInput);
      const review = reviewCase(createReviewCase(result.draft));

      await markDraftReady(projectKey, importId, itemId, {
        draft: result.draft,
        aiDebug: result.aiDebug,
        review,
        mode: 'single'
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 草稿生成失败';

      if (error instanceof PageContextError) {
        await markFailed(projectKey, importId, itemId, {
          message,
          mode: 'single',
          retryCount: attempt
        });
        return;
      }

      if (attempt >= config.maxRetries) {
        await markFailed(projectKey, importId, itemId, {
          message,
          aiDebug: error instanceof AiDraftError ? error.aiDebug : undefined,
          mode: 'single',
          retryCount: attempt
        });
        return;
      }
    }
  }
}

/**
 * 按配置并发消费本地队列。
 */
function drainQueue() {
  const concurrency = getAppConfig().ai.concurrency;

  while (runningCount < concurrency && queue.length > 0) {
    const task = queue.shift()!;
    runningCount += 1;

    processImportItem(task.projectKey, task.importId, task.itemId, task.pageMapId)
      .catch(async () => {
        try {
          await updateImportJobSummary(task.projectKey, task.importId);
        } catch {
          // 测试或重启过程中任务目录可能已被清理，队列不能因此留下未处理拒绝。
        }
      })
      .finally(() => {
        runningCount -= 1;
        drainQueue();
      });
  }
}

/**
 * 生成导入项页面分组，分组键与页面地图缓存键保持一致。
 */
async function createImportGroups(projectKey: string, importId: string, items: ImportItem[]) {
  const job = await getImportJob(projectKey, importId);
  const authHash = await getAuthHash(projectKey, job.envKey);
  const groups = new Map<string, ImportGroup>();

  for (const item of items) {
    const key = createPageMapKey({
      projectKey,
      envKey: job.envKey,
      targetUrl: item.source.caseInfo.targetUrl,
      authHash,
      viewport: defaultViewport
    });
    const groupId = createPageMapId(key);
    const group = groups.get(groupId) ?? {
      groupId,
      pageMapId: groupId,
      targetUrl: key.targetUrl,
      authHash,
      items: []
    };

    group.items.push(item);
    groups.set(groupId, group);
  }

  return Array.from(groups.values());
}

/**
 * 为导入分组准备页面地图，成功后把组内条目加入生成队列。
 */
async function prepareGroupMap(
  projectKey: string,
  importId: string,
  group: ImportGroup
) {
  try {
    const job = await getImportJob(projectKey, importId);
    const pageMap = await getPageMap({
      projectKey,
      envKey: job.envKey,
      targetUrl: group.targetUrl,
      viewport: defaultViewport,
      authHash: group.authHash,
      steps: group.items.flatMap((item) => item.source.steps)
    });

    if (pageMap.status === 'failed') {
      await failImportGroup(projectKey, importId, group, getPageMapError(pageMap));
      return;
    }

    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];

      await bindGroupMeta(projectKey, importId, item.itemId, {
        groupId: group.groupId,
        groupIndex: index,
        pageMapId: pageMap.mapId
      });
    }

    await processImportGroup(projectKey, importId, group, pageMap);
  } catch (error) {
    await failImportGroup(projectKey, importId, group, getPageMapError(error));
  }
}

/**
 * 处理同一页面地图下的导入项，优先用分组生成，失败后逐级降级。
 */
async function processImportGroup(projectKey: string, importId: string, group: ImportGroup, pageMap: PageMap) {
  const items = await Promise.all(group.items.map((item) => getImportItem(projectKey, importId, item.itemId)));
  const pendingItems = items.filter((item) => item.status === 'pending' || item.status === 'failed');

  if (pendingItems.length === 0) {
    return;
  }

  const draftMap = await readDraftPageMap(projectKey, pageMap);
  await generateItems({
    projectKey,
    importId,
    items: pendingItems,
    pageMap: draftMap,
    mode: 'group',
    readItemContext: (item, pageMap) => readItemContext(projectKey, importId, item, pageMap)
  });
}

/**
 * 读取页面地图所有状态快照，供分组生成复用。
 */
async function readDraftPageMap(projectKey: string, pageMap: PageMap): Promise<DraftPageMap> {
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
    warnings: pageMap.warnings
  };
}

/**
 * 读取单条降级生成使用的页面上下文。
 */
async function readItemContext(projectKey: string, importId: string, item: ImportItem, pageMap: DraftPageMap) {
  return pageMap.states[0]?.context ?? await readDraftPageContext(projectKey, (await getImportJob(projectKey, importId)).envKey, item, item.pageMapId);
}

/**
 * 把页面地图失败统一写入组内导入项，确保前端展示同组一致原因。
 */
async function failImportGroup(
  projectKey: string,
  importId: string,
  group: ImportGroup,
  message: string
) {
  for (let index = 0; index < group.items.length; index += 1) {
    const item = group.items[index];

    await markMapFailed(projectKey, importId, item.itemId, {
      groupId: group.groupId,
      groupIndex: index,
      message
    });
  }
}

/**
 * 读取草稿生成使用的页面上下文，优先复用页面地图初始快照。
 */
async function readDraftPageContext(projectKey: string, envKey: string, item: ImportItem, pageMapId: string | undefined): Promise<PageContext> {
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
function getPageMapError(error: unknown) {
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

/**
 * 创建用于基础检查的临时用例对象。
 */
function createReviewCase(draft: { name: string; startPath: string; steps: CaseStep[] }): CaseMeta {
  const now = new Date().toISOString();

  return {
    name: draft.name,
    key: 'ai-import-draft',
    status: 'draft',
    startPath: draft.startPath,
    steps: draft.steps,
    createdAt: now,
    updatedAt: now
  };
}
