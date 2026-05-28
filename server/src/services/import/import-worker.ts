import type { AiDebugInfo, CaseMeta, CaseStep, ImportGenMode, ImportItem, PageMap } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import {
  getImportItem,
  getImportJob,
  listImportItems,
  listImportJobs,
  recoverImportItems,
  updateImportItem,
  updateImportJobSummary
} from '../../lib/import-store';
import { listProjects } from '../../lib/project-store';
import { createPageMapId, createPageMapKey, getAuthHash } from '../../lib/path';
import { readPageMapShot } from '../../lib/page-map-store';
import { reviewCase } from '../case-review';
import { AiDraftError, generateCaseDraft, generateCaseDraftGroup, type DraftPageMap } from '../ai/ai-case-draft';
import { getPageMap } from '../ai/page-map';
import { collectPageContext, PageContextError, type PageContext } from '../ai/page-context';

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

type GenMode = ImportGenMode;

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
      item = await updateImportItem(projectKey, importId, itemId, {
        status: 'generating',
        errorMessage: undefined,
        genMode: 'single',
        fallbackReason: undefined,
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

      await updateImportItem(projectKey, importId, itemId, {
        status: 'pendingReview',
        draft: result.draft,
        aiDebug: result.aiDebug,
        review,
        errorMessage: undefined,
        genMode: 'single',
        fallbackReason: undefined,
        retryCount: 0
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 草稿生成失败';

      if (error instanceof PageContextError) {
        await updateImportItem(projectKey, importId, itemId, {
          status: 'failed',
          errorMessage: message,
          genMode: 'single',
          fallbackReason: undefined,
          retryCount: attempt
        });
        return;
      }

      if (attempt >= config.maxRetries) {
        await updateImportItem(projectKey, importId, itemId, {
          status: 'failed',
          errorMessage: message,
          aiDebug: error instanceof AiDraftError ? error.aiDebug : undefined,
          genMode: 'single',
          fallbackReason: undefined,
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

      await updateImportItem(projectKey, importId, item.itemId, {
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
  await generateGroupItems(projectKey, importId, pendingItems, draftMap, 'group');
}

/**
 * 批量生成分组草稿；失败时先拆半批，再降级单条生成。
 */
async function generateGroupItems(
  projectKey: string,
  importId: string,
  items: ImportItem[],
  pageMap: DraftPageMap,
  mode: GenMode,
  reason?: string
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  try {
    await markItemsGenerating(projectKey, importId, items, mode, reason);
    const result = await generateCaseDraftGroup({
      pageMap,
      cases: items.map((item) => ({
        caseInfo: item.source.caseInfo,
        steps: item.source.steps,
        data: item.source.data
      }))
    });
    const errorText = formatGroupError(result.groupErrors);
    const aiDebug = appendAiDebugError(result.aiDebug, errorText);

    for (const item of items) {
      const groupItem = result.items.find((value) => value.caseNo === item.caseNo);

      if (groupItem?.draft) {
        await saveDraftItem(projectKey, importId, item, groupItem.draft, aiDebug, mode, reason);
        continue;
      }

      await patchImportItem(projectKey, importId, item.itemId, {
        status: 'failed',
        errorMessage: mergeErrorText(readGroupError(groupItem) ?? 'AI 未返回该用例草稿', errorText),
        aiDebug,
        genMode: mode,
        fallbackReason: reason,
        retryCount: 0
      });
    }
  } catch (error) {
    const message = getDraftError(error);

    if (mode === 'group' && items.length > 1) {
      await splitGroupItems(projectKey, importId, items, pageMap, `分组生成失败：${message}`);
      return;
    }

    if (items.length > 1) {
      for (const item of items) {
        await generateSingleItem(projectKey, importId, item, pageMap, reason ?? `小批生成失败：${message}`);
      }
      return;
    }

    await generateSingleItem(projectKey, importId, items[0], pageMap, reason ?? `分组生成失败：${message}`);
  }
}

/**
 * 按用例数量把失败分组拆成小批次。
 */
async function splitGroupItems(projectKey: string, importId: string, items: ImportItem[], pageMap: DraftPageMap, reason: string) {
  const size = Math.ceil(items.length / 2);
  const batches = [items.slice(0, size), items.slice(size)].filter((batch) => batch.length > 0);

  for (const batch of batches) {
    await generateGroupItems(projectKey, importId, batch, pageMap, 'batch', reason);
  }
}

/**
 * 单条降级生成，复用同一页面地图初始快照，不重新采集页面。
 */
async function generateSingleItem(projectKey: string, importId: string, item: ImportItem, pageMap: DraftPageMap, reason: string) {
  try {
    const pageContext = pageMap.states[0]?.context ?? await readDraftPageContext(projectKey, (await getImportJob(projectKey, importId)).envKey, item, item.pageMapId);
    const result = await generateCaseDraft({
      caseInfo: item.source.caseInfo,
      steps: item.source.steps,
      data: item.source.data,
      pageContext
    });

    await saveDraftItem(projectKey, importId, item, result.draft, result.aiDebug, 'single', reason);
  } catch (error) {
    await patchImportItem(projectKey, importId, item.itemId, {
      status: 'failed',
      errorMessage: getDraftError(error),
      aiDebug: error instanceof AiDraftError ? error.aiDebug : undefined,
      genMode: 'single',
      fallbackReason: reason,
      retryCount: 0
    });
  }
}

/**
 * 标记一批导入项进入生成中状态。
 */
async function markItemsGenerating(projectKey: string, importId: string, items: ImportItem[], mode: GenMode, reason?: string) {
  for (const item of items) {
    await patchImportItem(projectKey, importId, item.itemId, {
      status: 'generating',
      errorMessage: undefined,
      genMode: mode,
      fallbackReason: reason,
      retryCount: 0
    });
  }
}

/**
 * 保存 AI 草稿并同步基础检查结果。
 */
async function saveDraftItem(
  projectKey: string,
  importId: string,
  item: ImportItem,
  draft: ImportItem['draft'],
  aiDebug: ImportItem['aiDebug'],
  mode: GenMode,
  reason?: string
) {
  if (!draft) {
    await patchImportItem(projectKey, importId, item.itemId, {
      status: 'failed',
      errorMessage: 'AI 未返回可用草稿',
      draft: undefined,
      aiDebug: undefined,
      review: undefined,
      genMode: mode,
      fallbackReason: reason,
      retryCount: 0
    });
    return;
  }

  const review = reviewCase(createReviewCase(draft));

  await patchImportItem(projectKey, importId, item.itemId, {
    status: 'pendingReview',
    draft,
    aiDebug,
    review,
    errorMessage: undefined,
    genMode: mode,
    fallbackReason: reason,
    retryCount: 0
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
 * 读取草稿生成失败原因。
 */
function getDraftError(error: unknown) {
  return error instanceof Error ? error.message : 'AI 草稿生成失败';
}

/**
 * 更新带生成元信息的导入项，避免把阶段内字段扩散到共享类型。
 */
async function patchImportItem(projectKey: string, importId: string, itemId: string, patch: Partial<ImportItem>) {
  return updateImportItem(projectKey, importId, itemId, patch);
}

/**
 * 格式化分组级错误摘要，空数组不写入可见错误。
 */
function formatGroupError(errors: string[]) {
  return errors.length > 0 ? `分组错误：${errors.join('；')}` : undefined;
}

/**
 * 合并单项错误和分组错误，避免分组归因只留在调试原始输出里。
 */
function mergeErrorText(itemError: string, groupError: string | undefined) {
  return groupError ? `${itemError}；${groupError}` : itemError;
}

/**
 * 把分组级结构错误同步写入 AI 调试字段，保留原有模型错误说明。
 */
function appendAiDebugError(aiDebug: AiDebugInfo, groupError: string | undefined) {
  if (!groupError) {
    return aiDebug;
  }

  return {
    ...aiDebug,
    error: [aiDebug.error, groupError].filter(Boolean).join('；')
  };
}

/**
 * 读取分组返回项上的错误说明，兼容测试 mock 和模型归一化结果。
 */
function readGroupError(item: unknown) {
  if (!item || typeof item !== 'object' || !('error' in item)) {
    return undefined;
  }

  const error = item.error;

  return typeof error === 'string' ? error : undefined;
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

    await updateImportItem(projectKey, importId, item.itemId, {
      status: 'failed',
      groupId: group.groupId,
      groupIndex: index,
      // 失败页面地图没有初始 snapshot，不能留下可被手动重试复用的页面地图标识。
      pageMapId: undefined,
      errorMessage: message,
      genMode: 'group',
      fallbackReason: undefined,
      retryCount: 0
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
