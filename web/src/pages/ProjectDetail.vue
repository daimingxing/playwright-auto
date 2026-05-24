<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Back,
  CopyDocument,
  Delete,
  Download,
  EditPen,
} from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CaseMeta, CaseStatus } from "../../../shared/types";
import {
  batchUpdateCaseStatus,
  copyCase,
  createCase,
  deleteCase,
  exportCase,
  listCases,
  listTrash,
  removeTrashCase,
  restoreCase,
  updateCaseStatus,
} from "../api/cases";
import { useProjectUiStore, type CaseStatusFilter } from "../state/project-ui";
import { getErrorIssues, getErrorMessage } from "../utils/error";
import {
  formatCaseCreatedTime,
  formatCaseStatus,
  formatCheckStatus,
} from "./case-editor";
import { formatPracticalReviewTime } from "./run-center";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const projectUi = useProjectUiStore();
const dialogOpen = ref(false);
const cases = ref<CaseMeta[]>([]);
const trash = ref<CaseMeta[]>([]);
const selectedKeys = ref<string[]>([]);
const statusFilter = ref<CaseStatusFilter>(projectUi.getCaseStatusFilter(projectKey));
const form = reactive({
  name: "",
  startPath: "/",
});
const statusOptions: Array<{ label: string; value: CaseStatusFilter }> = [
  { label: "全部", value: "all" },
  { label: "草稿", value: "draft" },
  { label: "待启用", value: "ready" },
  { label: "启用", value: "active" },
];

const filteredCases = computed(() =>
  statusFilter.value === "all" ? cases.value : cases.value.filter((item) => item.status === statusFilter.value),
);

/**
 * 加载项目用例和回收站。
 */
async function loadData() {
  const [caseList, trashList] = await Promise.all([
    listCases(projectKey),
    listTrash(projectKey),
  ]);
  cases.value = caseList;
  trash.value = trashList;
  selectedKeys.value = selectedKeys.value.filter((key) => caseList.some((item) => item.key === key));
}

/**
 * 切换用例状态筛选。
 */
function changeStatusFilter(value: CaseStatusFilter) {
  projectUi.setCaseStatusFilter(projectKey, value);
}

/**
 * 同步表格多选用例。
 */
function updateSelection(rows: CaseMeta[]) {
  selectedKeys.value = rows.map((row) => row.key);
}

/**
 * 切换单条用例状态。
 */
async function changeCaseStatus(row: CaseMeta, status: CaseStatus) {
  const previous = row.status;

  try {
    row.status = status;
    const next = await updateCaseStatus(projectKey, row.key, status);
    Object.assign(row, next);
    ElMessage.success("用例状态已更新");
  } catch (error) {
    row.status = previous;
    showError(error);
  }
}

/**
 * 批量切换用例状态。
 */
async function changeBatchStatus(status: CaseStatus) {
  if (selectedKeys.value.length === 0) {
    ElMessage.warning("请先选择测试用例");
    return;
  }

  try {
    const result = await batchUpdateCaseStatus(projectKey, {
      caseKeys: selectedKeys.value,
      status,
    });
    await loadData();

    if (result.failed.length > 0) {
      ElMessage.warning(`已更新 ${result.updated.length} 条，${result.failed.length} 条未更新：${formatBatchFailure(result.failed[0])}`);
      return;
    }

    ElMessage.success(`已更新 ${result.updated.length} 条用例`);
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

/**
 * 格式化批量状态切换失败原因。
 */
function formatBatchFailure(failure: { message: string; issues?: unknown[] }) {
  const issue = readBatchIssue(failure.issues);

  if (!issue) {
    return failure.message;
  }

  return `${failure.message}：${issue}`;
}

/**
 * 读取批量失败中的第一条基础检查问题。
 */
function readBatchIssue(issues: unknown[] | undefined) {
  const issue = issues?.[0];

  if (typeof issue !== "object" || issue === null) {
    return "";
  }

  const stepIndex = "stepIndex" in issue && typeof issue.stepIndex === "number" && issue.stepIndex >= 0
    ? `第 ${issue.stepIndex + 1} 步：`
    : "";
  const message = "message" in issue && typeof issue.message === "string" ? issue.message : "";
  const suggestion = "suggestion" in issue && typeof issue.suggestion === "string" ? issue.suggestion : "";

  return `${stepIndex}${message}${suggestion}`;
}

/**
 * 创建新用例。
 */
async function submitCase() {
  const item = await createCase(projectKey, { ...form });
  dialogOpen.value = false;
  await loadData();
  await router.push(`/projects/${projectKey}/cases/${item.key}`);
}

/**
 * 删除用例到回收站。
 */
async function removeCase(item: CaseMeta) {
  try {
    await deleteCase(projectKey, item.key);
    await loadData();
    ElMessage.success("已移入回收站");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 导出单条测试用例。
 */
async function exportItem(item: CaseMeta) {
  try {
    await exportCase(projectKey, item.key);
    ElMessage.success("已开始下载测试用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 复制单条测试用例。
 */
async function copyItem(item: CaseMeta) {
  try {
    await copyCase(projectKey, item.key);
    await loadData();
    ElMessage.success("已复制用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 恢复回收站中的用例。
 */
async function restoreItem(item: CaseMeta) {
  try {
    await restoreCase(projectKey, item.key);
    await loadData();
    ElMessage.success("已恢复用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 彻底删除回收站中的用例。
 */
async function removeTrashItem(item: CaseMeta) {
  const confirmed = await ElMessageBox.confirm(
    `确认彻底删除「${item.name}」吗？删除后不可恢复。`,
    "彻底删除用例",
    {
      confirmButtonText: "彻底删除",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await removeTrashCase(projectKey, item.key);
    await loadData();
    ElMessage.success("已彻底删除用例");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(loadData);
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push('/')"
          >返回项目列表</el-button
        >
        <h2>{{ projectKey }} 用例管理</h2>
      </div>
      <div class="actions btn-shadow-md">
        <el-button type="primary" size="large" @click="dialogOpen = true"
          >新建用例</el-button
        >
        <el-button
          type="success"
          size="large"
          @click="router.push(`/projects/${projectKey}/runs`)"
          >运行测试</el-button
        >
      </div>
    </div>

    <div class="content">
      <section class="list-block">
        <h3>用例列表</h3>
        <div class="table-wrap">
          <!-- 主表保留更大的最小宽度，确保在窄窗口下真实产生横向溢出。 -->
          <div class="case-tools">
            <el-radio-group v-model="statusFilter" @change="(value) => changeStatusFilter(value as CaseStatusFilter)">
              <el-radio-button v-for="option in statusOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </el-radio-button>
            </el-radio-group>
            <div class="batch-actions btn-shadow-sm">
              <el-button size="small" :disabled="selectedKeys.length === 0" @click="changeBatchStatus('draft')">设为草稿</el-button>
              <el-button size="small" :disabled="selectedKeys.length === 0" @click="changeBatchStatus('ready')">设为待启用</el-button>
              <el-button size="small" type="success" :disabled="selectedKeys.length === 0" @click="changeBatchStatus('active')">设为启用</el-button>
            </div>
          </div>
          <el-table class="case-table" :data="filteredCases" border stripe height="100%" row-key="key" @selection-change="updateSelection">
            <el-table-column type="selection" width="44" reserve-selection />
            <el-table-column prop="name" label="用例名称" min-width="220">
              <template #default="{ row }">
                <span
                  class="case-name-link"
                  title="双击编辑用例"
                  @dblclick="
                    router.push(`/projects/${projectKey}/cases/${row.key}`)
                  "
                >
                  {{ row.name }}
                </span>
              </template>
            </el-table-column>
            <el-table-column
              prop="startPath"
              label="起始路径"
              min-width="220"
            />
            <el-table-column label="用例状态" width="140">
              <template #default="{ row }">
                <el-select
                  :model-value="row.status"
                  class="status-select"
                  size="small"
                  @change="(value) => changeCaseStatus(row, value as CaseStatus)"
                >
                  <el-option label="草稿" value="draft" />
                  <el-option label="待启用" value="ready" />
                  <el-option label="启用" value="active" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="检查状态" width="130">
              <template #default="{ row }">
                <el-tag
                  :type="formatCheckStatus(row).type"
                  effect="light"
                >
                  {{ formatCheckStatus(row).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              label="创建时间"
              min-width="130"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                {{ formatCaseCreatedTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column
              label="最后实测时间"
              min-width="130"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                {{ formatPracticalReviewTime(row.practicalReview) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220">
              <template #default="{ row }">
                <div class="row-actions btn-shadow-sm">
                  <el-button
                    class="icon-btn edit-btn"
                    size="small"
                    :icon="EditPen"
                    title="编辑用例"
                    aria-label="编辑用例"
                    @click="
                      router.push(`/projects/${projectKey}/cases/${row.key}`)
                    "
                  />
                  <el-button
                    class="icon-btn copy-btn"
                    size="small"
                    :icon="CopyDocument"
                    title="复制用例"
                    aria-label="复制用例"
                    @click="copyItem(row)"
                  />
                  <el-button
                    class="icon-btn export-btn"
                    size="small"
                    :icon="Download"
                    title="导出用例"
                    aria-label="导出用例"
                    @click="exportItem(row)"
                  />
                  <el-button
                    class="icon-btn delete-btn"
                    size="small"
                    type="danger"
                    :icon="Delete"
                    title="删除用例"
                    aria-label="删除用例"
                    @click="removeCase(row)"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="trash list-block">
        <h3>回收站</h3>
        <div class="table-wrap">
          <!-- 回收站表同样要保留足够的最小宽度，避免被容器压扁后失去横向滚动。 -->
          <el-table
            class="trash-table btn-shadow-sm"
            :data="trash"
            border
            stripe
            height="100%"
            empty-text="回收站暂无用例"
          >
            <el-table-column prop="name" label="用例名称" min-width="260" />
            <el-table-column prop="key" label="目录编号" min-width="160" />
            <el-table-column
              label="创建时间"
              min-width="170"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                {{ formatCaseCreatedTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260">
              <template #default="{ row }">
                <div class="trash-actions btn-shadow-sm">
                  <el-button size="small" @click="restoreItem(row)"
                    >恢复</el-button
                  >
                  <el-button
                    class="hard-delete-btn"
                    size="small"
                    type="danger"
                    @click="removeTrashItem(row)"
                    >彻底删除</el-button
                  >
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <el-dialog v-model="dialogOpen" title="新建测试用例" width="520px">
      <el-form label-width="90px">
        <el-form-item label="用例名称">
          <el-input v-model="form.name" placeholder="例如：创建订单" />
        </el-form-item>
        <el-form-item label="起始路径">
          <el-input v-model="form.startPath" placeholder="/orders/create" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="submitCase">保存</el-button>
      </template>
    </el-dialog>
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

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px;
}

.back-btn:hover,
.back-btn:focus {
  color: #24466b;
  background-color: #eef5fb;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
}

.list-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.list-block h3 {
  flex: 0 0 auto;
  margin: 0 0 12px;
}

.case-tools {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.batch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.batch-actions :deep(.el-button) {
  margin-left: 0;
}

.status-select {
  width: 112px;
}

.table-wrap {
  flex: 1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.row-actions {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.row-actions :deep(.el-button) {
  margin-left: 0;
}

.row-actions :deep(.icon-btn) {
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 7px;
}

.row-actions :deep(.icon-btn:not(.is-disabled):hover),
.row-actions :deep(.icon-btn:not(.is-disabled):focus-visible) {
  transform: none;
}

.row-actions :deep(.icon-btn .el-icon) {
  font-size: 16px;
}

.row-actions :deep(.edit-btn) {
  color: #ffffff;
  border: 1px solid #409eff;
  background: #409eff;
}

.row-actions :deep(.edit-btn:hover),
.row-actions :deep(.edit-btn:focus-visible) {
  color: #ffffff;
  border-color: #66b1ff;
  background: #66b1ff;
}

.row-actions :deep(.copy-btn) {
  color: #6b7a90;
  border: 1px solid #c9d2dc;
  background: #f7f9fc;
}

.row-actions :deep(.copy-btn:hover),
.row-actions :deep(.copy-btn:focus-visible) {
  color: #5c6a80;
  border-color: #b8c4d1;
  background: #eef3f8;
}

.row-actions :deep(.export-btn) {
  color: #475569;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
}

.row-actions :deep(.export-btn:hover),
.row-actions :deep(.export-btn:focus-visible) {
  color: #1f4f7a;
  border-color: #93c5fd;
  background: #eff6ff;
}

.row-actions :deep(.delete-btn) {
  margin-left: auto;
  color: #ffffff;
  box-shadow: 0 1px 6px rgba(220, 38, 38, 0.22);
}

.row-actions :deep(.delete-btn:hover),
.row-actions :deep(.delete-btn:focus-visible) {
  box-shadow: 0 3px 10px rgba(220, 38, 38, 0.28);
}

.case-name-link {
  cursor: pointer;
}

.case-name-link:hover {
  color: #315f8f;
}

.trash-actions {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.trash-actions :deep(.el-button) {
  margin-left: 0;
}

.trash-actions :deep(.hard-delete-btn) {
  margin-left: auto;
}

.case-table {
  min-width: 1400px;
}

.trash-table {
  min-width: 980px;
}

</style>
