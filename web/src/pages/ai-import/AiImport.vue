<script setup lang="ts">
import { Back, Delete, Upload } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ImportParseError, ImportTask } from "../../../../shared/types";
import { createImportTask, deleteImportTask, listImportTasks } from "../../api/imports";
import { getErrorMessage } from "../../utils/error";
import { formatDateTime } from "../../utils/time";
import { formatImportSummary, formatParseError, getDeleteImportTaskConfirm, getImportErrors } from "./ai-import";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const tasks = ref<ImportTask[]>([]);
const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const structureErrors = ref<ImportParseError[]>([]);

/**
 * 加载项目下已创建的导入任务。
 */
async function loadTasks() {
  tasks.value = await listImportTasks(projectKey);
}

/**
 * 记录用户选择的 Excel 文件。
 */
function changeFile(file: { raw?: File } | undefined) {
  selectedFile.value = file?.raw ?? null;
  structureErrors.value = [];
}

/**
 * 上传双表 Excel 并创建导入任务，成功后进入解析结果页。
 */
async function submitImport() {
  if (!selectedFile.value) {
    ElMessage.warning("请先选择 Excel 文件");
    return;
  }

  uploading.value = true;
  structureErrors.value = [];

  try {
    const task = await createImportTask(projectKey, selectedFile.value);
    ElMessage.success("已创建导入任务");
    await router.push(`/projects/${projectKey}/imports/${task.id}`);
  } catch (error) {
    structureErrors.value = getImportErrors(error);
    ElMessage.error(getErrorMessage(error));
  } finally {
    uploading.value = false;
  }
}

/**
 * 确认后删除整次导入任务，不影响已发布正式用例。
 */
async function removeTask(task: ImportTask) {
  const confirmed = await ElMessageBox.confirm(getDeleteImportTaskConfirm(task.fileName), "删除导入任务", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning"
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deleteImportTask(projectKey, task.id);
    await loadTasks();
    ElMessage.success("已删除导入任务");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(async () => {
  try {
    await loadTasks();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}`)">
          返回用例管理
        </el-button>
        <h2>AI 导入</h2>
      </div>
    </div>

    <div class="content">
      <section class="upload-card">
        <h3>上传 Excel</h3>
        <p class="hint">
          请上传包含「用例」和「步骤」两张工作表的 .xlsx 文件。结构错误会阻断整批导入；单个用例内容错误不影响其他有效用例。打开任务详情后可以审阅测试意图；确认不会发布正式用例。
        </p>
        <div class="upload-row">
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".xlsx"
            :on-change="changeFile"
            :on-remove="() => changeFile(undefined)"
          >
            <el-button :icon="Upload">选择文件</el-button>
          </el-upload>
          <el-button type="primary" :loading="uploading" @click="submitImport">上传并创建任务</el-button>
        </div>
        <ul v-if="structureErrors.length > 0" class="error-list">
          <li v-for="(error, index) in structureErrors" :key="`${error.sheet}-${error.row}-${index}`">
            {{ formatParseError(error) }}
          </li>
        </ul>
      </section>

      <section class="list-block">
        <h3>导入任务</h3>
        <div class="table-wrap">
          <el-table :data="tasks" border stripe height="100%" empty-text="暂无导入任务">
            <el-table-column prop="fileName" label="文件名" min-width="220" />
            <el-table-column label="解析结果" min-width="220">
              <template #default="{ row }">
                {{ formatImportSummary(row) }}
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="170">
              <template #default="{ row }">
                {{ formatDateTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220">
              <template #default="{ row }">
                <el-button size="small" @click="router.push(`/projects/${projectKey}/imports/${row.id}`)">
                  查看详情
                </el-button>
                <el-button size="small" type="danger" plain :icon="Delete" @click="removeTask(row)">
                  删除
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
  margin-bottom: 14px;
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
  gap: 16px;
  overflow: hidden;
}

.upload-card,
.list-block {
  background: #ffffff;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  padding: 14px 16px;
  min-width: 0;
}

.list-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list-block h3,
.upload-card h3 {
  margin: 0 0 8px;
}

.hint {
  color: #64748b;
  font-size: 13px;
  margin: 0 0 12px;
}

.upload-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.error-list {
  color: #b91c1c;
  font-size: 13px;
  margin: 12px 0 0;
  padding-left: 18px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
