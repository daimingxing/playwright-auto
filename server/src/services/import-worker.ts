import type { CaseMeta, CaseStep } from '../../../shared/types';
import { getAppConfig } from '../lib/app-config';
import {
  getImportItem,
  getImportJob,
  listImportItems,
  listImportJobs,
  recoverImportItems,
  updateImportItem,
  updateImportJobSummary
} from '../lib/import-store';
import { listProjects } from '../lib/project-store';
import { reviewCase } from './case-review';
import { AiDraftError, generateCaseDraft } from './ai-case-draft';
import { collectPageContext, PageContextError } from './page-context';

interface QueueTask {
  projectKey: string;
  importId: string;
  itemId: string;
}

const queue: QueueTask[] = [];
let runningCount = 0;

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

  for (const item of items) {
    if (item.status === 'pending') {
      queue.push({ projectKey, importId, itemId: item.itemId });
    }
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
export async function processImportItem(projectKey: string, importId: string, itemId: string): Promise<void> {
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
        retryCount: attempt
      });

      const job = await getImportJob(projectKey, importId);
      const pageContext = await collectPageContext({
        projectKey,
        envKey: job.envKey,
        caseInfo: item.source.caseInfo,
        steps: item.source.steps,
        data: item.source.data
      });
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
        retryCount: 0
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 草稿生成失败';

      if (error instanceof PageContextError) {
        await updateImportItem(projectKey, importId, itemId, {
          status: 'failed',
          errorMessage: message,
          retryCount: attempt
        });
        return;
      }

      if (attempt >= config.maxRetries) {
        await updateImportItem(projectKey, importId, itemId, {
          status: 'failed',
          errorMessage: message,
          aiDebug: error instanceof AiDraftError ? error.aiDebug : undefined,
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

    processImportItem(task.projectKey, task.importId, task.itemId)
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
