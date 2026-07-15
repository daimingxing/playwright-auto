import type { AiDebugInfo, CaseReview, ImportGenMode, ImportItem } from '../../../../shared/types';

export interface StartGeneratingInput {
  mode: ImportGenMode;
  fallbackReason?: string;
  retryCount?: number;
}

export interface CompleteDraftInput {
  draft: ImportItem['draft'];
  aiDebug: ImportItem['aiDebug'];
  review: CaseReview;
  mode: ImportGenMode;
  fallbackReason?: string;
}

export interface FailItemInput {
  message: string;
  aiDebug?: AiDebugInfo;
  mode: ImportGenMode;
  fallbackReason?: string;
  retryCount?: number;
  clearDraft?: boolean;
}

export interface BindGroupInput {
  groupId: string;
  groupIndex: number;
  pageMapId: string;
}

export interface FailMapInput {
  groupId: string;
  groupIndex: number;
  message: string;
}

/**
 * 显式状态机：pending/failed -> generating。
 */
export function startGenerating(input: StartGeneratingInput): Partial<ImportItem> {
  return {
    status: 'generating',
    errorMessage: undefined,
    genMode: input.mode,
    fallbackReason: input.fallbackReason,
    retryCount: input.retryCount ?? 0
  };
}

/**
 * 显式状态机：generating -> pendingReview。
 */
export function completeWithDraft(input: CompleteDraftInput): Partial<ImportItem> {
  return {
    status: 'pendingReview',
    draft: input.draft,
    aiDebug: input.aiDebug,
    review: input.review,
    errorMessage: undefined,
    genMode: input.mode,
    fallbackReason: input.fallbackReason,
    retryCount: 0
  };
}

/**
 * 显式状态机：任意可重试状态 -> failed。
 */
export function failItem(input: FailItemInput): Partial<ImportItem> {
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

  return patch;
}

/**
 * 绑定页面地图分组元信息，不改变主状态。
 */
export function bindGroup(input: BindGroupInput): Partial<ImportItem> {
  return {
    groupId: input.groupId,
    groupIndex: input.groupIndex,
    pageMapId: input.pageMapId
  };
}

/**
 * 页面地图失败：failed，并清空可复用 pageMapId。
 */
export function failMap(input: FailMapInput): Partial<ImportItem> {
  return {
    status: 'failed',
    groupId: input.groupId,
    groupIndex: input.groupIndex,
    // 页面地图失败没有可复用快照，重试时必须重新采集。
    pageMapId: undefined,
    errorMessage: input.message,
    genMode: 'group',
    fallbackReason: undefined,
    retryCount: 0
  };
}
