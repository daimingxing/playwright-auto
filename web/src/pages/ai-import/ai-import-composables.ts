import { computed, getCurrentInstance, onUnmounted, ref } from 'vue';
import type { CaseStep, ImportCaseFailure, ImportTaskCase, ImportTaskDetail, VerifiedLocator } from '../../../../shared/types';
import type { LocatorBuilderState } from '../../../../shared/locator-builder';
import type { ImportActionIrPreview, SaveImportActionIrInput } from '../../api/imports';
import {
  confirmImportCase,
  getImportTask,
  previewImportActionIr,
  publishImportCase,
  resumeImportTask,
  retryImportCase,
  reviewImportTask,
  saveImportActionIr,
  unconfirmImportCase
} from '../../api/imports';
import {
  canConfirmImportCase,
  canEditImportActionIr,
  canPublishImportCase,
  canRetryImportCase,
  canUnconfirmImportCase,
  isImportCaseBusy,
  needsImportReview
} from './ai-import';

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
  const actionIrById = ref<Record<string, ImportActionIrPreview>>({});
  const actionIrLoadingId = ref('');
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
      } else {
        await syncPublishSteps();
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
    if (!canConfirmImportCase(item)) {
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
    const next = { ...actionIrById.value };
    delete next[item.id];
    actionIrById.value = next;

    try {
      task.value = await retryImportCase(projectKey, taskId, item.id);
      const settled = settleRetry(await pollCaseUntilSettled(item.id));
      await syncPublishSteps();
      return settled;
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
   * 取消确认，回到待确认。
   */
  async function unconfirmCase(item: ImportTaskCase) {
    if (!canUnconfirmImportCase(item.status)) {
      return;
    }

    actingId.value = item.id;

    try {
      task.value = await unconfirmImportCase(projectKey, taskId, item.id);
    } finally {
      actingId.value = '';
    }
  }

  /**
   * 从检查点恢复导入任务，并在仍有未探索项时继续页面探索。
   */
  async function resumeTask() {
    if (task.value?.status !== 'interrupted') {
      return;
    }

    reviewing.value = true;
    startWait();

    try {
      task.value = await resumeImportTask(projectKey, taskId);

      if (needsImportReview(task.value.cases)) {
        task.value = await reviewImportTask(projectKey, taskId);
        await pollUntilSettled();
      }
    } finally {
      if (!closed) {
        stopWait();
        reviewing.value = false;
      }
    }
  }

  /**
   * 加载发布用的定位和填写值。没有意图时不请求。
   */
  async function loadActionIr(item: ImportTaskCase, options: { quiet?: boolean } = {}) {
    if (!item.intent) {
      return;
    }

    actionIrLoadingId.value = item.id;

    try {
      actionIrById.value = {
        ...actionIrById.value,
        [item.id]: await previewImportActionIr(projectKey, taskId, item.id)
      };
    } catch (error) {
      if (!options.quiet) {
        throw error;
      }
    } finally {
      if (actionIrLoadingId.value === item.id) {
        actionIrLoadingId.value = '';
      }
    }
  }

  /**
   * 给已有意图且不在探索中的用例补齐定位和填写值，探索结束后不必离开页面。
   */
  async function syncPublishSteps() {
    for (const item of cases.value) {
      if (!item.intent || isImportCaseBusy(item.status) || actionIrById.value[item.id]) {
        continue;
      }

      await loadActionIr(item, { quiet: true });
    }
  }

  /**
   * 保存高级区改过的定位器或步骤数据，并刷新预览。
   */
  async function saveActionIr(item: ImportTaskCase, input: SaveImportActionIrInput) {
    if (!canEditImportActionIr(item.status)) {
      throw new Error('当前状态不能改定位和填写值');
    }

    actingId.value = item.id;

    try {
      task.value = await saveImportActionIr(projectKey, taskId, item.id, input);
      const current = task.value.cases.find((entry) => entry.id === item.id);

      if (current) {
        await loadActionIr(current);
      }
    } finally {
      if (actingId.value === item.id) {
        actingId.value = '';
      }
    }
  }

  /**
   * 把定位器构建器结果写回对应意图步骤。
   */
  async function saveActionIrLocator(
    item: ImportTaskCase,
    step: CaseStep,
    payload: { selector: string; draft: LocatorBuilderState }
  ) {
    const locator: VerifiedLocator = {
      selector: payload.selector,
      selectorDraft: payload.draft
    };
    await saveActionIr(item, { locators: { [step.id]: locator } });
  }

  /**
   * 轮询任务直到探索结束；组件卸载时停止轮询，不取消后台作业。
   */
  async function pollUntilSettled() {
    while (!closed && needsImportReview(task.value?.cases ?? [])) {
      task.value = await getImportTask(projectKey, taskId);
      await syncPublishSteps();

      if (!needsImportReview(task.value.cases)) {
        return true;
      }

      await waitPoll();
    }

    if (!closed) {
      await syncPublishSteps();
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
    actionIrById,
    actionIrLoadingId,
    loadTask,
    confirmCase,
    retryCase,
    publishCase,
    unconfirmCase,
    resumeTask,
    loadActionIr,
    saveActionIr,
    saveActionIrLocator
  };
}
