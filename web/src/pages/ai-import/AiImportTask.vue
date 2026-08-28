<script setup lang="ts">
import { Back, Delete } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatLocatorSummary, type LocatorBuilderState } from "../../../../shared/locator-builder";
import { formatStepType, hasStepSelector, hasStepValue, type CaseStep, type ImportTaskCase } from "../../../../shared/types";
import LocatorBuilderDrawer from "../../components/LocatorBuilderDrawer.vue";
import { deleteImportTask } from "../../api/imports";
import { getErrorMessage } from "../../utils/error";
import { formatDateTime } from "../../utils/time";
import { useImportTaskReview } from "./ai-import-composables";
import {
  canConfirmImportCase,
  canEditImportActionIr,
  canPublishImportCase,
  canResumeImportTask,
  canRetryImportCase,
  canUnconfirmImportCase,
  formatImportCaseStatus,
  formatImportSummary,
  formatImportProgress,
  formatParseError,
  formatSourceCells,
  formatSourceRef,
  formatExploreWait,
  formatImportFailure,
  formatImportPublishError,
  getDeleteImportTaskConfirm,
  isExploreRunning,
  locatorEditHint,
  publishStepsEmpty,
  publishStepsHint,
  publishStepsTitle
} from "./ai-import";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const taskId = String(route.params.taskId);
const {
  task,
  cases,
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
} = useImportTaskReview(projectKey, taskId);
const locatorOpen = ref(false);
const locatorItem = ref<ImportTaskCase | null>(null);
const locatorStep = ref<CaseStep | null>(null);
const locatorSelector = computed(() => locatorStep.value?.selector ?? "");
const locatorDraft = computed(() => locatorStep.value?.selectorDraft);

/**
 * 读取单条用例的状态标签。
 */
function caseStatus(item: ImportTaskCase) {
  return formatImportCaseStatus(item.status);
}

/**
 * 读取已加载的定位和填写值。
 */
function actionIrOf(item: ImportTaskCase) {
  return actionIrById.value[item.id];
}

/**
 * 展开行时加载定位和填写值。
 */
function onCaseExpand(row: ImportTaskCase, expandedRows: ImportTaskCase[]) {
  if (!expandedRows.some((item) => item.id === row.id)) {
    return;
  }

  void loadActionIr(row).catch((error) => {
    ElMessage.error(getErrorMessage(error));
  });
}

/**
 * 打开定位器构建器，编辑发布用的结构化定位器。
 */
function openActionIrLocator(item: ImportTaskCase, step: CaseStep) {
  locatorItem.value = item;
  locatorStep.value = step;
  locatorOpen.value = true;
}

/**
 * 把构建器结果写回导入任务，不会自动发布正式用例。
 */
async function applyActionIrLocator(payload: { selector: string; draft: LocatorBuilderState }) {
  const item = locatorItem.value;
  const step = locatorStep.value;

  if (!item || !step) {
    return;
  }

  try {
    await saveActionIrLocator(item, step, payload);
    locatorOpen.value = false;
    ElMessage.success("已更新定位器，尚未发布正式用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 保存填写值或断言值。输入框已用 v-model 改过 step.value，这里按新值写回任务。
 */
async function commitPublishValue(item: ImportTaskCase, step: CaseStep, value: string) {
  try {
    await saveActionIr(item, { steps: [{ id: step.id, data: value }] });
    ElMessage.success("已更新填写值，尚未发布正式用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 确认当前用例并提示结果。
 */
async function submitConfirm(item: ImportTaskCase) {
  try {
    await confirmCase(item);
    ElMessage.success("已确认，尚未发布正式用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 重试当前用例并提示结果。成功提示只在生成待确认意图之后出现。
 */
async function submitRetry(item: ImportTaskCase) {
  try {
    const result = await retryCase(item);

    if (result.outcome === 'generated') {
      ElMessage.success("已重新生成该用例");
    } else if (result.outcome === 'failed') {
      ElMessage.error(formatImportFailure(result.failure ?? { kind: 'explore-failed', message: '' }));
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 发布当前用例并提示结果。
 */
async function submitPublish(item: ImportTaskCase) {
  try {
    await publishCase(item);
    ElMessage.success("已发布正式用例");
  } catch (error) {
    ElMessage.error(formatImportPublishError(error));
  }
}

/**
 * 取消确认，回到待确认。
 */
async function submitUnconfirm(item: ImportTaskCase) {
  try {
    await unconfirmCase(item);
    ElMessage.success("已取消确认，可以重试或继续处理待确认项");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 从检查点恢复并提示结果。
 */
async function submitResume() {
  try {
    await resumeTask();
    ElMessage.success("已从检查点恢复");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 确认后删除当前导入任务并返回任务列表。已发布正式用例不受影响。
 */
async function removeTask() {
  const fileName = task.value?.fileName;

  if (!fileName) {
    return;
  }

  const confirmed = await ElMessageBox.confirm(getDeleteImportTaskConfirm(fileName), "删除导入任务", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning"
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deleteImportTask(projectKey, taskId);
    ElMessage.success("已删除导入任务");
    await router.push(`/projects/${projectKey}/imports`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(async () => {
  try {
    await loadTask();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}/imports`)">
          返回 AI 导入
        </el-button>
        <h2>任务详情</h2>
      </div>
      <div class="toolbar-actions">
        <el-button v-if="task && canResumeImportTask(task)" :loading="reviewing" @click="submitResume">
          从检查点恢复
        </el-button>
        <el-button v-if="task" type="danger" plain :icon="Delete" @click="removeTask">删除任务</el-button>
      </div>
    </div>

    <div v-if="task" class="content">
      <section class="summary-card">
        <div>
          <strong>{{ task.fileName }}</strong>
          <span>{{ formatImportSummary(task) }}</span>
          <span>{{ formatImportProgress(cases) }}</span>
          <span v-if="reviewing">{{ formatExploreWait(waitMs) }}</span>
        </div>
        <span class="time">创建于 {{ formatDateTime(task.createdAt) }}</span>
      </section>

      <section class="list-block">
        <h3>用例审阅</h3>
        <div class="table-wrap">
          <el-table
            :data="cases"
            border
            stripe
            height="100%"
            row-key="id"
            empty-text="没有解析到用例"
            @expand-change="onCaseExpand"
          >
            <el-table-column type="expand">
              <template #default="{ row: importCase }">
                <div class="expand">
                  <p><strong>起始路径：</strong>{{ importCase.startPath || "—" }}</p>
                  <p><strong>前置条件：</strong>{{ importCase.preconditions || "—" }}</p>
                  <p><strong>预期结果：</strong>{{ importCase.expected || "—" }}</p>
                  <p>
                    <strong>来源：</strong>
                    {{ formatSourceRef(importCase.source) }}
                    <span v-if="formatSourceCells(importCase.source)">；{{ formatSourceCells(importCase.source) }}</span>
                  </p>
                  <p v-if="importCase.status === 'failed' && importCase.failure"><strong>失败原因：</strong>{{ formatImportFailure(importCase.failure) }}</p>
                  <p v-if="importCase.errors.length"><strong>错误：</strong></p>
                  <ul v-if="importCase.errors.length" class="error-list">
                    <li v-for="(error, index) in importCase.errors" :key="`${error.sheet}-${error.row}-${index}`">
                      {{ formatParseError(error) }}
                    </li>
                  </ul>
                  <template v-if="importCase.intent">
                    <p><strong>测试意图</strong></p>
                    <ul v-if="importCase.intent.pendingItems.length" class="pending-list">
                      <li v-for="pending in importCase.intent.pendingItems" :key="pending.id">{{ pending.message }}</li>
                    </ul>
                    <el-table :data="importCase.intent.steps" border size="small" class="step-table">
                      <el-table-column type="index" label="序号" width="70" />
                      <el-table-column prop="action" label="动作类型" width="120" />
                      <el-table-column prop="target" label="目标" min-width="160" />
                      <el-table-column prop="data" label="数据" min-width="140" />
                      <el-table-column label="来源" min-width="220">
                        <template #default="{ row: step }">
                          <div v-for="(source, index) in step.sourceRefs" :key="`${source.sheet}-${source.row}-${index}`">
                            {{ formatSourceRef(source) }}
                          </div>
                        </template>
                      </el-table-column>
                      <el-table-column label="原始单元格" min-width="240">
                        <template #default="{ row: step }">
                          <div v-for="(source, index) in step.sourceRefs" :key="`${source.sheet}-${source.row}-cells-${index}`">
                            {{ formatSourceCells(source) || "—" }}
                          </div>
                        </template>
                      </el-table-column>
                    </el-table>
                    <div class="publish-steps">
                      <h4>{{ publishStepsTitle }}</h4>
                      <p class="publish-steps-hint">{{ publishStepsHint }}</p>
                      <el-alert
                        v-if="actionIrOf(importCase) && !actionIrOf(importCase)?.ok"
                        type="warning"
                        :closable="false"
                        show-icon
                        :title="actionIrOf(importCase)?.issues[0]?.message || '当前还不能发布，请先改选择器或填写值'"
                      />
                      <el-table
                        v-loading="actionIrLoadingId === importCase.id"
                        :data="actionIrOf(importCase)?.steps ?? []"
                        border
                        size="small"
                        class="step-table"
                        :empty-text="publishStepsEmpty"
                      >
                        <el-table-column type="index" label="序号" width="70" />
                        <el-table-column label="动作" width="120">
                          <template #default="{ row: step }">
                            {{ formatStepType(step.type) }}
                          </template>
                        </el-table-column>
                        <el-table-column label="选择器" min-width="320">
                          <template #default="{ row: step }">
                            <div v-if="hasStepSelector(step.type)" class="locator-cell">
                              <div class="locator-summary">
                                <strong>{{ formatLocatorSummary(step.selector) }}</strong>
                                <span>{{ step.selector || "未设置选择器" }}</span>
                              </div>
                              <el-button
                                v-if="canEditImportActionIr(importCase.status)"
                                size="small"
                                @click.stop="openActionIrLocator(importCase, step)"
                              >
                                编辑定位
                              </el-button>
                            </div>
                            <span v-else>—</span>
                          </template>
                        </el-table-column>
                        <el-table-column label="输入值/断言值" min-width="180">
                          <template #default="{ row: step }">
                            <el-input
                              v-if="canEditImportActionIr(importCase.status) && hasStepValue(step.type)"
                              v-model="step.value"
                              size="small"
                              placeholder="输入值或断言内容"
                              @change="(value) => commitPublishValue(importCase, step, String(value))"
                            />
                            <span v-else>{{ step.value || "—" }}</span>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                  </template>
                  <el-table v-else-if="importCase.steps.length" :data="importCase.steps" border size="small" class="step-table">
                    <el-table-column prop="order" label="步骤序号" width="90" />
                    <el-table-column prop="action" label="动作类型" width="120" />
                    <el-table-column prop="target" label="目标" min-width="160" />
                    <el-table-column prop="data" label="数据" min-width="140" />
                    <el-table-column label="来源行" width="180">
                      <template #default="{ row: step }">
                        {{ formatSourceRef(step.source) }}
                      </template>
                    </el-table-column>
                  </el-table>
                  <div class="actions">
                    <el-button
                      v-if="canConfirmImportCase(importCase)"
                      type="primary"
                      size="small"
                      :loading="actingId === importCase.id || isExploreRunning(importCase.status)"
                      @click="submitConfirm(importCase)"
                    >
                      确认
                    </el-button>
                    <el-button
                      v-if="canRetryImportCase(importCase.status)"
                      size="small"
                      :loading="actingId === importCase.id || isExploreRunning(importCase.status)"
                      @click="submitRetry(importCase)"
                    >
                      重试
                    </el-button>
                    <el-button
                      v-if="canUnconfirmImportCase(importCase.status)"
                      size="small"
                      :loading="actingId === importCase.id || isExploreRunning(importCase.status)"
                      @click="submitUnconfirm(importCase)"
                    >
                      取消确认
                    </el-button>
                    <el-button
                      v-if="canPublishImportCase(importCase.status)"
                      type="success"
                      size="small"
                      :loading="actingId === importCase.id || isExploreRunning(importCase.status)"
                      @click="submitPublish(importCase)"
                    >
                      发布
                    </el-button>
                    <el-button
                      v-if="importCase.publishedCaseKey"
                      size="small"
                      @click="router.push(`/projects/${projectKey}/cases/${importCase.publishedCaseKey}`)"
                    >
                      查看用例
                    </el-button>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="caseNumber" label="用例编号" min-width="140" />
            <el-table-column prop="name" label="用例名称" min-width="200" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="caseStatus(row).type" effect="light">
                  {{ caseStatus(row).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源" min-width="200">
              <template #default="{ row }">
                {{ formatSourceRef(row.source) }}
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="240">
              <template #default="{ row }">
                <span v-if="actingId === row.id || isExploreRunning(row.status)">{{ formatExploreWait(waitMs) }}</span>
                <span v-else-if="row.status === 'failed' && row.failure" class="failure-note">{{ formatImportFailure(row.failure) }}</span>
                <span v-else-if="row.intent?.pendingItems.length">{{ row.intent.pendingItems[0]?.message }}</span>
                <span v-else-if="row.errors.length">{{ formatParseError(row.errors[0]) }}</span>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="280">
              <template #default="{ row }">
                <el-button
                  v-if="canConfirmImportCase(row)"
                  type="primary"
                  size="small"
                  :loading="actingId === row.id"
                  @click="submitConfirm(row)"
                >
                  确认
                </el-button>
                <el-button
                  v-if="canRetryImportCase(row.status)"
                  size="small"
                  :loading="actingId === row.id"
                  @click="submitRetry(row)"
                >
                  重试
                </el-button>
                <el-button
                  v-if="canUnconfirmImportCase(row.status)"
                  size="small"
                  :loading="actingId === row.id"
                  @click="submitUnconfirm(row)"
                >
                  取消确认
                </el-button>
                <el-button
                  v-if="canPublishImportCase(row.status)"
                  type="success"
                  size="small"
                  :loading="actingId === row.id"
                  @click="submitPublish(row)"
                >
                  发布
                </el-button>
                <el-button
                  v-if="row.publishedCaseKey"
                  size="small"
                  @click="router.push(`/projects/${projectKey}/cases/${row.publishedCaseKey}`)"
                >
                  查看
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <LocatorBuilderDrawer
      v-model="locatorOpen"
      :selector="locatorSelector"
      :draft="locatorDraft"
      :hint="locatorEditHint"
      @apply="applyActionIrLocator"
    />
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 22px 28px 18px;
  box-sizing: border-box;
  overflow: hidden;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  align-items: flex-end;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.summary-card {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  background: #ffffff;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  padding: 12px 16px;
}

.summary-card div {
  display: grid;
  gap: 4px;
}

.time,
.summary-card span {
  color: #64748b;
  font-size: 13px;
}

.list-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.list-block h3 {
  margin: 0 0 8px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.expand {
  padding: 8px 16px 16px 48px;
}

.expand p {
  margin: 0 0 8px;
}

.error-list,
.pending-list {
  color: #b91c1c;
  margin: 0 0 12px;
  padding-left: 18px;
}

.pending-list {
  color: #b45309;
}

.failure-note {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.step-table,
.actions {
  margin-top: 8px;
}

.publish-steps {
  margin-top: 16px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
}

.publish-steps h4 {
  margin: 0 0 6px;
  font-size: 14px;
}

.publish-steps-hint {
  margin: 0 0 10px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
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
</style>
