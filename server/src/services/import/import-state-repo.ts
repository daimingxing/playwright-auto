import type { AiDebugInfo, CaseReview, ImportGenMode, ImportItem } from '../../../../shared/types';
import { updateImportItem } from '../../lib/import-store';

interface GenInput {
  mode: ImportGenMode;
  fallbackReason?: string;
  retryCount?: number;
}

interface ReadyInput {
  draft: ImportItem['draft'];
  aiDebug: ImportItem['aiDebug'];
  review: CaseReview;
  mode: ImportGenMode;
  fallbackReason?: string;
}

interface FailInput {
  message: string;
  aiDebug?: AiDebugInfo;
  mode: ImportGenMode;
  fallbackReason?: string;
  retryCount?: number;
  clearDraft?: boolean;
}

interface GroupInput {
  groupId: string;
  groupIndex: number;
  pageMapId: string;
}

interface MapFailInput {
  groupId: string;
  groupIndex: number;
  message: string;
}

/**
 * 绑定导入项的页面地图分组元信息。
 */
export async function bindGroupMeta(projectKey: string, importId: string, itemId: string, input: GroupInput) {
  return updateImportItem(projectKey, importId, itemId, {
    groupId: input.groupId,
    groupIndex: input.groupIndex,
    pageMapId: input.pageMapId
  });
}

/**
 * 标记导入项进入 AI 生成中状态。
 */
export async function markGenerating(projectKey: string, importId: string, itemId: string, input: GenInput) {
  return updateImportItem(projectKey, importId, itemId, {
    status: 'generating',
    errorMessage: undefined,
    genMode: input.mode,
    fallbackReason: input.fallbackReason,
    retryCount: input.retryCount ?? 0
  });
}

/**
 * 标记导入项已生成可审核草稿。
 */
export async function markDraftReady(projectKey: string, importId: string, itemId: string, input: ReadyInput) {
  return updateImportItem(projectKey, importId, itemId, {
    status: 'pendingReview',
    draft: input.draft,
    aiDebug: input.aiDebug,
    review: input.review,
    errorMessage: undefined,
    genMode: input.mode,
    fallbackReason: input.fallbackReason,
    retryCount: 0
  });
}

/**
 * 标记导入项生成失败。
 */
export async function markFailed(projectKey: string, importId: string, itemId: string, input: FailInput) {
  const patch: Partial<ImportItem> = {
    status: 'failed',
    errorMessage: input.message,
    genMode: input.mode,
    fallbackReason: input.fallbackReason,
    retryCount: input.retryCount ?? 0
  };

  if (input.aiDebug) {
    patch.aiDebug = input.aiDebug;
  }

  if (input.clearDraft) {
    patch.draft = undefined;
    patch.aiDebug = undefined;
    patch.review = undefined;
  }

  return updateImportItem(projectKey, importId, itemId, patch);
}

/**
 * 标记页面地图采集失败，并清空可复用的页面地图标识。
 */
export async function markMapFailed(projectKey: string, importId: string, itemId: string, input: MapFailInput) {
  return updateImportItem(projectKey, importId, itemId, {
    status: 'failed',
    groupId: input.groupId,
    groupIndex: input.groupIndex,
    // 页面地图失败没有可复用快照，重试时必须重新采集。
    pageMapId: undefined,
    errorMessage: input.message,
    genMode: 'group',
    fallbackReason: undefined,
    retryCount: 0
  });
}
