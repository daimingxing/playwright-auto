<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { TableInstance } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowDown,
  ArrowUp,
  Back,
  CopyDocument,
  Delete,
  Finished,
  InfoFilled,
  MoreFilled,
  Plus,
  Select,
} from "@element-plus/icons-vue";
import LocatorBuilderDrawer from "../components/LocatorBuilderDrawer.vue";
import type {
  CaseMeta,
  CaseStep,
  EnvMeta,
  PracticalReviewRecord,
  CaseStatus,
  StepType,
} from "../../../shared/types";
import {
  clearPracticalReviews,
  getCase,
  getPracticalReview,
  listPracticalReviews,
  saveCaseDraft,
  startPracticalReview,
  startRecord,
  stopRecord,
  updateCase,
  updateCaseStatus,
} from "../api/cases";
import { getAuthState, saveLogin, startLogin } from "../api/auth";
import { getAppStepConfig, getProject } from "../api/projects";
import { getProjectEnv, setProjectEnv } from "../state/project-env";
import { getErrorIssues, getErrorMessage } from "../utils/error";
import { reviewCaseStep } from "../../../shared/case-review";
import {
  canMoveSteps,
  copyStep,
  copySteps,
  formatCaseStatus,
  formatCheckStatus,
  formatStepType,
  formatStepReviewState,
  formatPracticalReviewStatus,
  getFailedPracticalStep,
  getInsertIndex,
  getPracticalReviewTagType,
  getStepIndexLabel,
  getStartPreview,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  moveSteps,
  removeStep,
  removeSteps,
  mergeStepReviewState,
  type StepReviewPreview,
  stepGroups,
  stepLabels,
  stepTimeouts,
} from "./case-editor";
import { formatLocatorSummary } from "./locator-builder";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const caseKey = String(route.params.caseKey);
const item = ref<CaseMeta | null>(null);
const envs = ref<EnvMeta[]>([]);
const activeEnv = ref<EnvMeta | null>(null);
const selectedEnv = ref("");
const stepConfig = ref(stepTimeouts);
const stepTable = ref<TableInstance>();
const recordId = ref("");
const isRecording = ref(false);
const isBatchMode = ref(false);
const selectedId = ref("");
const batchIds = ref<string[]>([]);
const highlightId = ref("");
const practicalReviewing = ref(false);
const practicalHistoryOpen = ref(false);
const failureDrawerOpen = ref(false);
const locatorDrawerOpen = ref(false);
const locatorStepId = ref("");
const practicalHistory = ref<PracticalReviewRecord[]>([]);
const activePracticalRecord = ref<PracticalReviewRecord | null>(null);
const stepReviewPreview = ref(new Map<string, StepReviewPreview>());
const hasAuth = ref(false);
const authPath = ref("");
const loginId = ref("");
const loadingLogin = ref(false);
const savingLogin = ref(false);
const stepFlashMs = 180;
const reviewDebounceMs = 400;
// 浏览器环境下 `window.setTimeout` 返回数值型定时器句柄，避免与 Node 的 `Timeout` 类型混淆。
let highlightTimer: number | undefined;
const reviewTimers = new Map<string, number>();
const reviewLabels = {
  error: "错误",
  danger: "高危",
  warning: "警告",
  info: "提示",
} as const;
const reviewTypes = {
  error: "danger",
  danger: "warning",
  warning: "warning",
  info: "info",
} as const;
const reviewGroupLabels = {
  integrity: "完整性",
  locator: "定位",
  assertion: "断言",
  timeout: "等待时间",
} as const;
const reviewMap = computed(() => {
  const map = new Map<string, NonNullable<CaseMeta["review"]>["items"]>();

  for (const review of item.value?.review?.items ?? []) {
    const items = map.get(review.stepId) ?? [];
    items.push(review);
    map.set(review.stepId, items);
  }

  return map;
});
const hasBatch = computed(() => batchIds.value.length > 0);
const canBatchUp = computed(() =>
  item.value ? canMoveSteps(item.value.steps, batchIds.value, -1) : false,
);
const canBatchDown = computed(() =>
  item.value ? canMoveSteps(item.value.steps, batchIds.value, 1) : false,
);
const startPreview = computed(() => getStartPreview(item.value, activeEnv.value));
const activeLocatorStep = computed(() => item.value?.steps.find((row) => row.id === locatorStepId.value));
const activeLocatorSelector = computed(() => activeLocatorStep.value?.selector ?? "");

/**
 * 切换当前用例状态。
 */
async function changeCaseStatus(status: CaseStatus) {
  if (!item.value) {
    return;
  }

  const previous = item.value.status;

  try {
    item.value.status = status;
    item.value = await updateCaseStatus(projectKey, caseKey, status);
    ElMessage.success("用例状态已更新");
  } catch (error) {
    item.value.status = previous;
    showError(error);
  }
}

/**
 * 加载当前用例。
 */
async function loadCase() {
  const [caseInfo, config, project] = await Promise.all([
    getCase(projectKey, caseKey),
    getAppStepConfig(),
    getProject(projectKey),
  ]);
  item.value = caseInfo;
  clearStepReviewPreview();
  stepConfig.value = config.steps.timeouts;
  envs.value = project.envs;
  activeEnv.value = getProjectEnv(project) ?? null;
  selectedEnv.value = activeEnv.value?.key ?? "";
  await loadAuthState();
}

/**
 * 切换当前实测检查环境。
 */
async function changeEnv() {
  const nextEnv = envs.value.find((env) => env.key === selectedEnv.value) ?? null;
  activeEnv.value = nextEnv;
  loginId.value = "";

  if (nextEnv) {
    setProjectEnv(projectKey, nextEnv.key);
  }

  await loadAuthState();
}

/**
 * 加载当前实测环境的登录态状态。
 */
async function loadAuthState() {
  if (!activeEnv.value) {
    hasAuth.value = false;
    authPath.value = "";
    return;
  }

  const state = await getAuthState(projectKey, activeEnv.value.key);
  hasAuth.value = state.exists;
  authPath.value = state.path;
}

/**
 * 打开浏览器让用户保存当前实测环境登录态。
 */
async function openLogin() {
  if (!activeEnv.value) {
    ElMessage.warning("请先配置项目环境");
    return;
  }

  loadingLogin.value = true;

  try {
    const session = await startLogin(projectKey, { envKey: activeEnv.value.key });
    loginId.value = session.sessionId;
    ElMessage.success("已打开浏览器，请完成登录后返回本页面保存登录态");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loadingLogin.value = false;
  }
}

/**
 * 保存当前实测环境的登录态文件。
 */
async function saveAuth() {
  if (!loginId.value) {
    ElMessage.warning("请先打开浏览器完成登录");
    return;
  }

  savingLogin.value = true;

  try {
    const auth = await saveLogin(projectKey, loginId.value);
    authPath.value = auth.path;
    hasAuth.value = true;
    loginId.value = "";
    ElMessage.success("登录态已保存，实测检查和运行测试会自动复用");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingLogin.value = false;
  }
}

/**
 * 按当前选中位置新增一个步骤。
 */
function addStep(type: StepType) {
  if (!item.value) {
    return;
  }

  const row = insertStep(
    item.value.steps,
    getInsertIndex(item.value.steps, selectedId.value),
    type,
    stepConfig.value,
  );
  setActiveStep(row);
  markStepReviewPending(row);
}

/**
 * 删除一个步骤。
 */
function deleteStep(index: number) {
  if (!item.value) {
    return;
  }

  const row = item.value.steps[index];
  removeStep(item.value.steps, index);
  clearStepReview(row?.id);

  if (row?.id === selectedId.value) {
    selectedId.value = "";
  }
}

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
  stepTable.value?.clearSelection();
}

/**
 * 全选当前所有步骤。
 */
async function selectAllSteps() {
  if (!item.value) {
    return;
  }

  await nextTick();
  stepTable.value?.clearSelection();

  for (const row of item.value.steps) {
    stepTable.value?.toggleRowSelection(row, true);
  }

  batchIds.value = item.value.steps.map((row) => row.id);
}

/**
 * 批量删除选中的步骤。
 */
async function deleteBatch() {
  if (!item.value || !hasBatch.value) {
    return;
  }

  try {
    await ElMessageBox.confirm(`确认删除选中的 ${batchIds.value.length} 个步骤吗？`, "批量删除", {
      type: "warning",
    });
    const removed = removeSteps(item.value.steps, batchIds.value);
    for (const row of removed) {
      clearStepReview(row.id);
    }
    clearBatch();

    if (removed.some((row) => row.id === selectedId.value)) {
      selectedId.value = "";
    }
  } catch (error) {
    if (error !== "cancel") {
      showError(error);
    }
  }
}

/**
 * 批量复制选中的步骤。
 */
function duplicateBatch() {
  if (!item.value || !hasBatch.value) {
    return;
  }

  const rows = copySteps(item.value.steps, batchIds.value);
  setActiveSteps(rows);
  for (const row of rows) {
    markStepReviewPending(row);
  }
  clearBatch();
}

/**
 * 批量调整步骤顺序。
 */
function shiftBatch(offset: -1 | 1) {
  if (!item.value || !hasBatch.value) {
    return;
  }

  const rows = moveSteps(item.value.steps, batchIds.value, offset);
  setActiveSteps(rows);
}

/**
 * 复制一个步骤并插入到其后方。
 */
function duplicateStep(index: number) {
  if (!item.value) {
    return;
  }

  const row = copyStep(item.value.steps, index);
  setActiveStep(row);
  markStepReviewPending(row);
}

/**
 * 调整步骤顺序。
 */
function shiftStep(index: number, offset: -1 | 1) {
  if (!item.value) {
    return;
  }

  const row = moveStep(item.value.steps, index, offset);
  setActiveStep(row);
}

/**
 * 设置当前焦点步骤和短暂高亮。
 */
function setActiveStep(step?: CaseStep) {
  if (!step) {
    return;
  }

  selectedId.value = step.id;
  highlightId.value = step.id;

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  // 高亮时长与 CSS 动画保持一致，避免移动后视觉反馈拖沓。
  highlightTimer = window.setTimeout(() => {
    highlightId.value = "";
  }, stepFlashMs);
}

/**
 * 设置多个步骤的短暂高亮。
 */
function setActiveSteps(steps: CaseStep[]) {
  const first = steps[0];

  if (!first) {
    return;
  }

  selectedId.value = first.id;
  highlightId.value = first.id;

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  // 批量操作先高亮第一条受影响步骤，避免多个动画同时闪烁造成干扰。
  highlightTimer = window.setTimeout(() => {
    highlightId.value = "";
  }, stepFlashMs);
}

/**
 * 单击行时切换当前步骤焦点。
 */
function selectStep(row: CaseStep) {
  selectedId.value = row.id;
}

/**
 * 打开指定步骤的定位器构建器。
 */
function openLocatorBuilder(step: CaseStep) {
  locatorStepId.value = step.id;
  locatorDrawerOpen.value = true;
}

/**
 * 把定位器构建器生成的 selector 写回当前步骤。
 */
function applyLocatorSelector(selector: string) {
  const step = activeLocatorStep.value;

  if (!step) {
    return;
  }

  step.selector = selector;
  markStepReviewPending(step);
}

/**
 * 生成步骤行的状态类名。
 */
function getRowClass({ row }: { row: CaseStep }) {
  const classes: string[] = [];

  if (row.id === selectedId.value) {
    classes.push("is-selected-step");
  }

  if (row.id === highlightId.value) {
    classes.push("is-step-flash");
  }

  return classes.join(" ");
}

/**
 * 获取步骤对应的审查结果。
 */
function getStepReviews(step: CaseStep) {
  return reviewMap.value.get(step.id) ?? [];
}

/**
 * 获取步骤合并后的基础检查状态。
 */
function getStepReviewState(step: CaseStep) {
  return mergeStepReviewState(step.id, getStepReviews(step), stepReviewPreview.value);
}

/**
 * 获取步骤当前展示的基础检查问题。
 */
function getVisibleStepReviews(step: CaseStep) {
  return getStepReviewState(step).reviews;
}

/**
 * 标记步骤基础检查预览等待重新计算。
 */
function markStepReviewPending(step: CaseStep) {
  stepReviewPreview.value.set(step.id, "pending");
  stepReviewPreview.value = new Map(stepReviewPreview.value);
  scheduleStepReview(step);
}

/**
 * 停止编辑 400ms 后执行当前步骤基础检查预览。
 */
function scheduleStepReview(step: CaseStep) {
  const previousTimer = reviewTimers.get(step.id);

  if (previousTimer) {
    window.clearTimeout(previousTimer);
  }

  const timer = window.setTimeout(() => {
    runStepReviewPreview(step);
  }, reviewDebounceMs);

  reviewTimers.set(step.id, timer);
}

/**
 * 输入框失焦时立即执行还在等待的基础检查预览。
 */
function flushStepReview(step: CaseStep) {
  if (!reviewTimers.has(step.id)) {
    return;
  }

  runStepReviewPreview(step);
}

/**
 * 运行单步骤基础检查预览。
 */
function runStepReviewPreview(step: CaseStep) {
  const timer = reviewTimers.get(step.id);

  if (timer) {
    window.clearTimeout(timer);
    reviewTimers.delete(step.id);
  }

  const stepIndex = item.value?.steps.findIndex((row) => row.id === step.id) ?? -1;

  if (stepIndex < 0) {
    clearStepReview(step.id);
    return;
  }

  stepReviewPreview.value.set(step.id, reviewCaseStep(step, stepIndex));
  stepReviewPreview.value = new Map(stepReviewPreview.value);
}

/**
 * 清理指定步骤的基础检查预览状态。
 */
function clearStepReview(stepId?: string) {
  if (!stepId) {
    return;
  }

  const timer = reviewTimers.get(stepId);

  if (timer) {
    window.clearTimeout(timer);
    reviewTimers.delete(stepId);
  }

  stepReviewPreview.value.delete(stepId);
  stepReviewPreview.value = new Map(stepReviewPreview.value);
}

/**
 * 清理全部基础检查预览状态。
 */
function clearStepReviewPreview() {
  for (const timer of reviewTimers.values()) {
    window.clearTimeout(timer);
  }

  reviewTimers.clear();
  stepReviewPreview.value = new Map();
}

/**
 * 执行当前用例的实测检查。
 */
async function runPracticalCheck() {
  if (!activeEnv.value) {
    ElMessage.warning("请先配置项目环境");
    return;
  }

  practicalReviewing.value = true;

  try {
    const record = await startPracticalReview(projectKey, caseKey, { envKey: activeEnv.value.key });
    activePracticalRecord.value = record;
    item.value = await getCase(projectKey, caseKey);

    if (record.status === "failed") {
      failureDrawerOpen.value = true;
      ElMessage.error(record.summary.failureMessage ?? "实测检查失败");
    } else {
      ElMessage.success("实测检查通过");
    }
  } catch (error) {
    showError(error);
  } finally {
    practicalReviewing.value = false;
  }
}

/**
 * 打开当前用例的实测检查历史。
 */
async function openPracticalHistory() {
  try {
    practicalHistory.value = await listPracticalReviews(projectKey, caseKey);
    practicalHistoryOpen.value = true;
  } catch (error) {
    showError(error);
  }
}

/**
 * 清理当前用例的实测检查历史。
 */
async function clearPracticalHistory() {
  const confirmed = await ElMessageBox.confirm("确认清理当前用例的实测检查历史吗？", "清理历史", {
    confirmButtonText: "清理",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await clearPracticalReviews(projectKey, caseKey);
    practicalHistory.value = [];
    ElMessage.success("实测检查历史已清理");
  } catch (error) {
    showError(error);
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
  if (!item.value?.practicalReview?.reviewId) {
    return;
  }

  try {
    if (
      !activePracticalRecord.value ||
      activePracticalRecord.value.id !== item.value.practicalReview.reviewId
    ) {
      activePracticalRecord.value = await getPracticalReview(
        projectKey,
        caseKey,
        item.value.practicalReview.reviewId,
      );
    }

    failureDrawerOpen.value = true;
  } catch (error) {
    showError(error);
  }
}

/**
 * 保存用例并重新生成测试文件。
 */
async function saveCase() {
  if (!item.value) {
    return;
  }

  try {
    item.value = await updateCase(projectKey, caseKey, item.value);
    clearStepReviewPreview();
    await router.push(`/projects/${projectKey}`);
  } catch (error) {
    showError(error);
  }
}

/**
 * 保存当前用例草稿。
 */
async function saveDraft() {
  if (!item.value) {
    return;
  }

  try {
    item.value = await saveCaseDraft(projectKey, caseKey, item.value);
    clearStepReviewPreview();
    ElMessage.success("草稿已保存");
  } catch (error) {
    showError(error);
  }
}

/**
 * 启动有头浏览器录制当前用例。
 */
async function startRecordCase() {
  try {
    await ElMessageBox.confirm(
      "录制完成后会用录制结果覆盖当前步骤，请确认当前改动已保存。",
      "开始录制",
      { type: "warning" },
    );

    const result = await startRecord(projectKey, caseKey);
    recordId.value = result.sessionId;
    isRecording.value = true;
    ElMessage.success("录制窗口已打开，请在浏览器中完成操作和断言");
  } catch (error) {
    if (error !== "cancel") {
      showError(error);
    }
  }
}

/**
 * 停止录制并导入录制步骤。
 */
async function stopRecordCase() {
  if (!recordId.value) {
    return;
  }

  try {
    item.value = await stopRecord(projectKey, caseKey, recordId.value);
    recordId.value = "";
    isRecording.value = false;
    ElMessage.success("录制结果已导入当前用例");
  } catch (error) {
    showError(error);
  }
}

/**
 * 展示接口错误和基础检查问题。
 */
function showError(error: unknown) {
  const issues = getErrorIssues(error);

  if (issues.length > 0) {
    ElMessage.error(`${getErrorMessage(error)}：${issues[0]}`);
    return;
  }

  ElMessage.error(getErrorMessage(error));
}

onMounted(loadCase);
</script>

<template>
  <section class="page" v-if="item">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>{{ item.name }}</h2>
      </div>
      <div class="toolbar-actions btn-shadow-md">
        <el-button v-if="!isRecording" @click="startRecordCase">开始录制</el-button>
        <el-button v-else type="warning" @click="stopRecordCase">停止录制</el-button>
        <el-button :disabled="isRecording" @click="saveDraft">保存草稿</el-button>
        <el-button type="primary" :disabled="isRecording" @click="saveCase"
          >保存并生成测试文件</el-button
        >
      </div>
    </div>

    <div class="content">
      <div class="meta">
        <el-alert
          v-if="isRecording"
          class="record-alert"
          title="正在录制，请在有头浏览器中完成操作和断言，完成后点击停止录制。"
          type="warning"
          show-icon
          :closable="false"
        />

        <div class="meta-grid">
          <el-form label-width="90px">
            <el-form-item label="用例状态">
              <div class="case-state-row">
                <el-select
                  :model-value="item.status"
                  class="case-state-select"
                  @change="(value) => changeCaseStatus(value as CaseStatus)"
                >
                  <el-option label="草稿" value="draft" />
                  <el-option label="待启用" value="ready" />
                  <el-option label="启用" value="active" />
                </el-select>
                <el-tag :type="formatCaseStatus(item.status).type" effect="light">
                  {{ formatCaseStatus(item.status).label }}
                </el-tag>
                <el-tag :type="formatCheckStatus(item).type" effect="light">
                  {{ formatCheckStatus(item).label }}
                </el-tag>
              </div>
            </el-form-item>
            <el-form-item label="用例名称">
              <el-input v-model="item.name" />
            </el-form-item>
            <el-form-item label="起始路径">
              <el-input v-model="item.startPath" />
            </el-form-item>
            <el-form-item label="实际地址">
              <div class="start-preview">{{ startPreview || "-" }}</div>
            </el-form-item>
            <el-form-item label="登录态">
              <div class="auth-status-wrap btn-shadow-md">
                <el-tag :type="hasAuth ? 'success' : 'info'" effect="light" class="auth-tag">
                  {{ hasAuth ? "已保存" : "未保存" }}
                </el-tag>
                <el-tooltip v-if="authPath" :content="authPath" placement="top">
                  <el-icon class="auth-help"><InfoFilled /></el-icon>
                </el-tooltip>
                <el-button :loading="loadingLogin" @click="openLogin">打开浏览器登录</el-button>
                <el-button
                  :disabled="!loginId"
                  :loading="savingLogin"
                  type="primary"
                  plain
                  @click="saveAuth"
                >
                  我已完成登录，保存登录态
                </el-button>
              </div>
            </el-form-item>
          </el-form>

          <section class="practical-panel">
            <div class="panel-head">
              <strong>实测检查</strong>
              <el-tag :type="getPracticalReviewTagType(item.practicalReview)" effect="light">
                {{ formatPracticalReviewStatus(item.practicalReview) }}
              </el-tag>
            </div>
            <div class="panel-row env-row">
              <span>检查环境</span>
              <el-select v-model="selectedEnv" class="practical-env-select" @change="changeEnv">
                <el-option
                  v-for="env in envs"
                  :key="env.key"
                  :label="`${env.name}（${env.key}）`"
                  :value="env.key"
                />
              </el-select>
            </div>
            <div class="panel-row">
              <span>最后检查时间</span>
              <strong>{{ item.practicalReview?.checkedAt ?? "-" }}</strong>
            </div>
            <p v-if="item.practicalReview?.status === 'failed'" class="failure-summary">
              第 {{ (item.practicalReview.failedStepIndex ?? 0) + 1 }} 步：{{
                item.practicalReview.failureMessage
              }}
            </p>
            <div class="panel-actions btn-shadow-md">
              <el-button type="primary" :loading="practicalReviewing" @click="runPracticalCheck"
                >开始实测检查</el-button
              >
              <el-button @click="openPracticalHistory">查看历史</el-button>
              <el-button @click="clearPracticalHistory">清理历史</el-button>
            </div>
          </section>
        </div>
      </div>
      <div class="step-actions btn-shadow-md">
        <el-dropdown trigger="click" @command="(type) => addStep(type as StepType)">
          <el-button type="primary">
            <el-icon><Plus /></el-icon>
            <span>添加步骤</span>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu class="step-menu">
              <template v-for="group in stepGroups" :key="group.label">
                <el-dropdown-item class="step-menu-title" disabled>{{
                  group.label
                }}</el-dropdown-item>
                <el-dropdown-item v-for="type in group.types" :key="type" :command="type">
                  <span class="step-menu-label">{{ stepLabels[type] }}</span>
                  <span class="step-menu-code">{{ type }}</span>
                </el-dropdown-item>
              </template>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <span class="insert-hint">
          {{ selectedId ? "将插入到选中步骤后方" : "未选中步骤时追加到末尾" }}
        </span>
        <el-divider direction="vertical" />
        <template v-if="!isBatchMode">
          <el-button :icon="Select" @click="toggleBatchMode">批量操作</el-button>
        </template>
        <template v-else>
          <span class="batch-count">已选 {{ batchIds.length }} 条</span>
          <el-button :icon="Finished" @click="selectAllSteps">全选</el-button>
          <el-button :icon="ArrowUp" :disabled="!canBatchUp" @click="shiftBatch(-1)"
            >上移</el-button
          >
          <el-button :icon="ArrowDown" :disabled="!canBatchDown" @click="shiftBatch(1)"
            >下移</el-button
          >
          <el-button :icon="CopyDocument" :disabled="!hasBatch" @click="duplicateBatch"
            >复制</el-button
          >
          <el-button :icon="Delete" type="danger" plain :disabled="!hasBatch" @click="deleteBatch"
            >删除</el-button
          >
          <el-button @click="toggleBatchMode">取消批量</el-button>
        </template>
      </div>
      <div class="table-wrap">
        <el-table
          ref="stepTable"
          :data="item.steps"
          border
          stripe
          height="100%"
          row-key="id"
          :row-class-name="getRowClass"
          @row-click="selectStep"
          @selection-change="updateBatch"
        >
          <el-table-column v-if="isBatchMode" type="selection" width="44" reserve-selection />
          <el-table-column label="序号" width="60" align="center">
            <template #default="{ $index }">
              <span class="step-index">{{ getStepIndexLabel($index) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="步骤类型" width="120">
            <template #default="{ row }">
              <div class="step-type">
                <strong>{{ formatStepType(row.type).label }}</strong>
                <span>{{ formatStepType(row.type).code }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="基础检查" width="170">
            <template #default="{ row }">
              <div class="review-tags">
                <template v-if="getVisibleStepReviews(row).length > 0">
                  <el-popover
                    v-for="review in getVisibleStepReviews(row)"
                    :key="review.id"
                    placement="top"
                    width="320"
                    trigger="hover"
                  >
                    <template #reference>
                      <el-tag :type="reviewTypes[review.level]" effect="light">{{
                        reviewLabels[review.level]
                      }}</el-tag>
                    </template>
                    <div class="review-popover">
                      <strong>{{ review.message }}</strong>
                      <span class="review-group">{{ reviewGroupLabels[review.group] }}</span>
                      <p>{{ review.suggestion }}</p>
                    </div>
                  </el-popover>
                </template>
                <el-tag
                  v-if="item.practicalReview && getFailedPracticalStep(item.practicalReview, row)"
                  type="danger"
                  effect="light"
                  class="clickable-tag"
                  @click.stop="openLatestFailureAnalysis"
                  >
                  实测失败
                </el-tag>
                <el-tag
                  v-if="
                    getStepReviewState(row).status === 'pending' &&
                    !getFailedPracticalStep(item.practicalReview, row)
                  "
                  :type="formatStepReviewState(getStepReviewState(row)).type"
                  effect="light"
                >
                  {{ formatStepReviewState(getStepReviewState(row)).label }}
                </el-tag>
                <span
                  v-if="
                    getStepReviewState(row).status === 'passed' &&
                    !getFailedPracticalStep(item.practicalReview, row)
                  "
                  class="review-pass"
                >
                  {{ formatStepReviewState(getStepReviewState(row)).label }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="选择器">
            <template #default="{ row }">
              <div v-if="hasSelector(row.type)" class="locator-cell">
                <div class="locator-summary">
                  <strong>{{ formatLocatorSummary(row.selector) }}</strong>
                  <span>{{ row.selector || "未设置 selector" }}</span>
                </div>
                <el-button size="small" @click.stop="openLocatorBuilder(row)">编辑定位</el-button>
              </div>
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="输入值/断言值">
            <template #default="{ row }">
              <el-input
                v-if="hasValue(row.type)"
                v-model="row.value"
                placeholder="输入值或断言内容"
                @input="markStepReviewPending(row)"
                @blur="flushStepReview(row)"
              />
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="等待毫秒" width="180">
            <template #default="{ row }">
              <el-input-number
                v-if="hasTimeout(row.type)"
                v-model="row.timeout"
                :min="0"
                :step="500"
                @change="markStepReviewPending(row)"
                @blur="flushStepReview(row)"
              />
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ $index }">
              <div class="row-actions">
                <el-tooltip content="上移" placement="top" :show-after="500" :hide-after="0">
                  <el-button text circle :disabled="$index === 0" @click="shiftStep($index, -1)">
                    <el-icon><ArrowUp /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="下移" placement="top" :show-after="500" :hide-after="0">
                  <el-button
                    text
                    circle
                    :disabled="$index === item.steps.length - 1"
                    @click="shiftStep($index, 1)"
                  >
                    <el-icon><ArrowDown /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="复制" placement="top" :show-after="500" :hide-after="0">
                  <el-button text circle @click="duplicateStep($index)">
                    <el-icon><CopyDocument /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-dropdown
                  trigger="click"
                  popper-class="step-more-menu"
                  @command="(command) => command === 'delete' && deleteStep($index)"
                >
                  <el-button text circle title="更多" @click.stop>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item :icon="Delete" command="delete" class="danger-action">
                        删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-drawer v-model="failureDrawerOpen" title="失败分析" size="420px">
        <template v-if="activePracticalRecord">
          <div
            v-for="step in activePracticalRecord.steps.filter((row) => row.status === 'failed')"
            :key="step.stepId"
            class="analysis-block"
          >
            <h3>第 {{ step.stepIndex + 1 }} 步：{{ step.stepType }}</h3>
            <p class="analysis-message">{{ step.analysis?.message }}</p>
            <dl>
              <dt>目标定位</dt>
              <dd>{{ step.selector || "-" }}</dd>
              <dt>当前 URL</dt>
              <dd>{{ step.analysis?.currentUrl || "-" }}</dd>
              <dt>匹配数量</dt>
              <dd>{{ step.analysis?.matchCount ?? "-" }}</dd>
              <dt>建议</dt>
              <dd>{{ step.analysis?.suggestion || "-" }}</dd>
            </dl>
          </div>
        </template>
      </el-drawer>

      <el-drawer v-model="practicalHistoryOpen" title="实测检查历史" size="520px">
        <el-table :data="practicalHistory" border stripe empty-text="暂无实测检查历史">
          <el-table-column prop="startedAt" label="开始时间" min-width="180" />
          <el-table-column prop="envKey" label="环境" width="100" />
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <el-tag :type="getPracticalReviewTagType(row.summary)" effect="light">
                {{ formatPracticalReviewStatus(row.summary) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button
                size="small"
                :disabled="row.status !== 'failed'"
                @click="openFailureAnalysis(row)"
                >失败分析</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-drawer>

      <LocatorBuilderDrawer
        v-model="locatorDrawerOpen"
        :selector="activeLocatorSelector"
        @apply="applyLocatorSelector"
      />
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 28px;
  box-sizing: border-box;
  overflow: hidden;
  background: #f4f8fc;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  align-items: flex-end;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px; /* 抵消 el-button 的左内边距，使其与下方标题对齐 */
}

.back-btn:hover,
.back-btn:focus {
  color: #24466b;
  background-color: #eef5fb;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, auto) auto minmax(180px, 1fr);
  gap: 16px;
  overflow: hidden;
}

.meta {
  min-height: 0;
  max-height: min(320px, 42vh);
  overflow: auto;
  padding-right: 4px;
}

.meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 500px;
  gap: 18px;
}

.practical-panel {
  border: 1px solid #d8e2ed;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.panel-head,
.panel-row,
.panel-actions {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.panel-row {
  color: #5f7188;
  font-size: 13px;
  margin-top: 10px;
}

.env-row {
  align-items: center;
}

.panel-row strong {
  color: #1f2937;
}

.practical-env-select {
  width: 260px;
}

.panel-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 14px;
}

.failure-summary {
  color: #d94747;
  margin: 12px 0 0;
}

.auth-status-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.case-state-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.case-state-select {
  width: 128px;
}

.auth-tag {
  min-width: 54px;
  text-align: center;
}

.auth-help {
  color: #8796aa;
  cursor: help;
  font-size: 14px;
}

.start-preview {
  width: 100%;
  min-height: 32px;
  padding: 6px 11px;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  border: 1px solid #d8e2ed;
  border-radius: 6px;
  background: #eef5fb;
  color: #315f8f;
  font-family: Consolas, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.45;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 16px 0;
}

.insert-hint {
  color: #5f7188;
  font-size: 13px;
}

.batch-count {
  padding: 0 8px;
  color: #315f8f;
  font-size: 13px;
  font-weight: 600;
}

.step-menu-label {
  display: inline-block;
  min-width: 72px;
  color: #1f2937;
}

.step-menu-code {
  color: #8796aa;
  font-size: 12px;
}

.step-menu-title {
  margin-top: 4px;
  color: #5f7188;
  font-weight: 600;
  cursor: default;
}

.step-type {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.25;
}

.step-type strong {
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}

.step-type span {
  color: #8796aa;
  font-size: 12px;
}

.row-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
}

.row-actions :deep(.el-button.is-circle) {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  color: #64748b;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.row-actions :deep(.el-button.is-circle .el-icon) {
  font-size: 17px;
}

.row-actions :deep(.el-button.is-circle:not(.is-disabled):hover),
.row-actions :deep(.el-button.is-circle:not(.is-disabled):focus-visible) {
  color: #2563eb;
  border-color: #bfdbfe;
  background: #eff6ff;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.08);
}

.row-actions :deep(.el-button.is-circle.is-disabled) {
  color: #cbd5e1;
}

.field-empty {
  color: #c0c4cc;
}

.locator-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.locator-summary {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.locator-summary strong,
.locator-summary span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.locator-summary strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 600;
}

.locator-summary span {
  color: #8796aa;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
}

.step-index {
  color: #64748b;
  font-weight: 600;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.table-wrap :deep(.el-table__row) {
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}

.table-wrap :deep(.el-table__row.is-selected-step > td.el-table__cell) {
  background: #dbeafe;
}

.table-wrap :deep(.el-table__row.is-step-flash > td.el-table__cell) {
  background: #bfdbfe;
  animation: step-slide 180ms ease;
}

@keyframes step-slide {
  from {
    transform: translateY(-2px);
  }

  to {
    transform: translateY(0);
  }
}

.review-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.clickable-tag {
  cursor: pointer;
}

.review-pass {
  color: #67c23a;
  font-size: 13px;
}

.review-popover p {
  margin: 8px 0 0;
  color: #606266;
  line-height: 1.5;
}

.review-group {
  display: inline-flex;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #eef5fb;
  color: #315f8f;
  font-size: 12px;
}

.analysis-block h3 {
  margin: 0 0 10px;
}

.analysis-message {
  color: #d94747;
  font-weight: 600;
}

.analysis-block dt {
  color: #5f7188;
  font-size: 12px;
  margin-top: 12px;
}

.analysis-block dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

@media (max-width: 960px) {
  .meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.step-more-menu .danger-action {
  --el-dropdown-menuItem-hover-color: #c93535;
  --el-dropdown-menuItem-hover-fill: #fff1f1;
  color: #d94747;
}

.step-more-menu .danger-action .el-icon {
  color: #d94747;
}

.step-more-menu .danger-action:hover,
.step-more-menu .danger-action:focus {
  background: #fff1f1;
  color: #c93535;
}

.step-more-menu .danger-action:hover .el-icon,
.step-more-menu .danger-action:focus .el-icon {
  color: #c93535;
}
</style>
