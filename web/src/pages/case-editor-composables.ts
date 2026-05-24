import { computed, nextTick, ref, type Ref } from 'vue';
import type { TableInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { CaseMeta, CaseStep, EnvMeta, PracticalReviewRecord, RunMode } from '../../../shared/types';
import {
  clearPracticalReviews,
  getCase,
  getPracticalReview,
  listPracticalReviews,
  startPracticalReview,
  startRecord,
  stopRecord
} from '../api/cases';
import { getAuthState, saveLogin, startLogin } from '../api/auth';
import { setProjectEnv } from '../state/project-env';
import { getErrorMessage } from '../utils/error';
import { canMoveSteps, copySteps, moveSteps, removeSteps } from './case-editor';

interface CaseAuthOptions {
  projectKey: string;
  envs: Ref<EnvMeta[]>;
  activeEnv: Ref<EnvMeta | null>;
  selectedEnv: Ref<string>;
}

/**
 * 管理用例编辑器的环境登录态。
 */
export function useCaseAuth(options: CaseAuthOptions) {
  const hasAuth = ref(false);
  const authPath = ref('');
  const loginId = ref('');
  const loadingLogin = ref(false);
  const savingLogin = ref(false);

  /**
   * 加载当前环境登录态。
   */
  async function loadAuthState() {
    if (!options.activeEnv.value) {
      hasAuth.value = false;
      authPath.value = '';
      return;
    }

    const state = await getAuthState(options.projectKey, options.activeEnv.value.key);
    hasAuth.value = state.exists;
    authPath.value = state.path;
  }

  /**
   * 切换当前实测检查环境。
   */
  async function changeEnv() {
    const nextEnv = options.envs.value.find((env) => env.key === options.selectedEnv.value) ?? null;
    options.activeEnv.value = nextEnv;
    loginId.value = '';

    if (nextEnv) {
      setProjectEnv(options.projectKey, nextEnv.key);
    }

    await loadAuthState();
  }

  /**
   * 打开浏览器保存当前环境登录态。
   */
  async function openLogin() {
    if (!options.activeEnv.value) {
      ElMessage.warning('请先配置项目环境');
      return;
    }

    loadingLogin.value = true;

    try {
      const session = await startLogin(options.projectKey, { envKey: options.activeEnv.value.key });
      loginId.value = session.sessionId;
      ElMessage.success('已打开浏览器，请完成登录后返回本页面保存登录态');
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    } finally {
      loadingLogin.value = false;
    }
  }

  /**
   * 保存当前环境登录态文件。
   */
  async function saveAuth() {
    if (!loginId.value) {
      ElMessage.warning('请先打开浏览器完成登录');
      return;
    }

    savingLogin.value = true;

    try {
      const auth = await saveLogin(options.projectKey, loginId.value);
      authPath.value = auth.path;
      hasAuth.value = true;
      loginId.value = '';
      ElMessage.success('登录态已保存，实测检查和运行测试会自动复用');
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    } finally {
      savingLogin.value = false;
    }
  }

  return {
    hasAuth,
    authPath,
    loginId,
    loadingLogin,
    savingLogin,
    loadAuthState,
    changeEnv,
    openLogin,
    saveAuth
  };
}

interface StepBatchOptions {
  item: Ref<CaseMeta | null>;
  stepTable: Ref<TableInstance | undefined>;
  selectedId: Ref<string>;
  setActiveSteps: (steps: CaseStep[]) => void;
  markStepReviewPending: (step: CaseStep) => void;
  clearStepReview: (stepId?: string) => void;
  showError: (error: unknown) => void;
}

/**
 * 管理步骤表格批量选择和批量操作。
 */
export function useStepBatch(options: StepBatchOptions) {
  const isBatchMode = ref(false);
  const batchIds = ref<string[]>([]);
  const hasBatch = computed(() => batchIds.value.length > 0);
  const canBatchUp = computed(() =>
    options.item.value ? canMoveSteps(options.item.value.steps, batchIds.value, -1) : false
  );
  const canBatchDown = computed(() =>
    options.item.value ? canMoveSteps(options.item.value.steps, batchIds.value, 1) : false
  );

  /**
   * 进入或退出批量操作模式。
   */
  function toggleBatchMode() {
    isBatchMode.value = !isBatchMode.value;

    if (!isBatchMode.value) {
      clearBatch();
    }
  }

  /**
   * 同步表格多选状态。
   */
  function updateBatch(rows: CaseStep[]) {
    batchIds.value = rows.map((row) => row.id);
  }

  /**
   * 清空批量选择。
   */
  function clearBatch() {
    batchIds.value = [];
    options.stepTable.value?.clearSelection();
  }

  /**
   * 全选当前所有步骤。
   */
  async function selectAllSteps() {
    if (!options.item.value) {
      return;
    }

    await nextTick();
    options.stepTable.value?.clearSelection();

    for (const row of options.item.value.steps) {
      options.stepTable.value?.toggleRowSelection(row, true);
    }

    batchIds.value = options.item.value.steps.map((row) => row.id);
  }

  /**
   * 批量删除选中的步骤。
   */
  async function deleteBatch() {
    if (!options.item.value || !hasBatch.value) {
      return;
    }

    try {
      await ElMessageBox.confirm(`确认删除选中的 ${batchIds.value.length} 个步骤吗？`, '批量删除', {
        type: 'warning'
      });
      const removed = removeSteps(options.item.value.steps, batchIds.value);
      for (const row of removed) {
        options.clearStepReview(row.id);
      }
      clearBatch();

      if (removed.some((row) => row.id === options.selectedId.value)) {
        options.selectedId.value = '';
      }
    } catch (error) {
      if (error !== 'cancel') {
        options.showError(error);
      }
    }
  }

  /**
   * 批量复制选中的步骤。
   */
  function duplicateBatch() {
    if (!options.item.value || !hasBatch.value) {
      return;
    }

    const rows = copySteps(options.item.value.steps, batchIds.value);
    options.setActiveSteps(rows);
    for (const row of rows) {
      options.markStepReviewPending(row);
    }
    clearBatch();
  }

  /**
   * 批量调整步骤顺序。
   */
  function shiftBatch(offset: -1 | 1) {
    if (!options.item.value || !hasBatch.value) {
      return;
    }

    const rows = moveSteps(options.item.value.steps, batchIds.value, offset);
    options.setActiveSteps(rows);
  }

  return {
    isBatchMode,
    batchIds,
    hasBatch,
    canBatchUp,
    canBatchDown,
    toggleBatchMode,
    updateBatch,
    clearBatch,
    selectAllSteps,
    deleteBatch,
    duplicateBatch,
    shiftBatch
  };
}

interface CasePracticalOptions {
  projectKey: string;
  caseKey: string;
  item: Ref<CaseMeta | null>;
  activeEnv: Ref<EnvMeta | null>;
  practicalMode: Ref<RunMode>;
  showError: (error: unknown) => void;
}

/**
 * 管理用例实测检查、历史记录和失败分析。
 */
export function useCasePractical(options: CasePracticalOptions) {
  const practicalReviewing = ref(false);
  const practicalHistoryOpen = ref(false);
  const failureDrawerOpen = ref(false);
  const practicalHistory = ref<PracticalReviewRecord[]>([]);
  const activePracticalRecord = ref<PracticalReviewRecord | null>(null);

  /**
   * 执行当前用例的实测检查。
   */
  async function runPracticalCheck() {
    if (!options.activeEnv.value) {
      ElMessage.warning('请先配置项目环境');
      return;
    }

    practicalReviewing.value = true;

    try {
      const record = await startPracticalReview(options.projectKey, options.caseKey, {
        envKey: options.activeEnv.value.key,
        mode: options.practicalMode.value
      });
      activePracticalRecord.value = record;
      options.item.value = await getCase(options.projectKey, options.caseKey);

      if (record.status === 'failed') {
        failureDrawerOpen.value = true;
        ElMessage.error(record.summary.failureMessage ?? '实测检查失败');
      } else {
        ElMessage.success('实测检查通过');
      }
    } catch (error) {
      options.showError(error);
    } finally {
      practicalReviewing.value = false;
    }
  }

  /**
   * 打开当前用例的实测检查历史。
   */
  async function openPracticalHistory() {
    try {
      practicalHistory.value = await listPracticalReviews(options.projectKey, options.caseKey);
      practicalHistoryOpen.value = true;
    } catch (error) {
      options.showError(error);
    }
  }

  /**
   * 清理当前用例的实测检查历史。
   */
  async function clearPracticalHistory() {
    const confirmed = await ElMessageBox.confirm('确认清理当前用例的实测检查历史吗？', '清理历史', {
      confirmButtonText: '清理',
      cancelButtonText: '取消',
      type: 'warning'
    }).catch(() => false);

    if (!confirmed) {
      return;
    }

    try {
      await clearPracticalReviews(options.projectKey, options.caseKey);
      practicalHistory.value = [];
      ElMessage.success('实测检查历史已清理');
    } catch (error) {
      options.showError(error);
    }
  }

  /**
   * 打开指定实测检查记录的失败分析。
   */
  function openFailureAnalysis(record: PracticalReviewRecord) {
    activePracticalRecord.value = record;
    failureDrawerOpen.value = true;
  }

  /**
   * 打开最近一次失败实测检查的分析。
   */
  async function openLatestFailureAnalysis() {
    if (!options.item.value?.practicalReview?.reviewId) {
      return;
    }

    try {
      if (
        !activePracticalRecord.value ||
        activePracticalRecord.value.id !== options.item.value.practicalReview.reviewId
      ) {
        activePracticalRecord.value = await getPracticalReview(
          options.projectKey,
          options.caseKey,
          options.item.value.practicalReview.reviewId
        );
      }

      failureDrawerOpen.value = true;
    } catch (error) {
      options.showError(error);
    }
  }

  return {
    practicalReviewing,
    practicalHistoryOpen,
    failureDrawerOpen,
    practicalHistory,
    activePracticalRecord,
    runPracticalCheck,
    openPracticalHistory,
    clearPracticalHistory,
    openFailureAnalysis,
    openLatestFailureAnalysis
  };
}

interface CaseRecordOptions {
  projectKey: string;
  caseKey: string;
  item: Ref<CaseMeta | null>;
  activeEnv: Ref<EnvMeta | null>;
  clearStepReviewPreview: () => void;
  runStepReviewPreview: (step: CaseStep) => void;
  showError: (error: unknown) => void;
}

/**
 * 管理用例录制会话和录制结果导入。
 */
export function useCaseRecord(options: CaseRecordOptions) {
  const recordId = ref('');
  const isRecording = ref(false);

  /**
   * 启动有头浏览器录制当前用例。
   */
  async function startRecordCase() {
    if (!options.activeEnv.value) {
      ElMessage.warning('请先配置项目环境');
      return;
    }

    const envLabel = `${options.activeEnv.value.name}（${options.activeEnv.value.key}）`;

    try {
      await ElMessageBox.confirm(
        `当前录制环境：${envLabel}。停止录制后会用录制结果替换当前编辑页步骤，替换后仍需手动保存。`,
        '开始录制',
        { type: 'warning' }
      );

      const result = await startRecord(options.projectKey, options.caseKey, { envKey: options.activeEnv.value.key });
      recordId.value = result.sessionId;
      isRecording.value = true;
      ElMessage.success('录制窗口已打开，请在浏览器中完成操作和断言');
    } catch (error) {
      if (error !== 'cancel') {
        options.showError(error);
      }
    }
  }

  /**
   * 停止录制并把录制步骤导入当前编辑页。
   */
  async function stopRecordCase() {
    if (!recordId.value) {
      return;
    }

    try {
      const result = await stopRecord(options.projectKey, options.caseKey, recordId.value);
      if (options.item.value) {
        options.item.value.steps = result.steps;
        options.clearStepReviewPreview();
        options.item.value.steps.forEach((step) => options.runStepReviewPreview(step));
      }
      recordId.value = '';
      isRecording.value = false;
      ElMessage.success('录制结果已导入当前编辑页，请保存草稿或生成测试文件');
    } catch (error) {
      options.showError(error);
    }
  }

  return {
    recordId,
    isRecording,
    startRecordCase,
    stopRecordCase
  };
}
