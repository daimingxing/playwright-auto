import { getAppConfig } from '../../lib/app-config';
import { rebuildImportJobSummary } from '../../lib/import-store';

export interface QueueTask {
  projectKey: string;
  importId: string;
  itemId: string;
  pageMapId?: string;
}

type TaskRunner = (task: QueueTask) => Promise<void>;

const queue: QueueTask[] = [];
let runningCount = 0;
let taskRunner: TaskRunner | undefined;

/**
 * 注册队列任务执行器，避免调度层直接依赖编排细节。
 */
export function setImportTaskRunner(runner: TaskRunner) {
  taskRunner = runner;
}

/**
 * 把单个导入项加入本地后台队列。
 */
export function enqueueImportTask(task: QueueTask) {
  queue.push(task);
  drainQueue();
}

/**
 * 仅在当前没有可执行 runner 时不消费，避免空跑。
 */
export function drainImportQueue() {
  drainQueue();
}

/**
 * 按配置并发消费本地队列。
 */
function drainQueue() {
  if (!taskRunner) {
    return;
  }

  const concurrency = getAppConfig().ai.concurrency;
  const runner = taskRunner;

  while (runningCount < concurrency && queue.length > 0) {
    const task = queue.shift()!;
    runningCount += 1;

    runner(task)
      .catch(async () => {
        try {
          // 兜底重建一次任务摘要，确保异常路径下任务计数仍然一致。
          await rebuildImportJobSummary(task.projectKey, task.importId);
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
