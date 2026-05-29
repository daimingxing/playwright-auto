import type { AiDebugInfo, CaseMeta, CaseStep, ImportGenMode, ImportItem } from '../../../../shared/types';
import { reviewCase } from '../case-review';
import { AiDraftError, generateCaseDraft, generateCaseDraftGroup, type DraftPageMap } from '../ai/ai-case-draft';
import type { PageContext } from '../ai/page-context';
import { markDraftReady, markFailed, markGenerating } from './import-state-repo';

type GenMode = ImportGenMode;

interface GenInput {
  projectKey: string;
  importId: string;
  items: ImportItem[];
  pageMap: DraftPageMap;
  mode: GenMode;
  reason?: string;
  readItemContext: (item: ImportItem, pageMap: DraftPageMap) => Promise<PageContext>;
}

/**
 * 执行导入项分组生成，并在失败时按批次和单条逐级降级。
 */
export async function generateItems(input: GenInput): Promise<void> {
  if (input.items.length === 0) {
    return;
  }

  try {
    await markItemsGenerating(input.projectKey, input.importId, input.items, input.mode, input.reason);
    const result = await generateCaseDraftGroup({
      pageMap: input.pageMap,
      cases: input.items.map((item) => ({
        caseInfo: item.source.caseInfo,
        steps: item.source.steps,
        data: item.source.data
      }))
    });
    const errorText = formatGroupError(result.groupErrors);
    const aiDebug = appendAiDebugError(result.aiDebug, errorText);

    for (const item of input.items) {
      const groupItem = result.items.find((value) => value.caseNo === item.caseNo);

      if (groupItem?.draft) {
        await saveDraftItem(input.projectKey, input.importId, item, groupItem.draft, aiDebug, input.mode, input.reason);
        continue;
      }

      await markFailed(input.projectKey, input.importId, item.itemId, {
        message: mergeErrorText(readGroupError(groupItem) ?? 'AI 未返回该用例草稿', errorText),
        aiDebug,
        mode: input.mode,
        fallbackReason: input.reason,
        retryCount: 0
      });
    }
  } catch (error) {
    const message = getDraftError(error);

    if (input.mode === 'group' && input.items.length > 1) {
      await splitItems(input, `分组生成失败：${message}`);
      return;
    }

    if (input.items.length > 1) {
      for (const item of input.items) {
        await generateSingleItem(input, item, input.reason ?? `小批生成失败：${message}`);
      }
      return;
    }

    await generateSingleItem(input, input.items[0], input.reason ?? `分组生成失败：${message}`);
  }
}

/**
 * 把失败分组拆成两个小批次继续生成。
 */
async function splitItems(input: GenInput, reason: string) {
  const size = Math.ceil(input.items.length / 2);
  const batches = [input.items.slice(0, size), input.items.slice(size)].filter((batch) => batch.length > 0);

  for (const batch of batches) {
    await generateItems({
      ...input,
      items: batch,
      mode: 'batch',
      reason
    });
  }
}

/**
 * 执行单条降级生成。
 */
async function generateSingleItem(input: GenInput, item: ImportItem, reason: string) {
  try {
    const pageContext = await input.readItemContext(item, input.pageMap);
    const result = await generateCaseDraft({
      caseInfo: item.source.caseInfo,
      steps: item.source.steps,
      data: item.source.data,
      pageContext
    });

    await saveDraftItem(input.projectKey, input.importId, item, result.draft, result.aiDebug, 'single', reason);
  } catch (error) {
    await markFailed(input.projectKey, input.importId, item.itemId, {
      message: getDraftError(error),
      aiDebug: error instanceof AiDraftError ? error.aiDebug : undefined,
      mode: 'single',
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
    await markGenerating(projectKey, importId, item.itemId, {
      mode,
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
    await markFailed(projectKey, importId, item.itemId, {
      message: 'AI 未返回可用草稿',
      mode,
      fallbackReason: reason,
      retryCount: 0,
      clearDraft: true
    });
    return;
  }

  const review = reviewCase(createReviewCase(draft));

  await markDraftReady(projectKey, importId, item.itemId, {
    draft,
    aiDebug,
    review,
    mode,
    fallbackReason: reason
  });
}

/**
 * 读取草稿生成失败原因。
 */
function getDraftError(error: unknown) {
  return error instanceof Error ? error.message : 'AI 草稿生成失败';
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
