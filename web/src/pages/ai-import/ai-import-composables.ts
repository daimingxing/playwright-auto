import { computed, getCurrentInstance, onUnmounted, ref } from 'vue';
import type { ImportCaseFailure, ImportTaskCase, ImportTaskDetail } from '../../../../shared/types';
import { confirmImportCase, getImportTask, publishImportCase, retryImportCase, reviewImportTask } from '../../api/imports';
import { canConfirmImportCase, canPublishImportCase, canRetryImportCase, isImportCaseBusy, needsImportReview } from './ai-import';

const POLL_MS = 2000;

export type ImportRetryOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'left' }
  | { outcome: 'generated' }
  | { outcome: 'failed'; failure?: ImportCaseFailure };

/**
 * 管理导入任务详情的加载、审阅、确认和单条重试。
 */
export function useImportTaskReview(projectKey: string, taskId: string) {
  const task = ref<ImportTaskDetail | null>(null);
  const loading = ref(false);
  const reviewing = ref(false);
  const actingId = ref('');
  const waitMs = ref(0);
  const cases = computed(() => task.value?.cases ?? []);
  let closed = false;
  let waitTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * 加载任务详情；若仍需探索则启动后台作业并轮询直到结束。
   */
  async function loadTask() {
    loading.value = true;

    try {
      task.value = await getImportTask(projectKey, taskId);

      if (needsImportReview(task.value.cases)) {
        reviewing.value = true;
        startWait();
        task.value = await reviewImportTask(projectKey, taskId);
        await pollUntilSettled();
      }
    } finally {
      if (!closed) {
        stopWait();
        loading.value = false;
        reviewing.value = false;
      }
    }
  }

  /**
   * 确认一条待确认用例。
   */
  async function confirmCase(item: ImportTaskCase) {
    if (!canConfirmImportCase(item.status)) {
      return;
    }

    actingId.value = item.id;

    try {
      task.value = await confirmImportCase(projectKey, taskId, item.id);
    } finally {
      actingId.value = '';
    }
  }

  /**
   * 启动目标用例重试；页面停留时轮询到该条结束，离开页面不取消后台探索。
   */
  async function retryCase(item: ImportTaskCase): Promise<ImportRetryOutcome> {
    if (!canRetryImportCase(item.status)) {
      return { outcome: 'skipped' };
    }

    actingId.value = item.id;
    reviewing.value = true;
    startWait();

    try {
      task.value = await retryImportCase(projectKey, taskId, item.id);
      return settleRetry(await pollCaseUntilSettled(item.id));
    } finally {
      if (!closed) {
        stopWait();
        actingId.value = '';
        reviewing.value = false;
      }
    }
  }

  /**
   * 显式发布一条已确认用例。
   */
  async function publishCase(item: ImportTaskCase) {
    if (!canPublishImportCase(item.status)) {
      return;
    }

    actingId.value = item.id;

    try {
      task.value = await publishImportCase(projectKey, taskId, item.id);
    } finally {
      actingId.value = '';
    }
  }

  /**
   * 轮询任务直到探索结束；组件卸载时停止轮询，不取消后台作业。
   */
  async function pollUntilSettled() {
    while (!closed && needsImportReview(task.value?.cases ?? [])) {
      task.value = await getImportTask(projectKey, taskId);

      if (!needsImportReview(task.value.cases)) {
        return true;
      }

      await waitPoll();
    }

    return !closed && !needsImportReview(task.value?.cases ?? []);
  }

  /**
   * 轮询目标用例直到不再忙碌；离开页面时停止，不把旧失败态当成重试完成。
   */
  async function pollCaseUntilSettled(caseId: string) {
    while (!closed) {
      const current = task.value?.cases.find((entry) => entry.id === caseId);

      if (!current || !isImportCaseBusy(current.status)) {
        return current ?? null;
      }

      await waitPoll();

      if (closed) {
        return null;
      }

      task.value = await getImportTask(projectKey, taskId);
    }

    return null;
  }

  /**
   * 把目标用例的终态转成重试提示结果。
   */
  function settleRetry(item: ImportTaskCase | null): ImportRetryOutcome {
    if (!item) {
      return { outcome: 'left' };
    }

    if (item.status === 'pending-review' || item.status === 'publishable') {
      return { outcome: 'generated' };
    }

    if (item.status === 'failed') {
      return { outcome: 'failed', failure: item.failure };
    }

    return { outcome: 'left' };
  }

  /**
   * 等待下一轮轮询，卸载后尽快结束。
   */
  function waitPoll() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);

      if (closed) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /**
   * 开始累计等待秒数。
   */
  function startWait() {
    const startedAt = Date.now();
    waitMs.value = 0;
    waitTimer = setInterval(() => {
      waitMs.value = Date.now() - startedAt;
    }, 1000);
  }

  /**
   * 停止等待计时。
   */
  function stopWait() {
    if (waitTimer) {
      clearInterval(waitTimer);
      waitTimer = undefined;
    }

    waitMs.value = 0;
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      closed = true;
      stopWait();
    });
  }

  return {
    task,
    cases,
    loading,
    reviewing,
    actingId,
    waitMs,
    loadTask,
    confirmCase,
    retryCase,
    publishCase
  };
}
