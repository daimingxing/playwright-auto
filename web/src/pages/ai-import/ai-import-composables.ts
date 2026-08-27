import { computed, ref } from 'vue';
import type { ImportTaskCase, ImportTaskDetail } from '../../../../shared/types';
import { confirmImportCase, getImportTask, publishImportCase, retryImportCase, reviewImportTask } from '../../api/imports';
import { canConfirmImportCase, canPublishImportCase, canRetryImportCase, hasParsedCases } from './ai-import';

/**
 * 管理导入任务详情的加载、审阅、确认和单条重试。
 */
export function useImportTaskReview(projectKey: string, taskId: string) {
  const task = ref<ImportTaskDetail | null>(null);
  const loading = ref(false);
  const reviewing = ref(false);
  const actingId = ref('');
  const cases = computed(() => task.value?.cases ?? []);

  /**
   * 加载任务详情；若仍有已解析用例则生成可审阅意图。
   */
  async function loadTask() {
    loading.value = true;

    try {
      task.value = await getImportTask(projectKey, taskId);

      if (hasParsedCases(task.value.cases)) {
        reviewing.value = true;
        task.value = await reviewImportTask(projectKey, taskId);
      }
    } finally {
      loading.value = false;
      reviewing.value = false;
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
   * 只重试目标用例。
   */
  async function retryCase(item: ImportTaskCase) {
    if (!canRetryImportCase(item.status)) {
      return;
    }

    actingId.value = item.id;

    try {
      task.value = await retryImportCase(projectKey, taskId, item.id);
    } finally {
      actingId.value = '';
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

  return {
    task,
    cases,
    loading,
    reviewing,
    actingId,
    loadTask,
    confirmCase,
    retryCase,
    publishCase
  };
}
