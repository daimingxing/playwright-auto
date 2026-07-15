import type { PageMap } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import {
  getImportItem,
  getImportJob,
  listImportItems
} from '../../lib/import-store';
import { AiDraftError, generateCaseDraft } from '../ai/ai-case-draft';
import { PageContextError } from '../ai/page-context';
import { buildDraftReview } from './import-draft-review';
import { generateItems } from './import-gen-flow';
import {
  createImportGroups,
  getPageMapError,
  prepareGroupPageMap,
  readDraftPageContext,
  readDraftPageMap,
  readItemContext,
  resolveRetryPageMap,
  type ImportGroup
} from './import-page-map-resolver';
import {
  bindGroupMeta,
  bindGroupMetaBatch,
  markDraftReady,
  markFailed,
  markGenerating,
  markGroupMapFailed
} from './import-state-repo';

/**
 * 执行整任务编排：准备页面地图，再按组生成。
 */
export async function executeImportJob(projectKey: string, importId: string) {
  const items = await listImportItems(projectKey, importId);
  const pendingItems = items.filter((item) => item.status === 'pending');
  const groups = await createImportGroups(projectKey, importId, pendingItems);

  for (const group of groups) {
    await prepareAndProcessGroup(projectKey, importId, group);
  }
}

/**
 * 执行单个导入项，供队列重试和手动重试复用。
 */
export async function executeImportItem(projectKey: string, importId: string, itemId: string, pageMapId?: string): Promise<void> {
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
      const map = await resolveRetryPageMap(projectKey, job.envKey, item, job.uiLibrary, pageMapId ?? item.pageMapId);
      const pageContext = await readDraftPageContext(projectKey, job.envKey, item, map?.mapId);
      if (map) {
        await bindGroupMeta(projectKey, importId, itemId, {
          groupId: item.groupId ?? map.mapId,
          groupIndex: item.groupIndex ?? 0,
          pageMapId: map.mapId
        });
      }
      const draftInput = {
        caseInfo: item.source.caseInfo,
        steps: item.source.steps,
        data: item.source.data,
        pageContext,
        uiLibrary: job.uiLibrary ?? pageContext.uiLibrary ?? 'auto'
      };
      const result = await generateCaseDraft(draftInput);
      const review = buildDraftReview(result.draft);

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
 * 为导入分组准备页面地图，成功后执行分组生成。
 */
async function prepareAndProcessGroup(projectKey: string, importId: string, group: ImportGroup) {
  try {
    const pageMap = await prepareGroupPageMap(projectKey, importId, group);

    if (pageMap.status === 'failed') {
      await failImportGroup(projectKey, importId, group, getPageMapError(pageMap));
      return;
    }

    await bindGroupMetaBatch(
      projectKey,
      importId,
      group.items.map((item, index) => ({
        itemId: item.itemId,
        groupId: group.groupId,
        groupIndex: index,
        pageMapId: pageMap.mapId
      }))
    );

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
 * 把页面地图失败统一写入组内导入项，确保前端展示同组一致原因。
 */
async function failImportGroup(projectKey: string, importId: string, group: ImportGroup, message: string) {
  await markGroupMapFailed(
    projectKey,
    importId,
    group.items.map((item, index) => ({
      itemId: item.itemId,
      groupId: group.groupId,
      groupIndex: index
    })),
    message
  );
}
