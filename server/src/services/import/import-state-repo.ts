import type { ImportGenMode, ImportItem } from '../../../../shared/types';
import { transitionImportItems, updateImportItem } from '../../lib/import-store';
import {
  bindGroup,
  completeWithDraft,
  failItem,
  failMap,
  startGenerating,
  type BindGroupInput,
  type CompleteDraftInput,
  type FailItemInput,
  type FailMapInput,
  type StartGeneratingInput
} from './import-state-machine';

/**
 * 绑定导入项的页面地图分组元信息。
 */
export async function bindGroupMeta(projectKey: string, importId: string, itemId: string, input: BindGroupInput) {
  return updateImportItem(projectKey, importId, itemId, bindGroup(input));
}

/**
 * 标记导入项进入 AI 生成中状态。
 */
export async function markGenerating(projectKey: string, importId: string, itemId: string, input: StartGeneratingInput) {
  return updateImportItem(projectKey, importId, itemId, startGenerating(input));
}

/**
 * 批量标记导入项进入 AI 生成中状态。
 */
export async function markItemsGenerating(
  projectKey: string,
  importId: string,
  items: ImportItem[],
  mode: ImportGenMode,
  reason?: string
) {
  await transitionImportItems(
    projectKey,
    importId,
    items.map((item) => ({
      itemId: item.itemId,
      patch: startGenerating({
        mode,
        fallbackReason: reason,
        retryCount: 0
      })
    }))
  );
}

/**
 * 标记导入项已生成可审核草稿。
 */
export async function markDraftReady(projectKey: string, importId: string, itemId: string, input: CompleteDraftInput) {
  return updateImportItem(projectKey, importId, itemId, completeWithDraft(input));
}

/**
 * 标记导入项生成失败。
 */
export async function markFailed(projectKey: string, importId: string, itemId: string, input: FailItemInput) {
  return updateImportItem(projectKey, importId, itemId, failItem(input));
}

/**
 * 标记页面地图采集失败，并清空可复用的页面地图标识。
 */
export async function markMapFailed(projectKey: string, importId: string, itemId: string, input: FailMapInput) {
  return updateImportItem(projectKey, importId, itemId, failMap(input));
}

/**
 * 批量标记页面地图失败，确保同组项写入一致原因。
 */
export async function markGroupMapFailed(
  projectKey: string,
  importId: string,
  items: Array<{ itemId: string; groupId: string; groupIndex: number }>,
  message: string
) {
  await transitionImportItems(
    projectKey,
    importId,
    items.map((item) => ({
      itemId: item.itemId,
      patch: failMap({
        groupId: item.groupId,
        groupIndex: item.groupIndex,
        message
      })
    }))
  );
}

/**
 * 批量绑定页面地图分组元信息。
 */
export async function bindGroupMetaBatch(
  projectKey: string,
  importId: string,
  items: Array<{ itemId: string; groupId: string; groupIndex: number; pageMapId: string }>
) {
  await transitionImportItems(
    projectKey,
    importId,
    items.map((item) => ({
      itemId: item.itemId,
      patch: bindGroup({
        groupId: item.groupId,
        groupIndex: item.groupIndex,
        pageMapId: item.pageMapId
      })
    }))
  );
}
