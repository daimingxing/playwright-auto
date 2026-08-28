<script setup lang="ts">
import { Back, Delete } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ImportTaskCase } from "../../../../shared/types";
import { deleteImportTask } from "../../api/imports";
import { getErrorMessage } from "../../utils/error";
import { formatDateTime } from "../../utils/time";
import { useImportTaskReview } from "./ai-import-composables";
import {
  canConfirmImportCase,
  canPublishImportCase,
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
  isExploreRunning
} from "./ai-import";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const taskId = String(route.params.taskId);
const { task, cases, reviewing, actingId, waitMs, loadTask, confirmCase, retryCase, publishCase, unconfirmCase } = useImportTaskReview(
  projectKey,
  taskId
);

/**
 * 读取单条用例的状态标签。
 */
function caseStatus(item: ImportTaskCase) {
  return formatImportCaseStatus(item.status);
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
      <el-button v-if="task" type="danger" plain :icon="Delete" @click="removeTask">删除任务</el-button>
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
          <el-table :data="cases" border stripe height="100%" row-key="id" empty-text="没有解析到用例">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="expand">
                  <p><strong>起始路径：</strong>{{ row.startPath || "—" }}</p>
                  <p><strong>前置条件：</strong>{{ row.preconditions || "—" }}</p>
                  <p><strong>预期结果：</strong>{{ row.expected || "—" }}</p>
                  <p>
                    <strong>来源：</strong>
                    {{ formatSourceRef(row.source) }}
                    <span v-if="formatSourceCells(row.source)">；{{ formatSourceCells(row.source) }}</span>
                  </p>
                  <p v-if="row.status === 'failed' && row.failure"><strong>失败原因：</strong>{{ formatImportFailure(row.failure) }}</p>
                  <p v-if="row.errors.length"><strong>错误：</strong></p>
                  <ul v-if="row.errors.length" class="error-list">
                    <li v-for="(error, index) in row.errors" :key="`${error.sheet}-${error.row}-${index}`">
                      {{ formatParseError(error) }}
                    </li>
                  </ul>
                  <template v-if="row.intent">
                    <p><strong>测试意图</strong></p>
                    <ul v-if="row.intent.pendingItems.length" class="pending-list">
                      <li v-for="item in row.intent.pendingItems" :key="item.id">{{ item.message }}</li>
                    </ul>
                    <el-table :data="row.intent.steps" border size="small" class="step-table">
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
                  </template>
                  <el-table v-else-if="row.steps.length" :data="row.steps" border size="small" class="step-table">
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
                      v-if="canConfirmImportCase(row)"
                      type="primary"
                      size="small"
                      :loading="actingId === row.id || isExploreRunning(row.status)"
                      @click="submitConfirm(row)"
                    >
                      确认
                    </el-button>
                    <el-button
                      v-if="canRetryImportCase(row.status)"
                      size="small"
                      :loading="actingId === row.id || isExploreRunning(row.status)"
                      @click="submitRetry(row)"
                    >
                      重试
                    </el-button>
                    <el-button
                      v-if="canUnconfirmImportCase(row.status)"
                      size="small"
                      :loading="actingId === row.id || isExploreRunning(row.status)"
                      @click="submitUnconfirm(row)"
                    >
                      取消确认
                    </el-button>
                    <el-button
                      v-if="canPublishImportCase(row.status)"
                      type="success"
                      size="small"
                      :loading="actingId === row.id || isExploreRunning(row.status)"
                      @click="submitPublish(row)"
                    >
                      发布
                    </el-button>
                    <el-button
                      v-if="row.publishedCaseKey"
                      size="small"
                      @click="router.push(`/projects/${projectKey}/cases/${row.publishedCaseKey}`)"
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
</style>
