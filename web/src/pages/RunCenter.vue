<script setup lang="ts">
import { Back, Delete, RefreshRight } from '@element-plus/icons-vue';
import type { TableInstance } from 'element-plus';
import { nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CaseMeta, EnvMeta, RunConfig, RunMeta, RunMode } from '../../../shared/types';
import { listCases } from '../api/cases';
import { getProject } from '../api/projects';
import { getRunConfig } from '../api/runs';
import { getProjectEnv } from '../state/project-env';
import { useProjectUiStore } from '../state/project-ui';
import { useRunAuth, useRunReports, useRunStart } from './run-center-composables';
import {
  canStartRun,
  formatPracticalReviewStatus,
  formatPracticalReviewTime,
  formatRunCreatedTime,
  getSelectedKeys,
  getPracticalReviewTagType,
  getReportUrl,
  getRunButtonText,
  isRunnableCase,
  mergeSelectedCaseKeys
} from './run-center';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const projectUi = useProjectUiStore();
const envs = ref<EnvMeta[]>([]);
const selectedEnv = ref('default');
const runMode = ref<RunMode>('headless');
const runConfig = ref<RunConfig>({
  headlessWorkers: 4,
  headedWorkers: 1,
  maxWorkers: 8
});
const workers = ref(runConfig.value.headlessWorkers);
const cases = ref<CaseMeta[]>([]);
const selectedCaseKeys = ref<string[]>(projectUi.getRunCaseKeys(projectKey));
const caseTable = ref<TableInstance>();
const syncingSelection = ref(false);
const {
  reports,
  refreshingReports,
  loadReports,
  refreshReports,
  openReportUrl,
  openRunReport,
  exportReport,
  removeReport
} = useRunReports({ projectKey });
const {
  loading,
  saving,
  authPath,
  hasAuth,
  sessionId,
  loadAuthState,
  changeEnv,
  openLogin,
  saveAuth
} = useRunAuth({
  projectKey,
  selectedEnv,
  reloadReports: loadReports
});
const {
  running,
  reportPath,
  reportUrl,
  runError,
  startRun
} = useRunStart({
  projectKey,
  selectedEnv,
  runMode,
  workers,
  selectedCaseKeys,
  hasAuth,
  loadReports,
  openReportUrl
});

/**
 * 加载项目环境配置。
 */
async function loadProject() {
  const [project, config, items] = await Promise.all([getProject(projectKey), getRunConfig(projectKey), listCases(projectKey)]);

  envs.value = project.envs;
  selectedEnv.value = getProjectEnv(project)?.key ?? '';
  runConfig.value = config;
  workers.value = config.headlessWorkers;
  cases.value = items.filter(isRunnableCase);
  selectedCaseKeys.value = mergeSelectedCaseKeys(items, selectedCaseKeys.value);
  projectUi.setRunCaseKeys(projectKey, selectedCaseKeys.value);
  await syncSelection();
}

/**
 * 同步表格多选用例。
 */
function updateSelection(rows: CaseMeta[]) {
  if (syncingSelection.value) {
    return;
  }

  selectedCaseKeys.value = getSelectedKeys(rows);
  projectUi.setRunCaseKeys(projectKey, selectedCaseKeys.value);
}

/**
 * 将已保存的用例选择同步到表格原生多选列。
 */
async function syncSelection() {
  await nextTick();

  if (!caseTable.value) {
    return;
  }

  const selectedSet = new Set(selectedCaseKeys.value);
  syncingSelection.value = true;
  // Element Plus 程序化勾选会触发 selection-change，需要避免覆盖已保存选择。
  caseTable.value.clearSelection();
  cases.value.forEach((row) => {
    caseTable.value?.toggleRowSelection(row, selectedSet.has(row.key));
  });
  syncingSelection.value = false;
}

/**
 * 切换运行模式时使用推荐并发数。
 */
function changeRunMode(mode: RunMode) {
  // 可视调试会打开真实窗口，并发过高容易影响人工观察和本机性能。
  workers.value = mode === 'headless' ? runConfig.value.headlessWorkers : runConfig.value.headedWorkers;
}

/**
 * 打开本次测试的 HTML 报告。
 */
function openReport() {
  openReportUrl(reportUrl.value);
}

/**
 * 显示报告所属环境。
 */
function getEnvLabel(envKey: string) {
  const env = envs.value.find((item) => item.key === envKey);

  return env ? `${env.name}（${env.key}）` : envKey;
}

/**
 * 显示运行状态中文名称。
 */
function getStatusLabel(status: RunMeta['status']) {
  const statusMap: Record<RunMeta['status'], string> = {
    created: '已创建',
    running: '运行中',
    passed: '通过',
    failed: '失败'
  };

  return statusMap[status] ?? status;
}

/**
 * 显示运行状态标签类型。
 */
function getStatusType(status: RunMeta['status']) {
  const typeMap: Record<RunMeta['status'], 'info' | 'primary' | 'success' | 'danger'> = {
    created: 'info',
    running: 'primary',
    passed: 'success',
    failed: 'danger'
  };

  return typeMap[status] ?? 'info';
}

/**
 * 判断运行测试按钮是否可点击。
 */
function canRun() {
  return canStartRun(hasAuth.value, selectedCaseKeys.value, running.value);
}

/**
 * 显示运行测试按钮文案。
 */
function getStartText() {
  return getRunButtonText(selectedCaseKeys.value);
}

onMounted(async () => {
  await loadProject();
  await loadAuthState();
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>运行中心</h2>
      </div>
      <div class="toolbar-actions btn-shadow-md">
        <el-button
          size="large"
          type="success"
          :disabled="!canRun()"
          :loading="running"
          @click="startRun"
        >
          {{ getStartText() }}
        </el-button>
      </div>
    </div>
    <div class="content">
      <div class="run-area">
        <el-card class="run-card" shadow="never">
          <template #header>
            <span>运行设置</span>
          </template>
          <el-form label-width="90px">
            <el-form-item label="运行环境">
              <el-select v-model="selectedEnv" class="env-select" @change="changeEnv">
                <el-option
                  v-for="env in envs"
                  :key="env.key"
                  :label="`${env.name}（${env.key}）`"
                  :value="env.key"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="运行模式">
              <el-segmented
                v-model="runMode"
                @change="changeRunMode"
                :options="[
                  { label: '无头运行', value: 'headless' },
                  { label: '可视调试', value: 'headed' }
                ]"
              />
            </el-form-item>
            <el-form-item label="并发数">
              <el-input-number v-model="workers" :min="1" :max="runConfig.maxWorkers" :step="1" controls-position="right" />
            </el-form-item>
          </el-form>
          <el-alert
            class="result"
            :type="hasAuth ? 'success' : 'warning'"
            :closable="false"
            :title="hasAuth ? '已保存项目登录态，运行测试会自动复用' : '当前项目还没有保存登录态'"
          />

          <div class="actions btn-shadow-md">
            <el-button type="primary" :loading="loading" @click="openLogin">打开浏览器登录</el-button>
            <el-button :disabled="!sessionId" :loading="saving" @click="saveAuth">我已完成登录，保存登录态</el-button>
          </div>

          <el-alert v-if="authPath" class="result" type="info" :closable="false" :title="authPath" />
          <el-alert v-if="reportPath" class="result" type="success" :closable="false" title="测试运行完成，已打开 HTML 报告">
            <template #default>
              <div class="report-row">
                <span class="report-path">{{ reportPath }}</span>
                <el-button v-if="reportUrl" size="small" @click="openReport">打开报告</el-button>
              </div>
            </template>
          </el-alert>
          <el-alert
            v-if="runError"
            class="result"
            type="error"
            :closable="false"
            :title="runError"
            show-icon
          />
        </el-card>

        <el-card class="case-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>测试用例</span>
              <span class="case-count">已选择 {{ selectedCaseKeys.length }} / {{ cases.length }} 条</span>
            </div>
          </template>
          <div class="table-wrap">
            <el-table ref="caseTable" :data="cases" border stripe height="100%" empty-text="暂无可运行用例" row-key="key" @selection-change="updateSelection">
              <el-table-column type="selection" width="44" reserve-selection />
              <el-table-column prop="name" label="用例名称" min-width="150" show-overflow-tooltip />
              <el-table-column prop="startPath" label="起始路径" min-width="130" show-overflow-tooltip />
              <el-table-column label="实测检查" min-width="120">
                <template #default="{ row }">
                  <el-tag :type="getPracticalReviewTagType(row.practicalReview)" effect="light">
                    {{ formatPracticalReviewStatus(row.practicalReview) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="最后实测时间" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ formatPracticalReviewTime(row.practicalReview) }}
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>
      </div>

      <el-card class="report-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>测试报告</span>
            <el-button text class="refresh-btn" @click="refreshReports">
              <el-icon :class="{ 'is-spinning': refreshingReports }"><RefreshRight /></el-icon>
              <span>刷新</span>
            </el-button>
          </div>
        </template>
        <div class="table-wrap">
          <el-table :data="reports" border stripe height="100%" empty-text="暂无测试报告">
            <el-table-column prop="id" label="报告编号" min-width="180" />
            <el-table-column label="环境" min-width="170">
              <template #default="{ row }">
                {{ getEnvLabel(row.envKey) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.status)">{{ getStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="190">
              <template #default="{ row }">
                {{ formatRunCreatedTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260">
              <template #default="{ row }">
                <div class="report-actions btn-shadow-sm">
                  <el-button class="open-btn" size="small" type="primary" @click="openRunReport(row)">打开</el-button>
                  <el-button size="small" @click="exportReport(row)">导出</el-button>
                  <el-button
                    class="delete-report-btn"
                    size="small"
                    type="danger"
                    :icon="Delete"
                    title="删除测试报告"
                    aria-label="删除测试报告"
                    @click="removeReport(row)"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
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
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  align-items: flex-end;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
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

.result {
  margin-top: 16px;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(260px, 42vh) minmax(180px, 1fr);
  gap: 20px;
  overflow: hidden;
}

.content :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 18px;
  flex-wrap: wrap;
}

.run-area {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(320px, 0.8fr) minmax(360px, 1.2fr);
  gap: 20px;
  overflow: hidden;
}

.run-card {
  min-height: 0;
  overflow: auto;
}

.case-card {
  min-height: 0;
  overflow: hidden;
}

.env-select {
  width: 260px;
}

.case-count {
  color: #606266;
  font-size: 13px;
}

.report-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.report-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.report-actions :deep(.el-button) {
  margin-left: 0;
}

.report-actions :deep(.el-button:not(.is-disabled):hover),
.report-actions :deep(.el-button:not(.is-disabled):focus-visible) {
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
  transform: none;
}

.report-actions :deep(.open-btn) {
  border-color: #409eff;
}

.report-actions :deep(.delete-report-btn) {
  margin-left: auto;
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 7px;
  box-shadow: 0 1px 6px rgba(220, 38, 38, 0.22);
}

.report-actions :deep(.delete-report-btn .el-icon) {
  font-size: 16px;
}

.report-actions :deep(.delete-report-btn:not(.is-disabled):hover),
.report-actions :deep(.delete-report-btn:not(.is-disabled):focus-visible) {
  box-shadow: 0 3px 10px rgba(220, 38, 38, 0.28);
  transform: none;
}

.report-path {
  color: #606266;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-card {
  min-height: 0;
}

.card-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.refresh-btn {
  --el-button-hover-bg-color: transparent;
  --el-button-active-bg-color: transparent;
  --el-button-focus-bg-color: transparent;
  gap: 6px;
}

.refresh-btn.el-button.is-text:not(.is-disabled):hover,
.refresh-btn.el-button.is-text:not(.is-disabled):focus-visible,
.refresh-btn.el-button.is-text:not(.is-disabled):active {
  background-color: transparent;
}

.refresh-btn :deep(.el-icon) {
  transition: transform 0.22s ease;
}

.refresh-btn:not(.is-disabled):hover :deep(.el-icon),
.refresh-btn:not(.is-disabled):focus-visible :deep(.el-icon) {
  transform: rotate(-36deg);
}

.refresh-btn :deep(.is-spinning) {
  animation: refresh-spin 0.48s ease;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

@keyframes refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
  .content {
    grid-template-rows: minmax(0, auto) minmax(180px, 1fr);
    overflow: auto;
  }

  .run-area {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .run-card,
  .case-card {
    max-height: none;
  }

  .case-card {
    min-height: 260px;
  }
}
</style>
