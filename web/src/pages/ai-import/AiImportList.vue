<script setup lang="ts">
import { Back, Delete, RefreshRight, UploadFilled, View } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PageMap, PageMapSummary, ImportJob } from '../../../../shared/types';
import { createAiImport, deleteImport, listImports } from '../../api/imports';
import { deletePageMap, getPageMap, listPageMaps, refreshPageMap } from '../../api/page-maps';
import { getErrorMessage } from '../../utils/error';
import {
  formatImportStatus,
  formatImportTime,
  formatPageMapAge,
  formatPageMapCount,
  formatPageMapStatus,
  getImportProgress,
  getPendingCount
} from './ai-import';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const loading = ref(false);
const uploading = ref(false);
const jobs = ref<ImportJob[]>([]);
const maps = ref<PageMapSummary[]>([]);
const mapDetail = ref<PageMap | null>(null);
const mapOpen = ref(false);
const file = ref<File | null>(null);
let timer: ReturnType<typeof window.setInterval> | undefined;

const hasRunning = computed(() => jobs.value.some((job) => job.status === 'running'));

/**
 * 加载 AI 导入任务列表。
 */
async function loadJobs() {
  loading.value = true;

  try {
    jobs.value = await listImports(projectKey);
    syncPolling();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

/**
 * 加载页面地图列表。
 */
async function loadMaps() {
  try {
    maps.value = await listPageMaps(projectKey);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 同时刷新导入任务和页面地图。
 */
async function loadAll() {
  loading.value = true;

  try {
    const [nextJobs, nextMaps] = await Promise.all([listImports(projectKey), listPageMaps(projectKey)]);
    jobs.value = nextJobs;
    maps.value = nextMaps;
    syncPolling();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

/**
 * 记录当前选择的 Excel 文件。
 */
function changeFile(uploadFile: UploadFile) {
  file.value = uploadFile.raw ?? null;
}

/**
 * 清空当前选择的 Excel 文件。
 */
function removeFile() {
  file.value = null;
}

/**
 * 上传 Excel 并打开导入预览页。
 */
async function uploadFile() {
  if (!file.value) {
    ElMessage.warning('请先选择 Excel 模板文件');
    return;
  }

  uploading.value = true;

  try {
    const job = await createAiImport(projectKey, file.value);
    ElMessage.success(job.reused ? '检测到已有导入任务，已打开原任务' : '导入任务已创建');
    await router.push(`/projects/${projectKey}/imports/${job.importId}`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    uploading.value = false;
  }
}

/**
 * 根据任务状态开启或停止列表轮询。
 */
function syncPolling() {
  if (hasRunning.value && !timer) {
    timer = window.setInterval(() => {
      void loadJobs();
    }, 2000);
    return;
  }

  if (!hasRunning.value && timer) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

/**
 * 返回导入任务预览页。
 */
function openJob(job: ImportJob) {
  void router.push(`/projects/${projectKey}/imports/${job.importId}`);
}

/**
 * 放弃单个导入任务。
 */
async function removeJob(job: ImportJob) {
  const confirmed = await ElMessageBox.confirm(
    `确认放弃导入记录「${job.fileName}」吗？已保存的草稿用例不会被删除。`,
    '放弃导入',
    {
      confirmButtonText: '放弃导入',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deleteImport(projectKey, job.importId);
    await loadJobs();
    ElMessage.success('已放弃导入记录');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 打开页面地图详情。
 */
async function openMap(map: PageMapSummary) {
  try {
    mapDetail.value = await getPageMap(projectKey, map.mapId);
    mapOpen.value = true;
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 重新采集页面地图。
 */
async function refreshMap(map: PageMapSummary) {
  try {
    await refreshPageMap(projectKey, map.mapId);
    await loadMaps();
    ElMessage.success('页面地图已刷新');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 删除页面地图缓存。
 */
async function removeMap(map: PageMapSummary) {
  const confirmed = await ElMessageBox.confirm('确认删除该页面地图缓存吗？已生成的导入草稿不会被删除。', '删除页面地图', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deletePageMap(projectKey, map.mapId);
    await loadMaps();
    ElMessage.success('页面地图已删除');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(loadAll);
onBeforeUnmount(() => {
  if (timer) {
    window.clearInterval(timer);
  }
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>AI 导入</h2>
      </div>
      <div class="toolbar-actions btn-shadow-md">
        <el-button :icon="RefreshRight" :loading="loading" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="content">
      <el-card class="upload-card" shadow="never">
        <template #header>
          <span>上传模板</span>
        </template>
        <div class="upload-row">
          <el-upload
            class="upload-box"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xlsx"
            :on-change="changeFile"
            :on-remove="removeFile"
          >
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <div class="upload-text">拖入或选择 Excel 模板文件</div>
          </el-upload>
          <div class="upload-actions btn-shadow-md">
            <el-button type="primary" size="large" :loading="uploading" @click="uploadFile">创建导入任务</el-button>
          </div>
        </div>
      </el-card>

      <el-card class="list-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>导入记录</span>
            <span class="hint">刷新后可继续进入历史任务</span>
          </div>
        </template>
        <div class="table-wrap">
          <el-table :data="jobs" border stripe height="100%" empty-text="暂无导入记录">
            <el-table-column prop="fileName" label="文件名" min-width="220" show-overflow-tooltip />
            <el-table-column label="进度" min-width="180">
              <template #default="{ row }">
                <el-progress :percentage="getImportProgress(row)" :stroke-width="8" />
              </template>
            </el-table-column>
            <el-table-column prop="totalCount" label="总数" width="90" />
            <el-table-column prop="savedCount" label="已保存" width="100" />
            <el-table-column label="待确认" width="100">
              <template #default="{ row }">
                {{ getPendingCount(row) }}
              </template>
            </el-table-column>
            <el-table-column prop="failedCount" label="失败" width="90" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag>{{ formatImportStatus(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" min-width="170">
              <template #default="{ row }">
                {{ formatImportTime(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="210">
              <template #default="{ row }">
                <div class="row-actions btn-shadow-sm">
                  <el-button type="primary" size="small" @click="openJob(row)">继续处理</el-button>
                  <el-button size="small" type="danger" plain @click="removeJob(row)">放弃</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <el-card class="map-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>页面地图</span>
            <span class="hint">刷新只更新缓存，不覆盖已有草稿</span>
          </div>
        </template>
        <div class="table-wrap">
          <el-table :data="maps" border stripe height="100%" empty-text="暂无页面地图">
            <el-table-column prop="targetUrl" label="目标页面" min-width="220" show-overflow-tooltip />
            <el-table-column prop="envKey" label="环境" width="120" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="formatPageMapStatus(row.status).type" effect="light">
                  {{ formatPageMapStatus(row.status).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态数量" width="110">
              <template #default="{ row }">
                {{ formatPageMapCount(row.stateCount) }}
              </template>
            </el-table-column>
            <el-table-column label="缓存年龄" width="120">
              <template #default="{ row }">
                {{ formatPageMapAge(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="更新时间" min-width="170">
              <template #default="{ row }">
                {{ formatImportTime(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180">
              <template #default="{ row }">
                <div class="row-actions btn-shadow-sm">
                  <el-button :icon="View" size="small" circle title="查看" @click="openMap(row)" />
                  <el-button :icon="RefreshRight" size="small" circle title="刷新" @click="refreshMap(row)" />
                  <el-button :icon="Delete" size="small" type="danger" plain circle title="删除" @click="removeMap(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
    </div>

    <el-drawer v-model="mapOpen" size="560px" title="页面地图详情">
      <div v-if="mapDetail" class="map-detail">
        <dl class="info-grid">
          <dt>目标页面</dt>
          <dd>{{ mapDetail.targetUrl }}</dd>
          <dt>环境</dt>
          <dd>{{ mapDetail.envKey }}</dd>
          <dt>状态</dt>
          <dd>{{ formatPageMapStatus(mapDetail.status).label }}</dd>
          <dt>状态数量</dt>
          <dd>{{ formatPageMapCount(mapDetail.states.length) }}</dd>
          <dt>更新时间</dt>
          <dd>{{ formatImportTime(mapDetail.updatedAt) }}</dd>
        </dl>
        <el-table :data="mapDetail.states" border stripe empty-text="暂无状态">
          <el-table-column prop="name" label="状态名称" min-width="140" />
          <el-table-column prop="url" label="页面地址" min-width="220" show-overflow-tooltip />
          <el-table-column prop="title" label="标题" min-width="140" show-overflow-tooltip />
        </el-table>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 28px;
}

.toolbar {
  align-items: flex-end;
  display: flex;
  flex: 0 0 auto;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 20px;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px;
}

.back-btn:hover,
.back-btn:focus {
  background-color: #eef5fb;
  color: #24466b;
}

.content {
  display: grid;
  flex: 1;
  gap: 20px;
  grid-template-rows: auto minmax(0, 1fr) minmax(220px, 0.6fr);
  min-height: 0;
  overflow: hidden;
}

.upload-card,
.list-card,
.map-card {
  min-height: 0;
}

.list-card :deep(.el-card__body),
.map-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  height: calc(100% - 57px);
  min-height: 0;
}

.upload-row {
  align-items: center;
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(320px, 520px) 1fr;
}

.upload-box {
  max-width: 520px;
}

.upload-icon {
  color: #409eff;
  font-size: 38px;
}

.upload-text {
  color: #475569;
  line-height: 1.5;
}

.upload-actions {
  align-items: center;
  display: flex;
}

.card-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.hint {
  color: #64748b;
  font-size: 13px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.row-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}

.row-actions :deep(.el-button) {
  margin-left: 0;
}

.map-detail {
  display: grid;
  gap: 16px;
}

.info-grid {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  margin: 0;
  overflow: hidden;
}

.info-grid dt,
.info-grid dd {
  border-bottom: 1px solid #edf2f7;
  margin: 0;
  padding: 10px 12px;
}

.info-grid dt {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.info-grid dd {
  color: #1f2937;
  word-break: break-word;
}

.info-grid dt:last-of-type,
.info-grid dd:last-of-type {
  border-bottom: 0;
}

@media (max-width: 760px) {
  .page {
    overflow: auto;
  }

  .content {
    overflow: visible;
  }

  .upload-row {
    grid-template-columns: 1fr;
  }
}
</style>
