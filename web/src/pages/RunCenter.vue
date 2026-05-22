<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CaseMeta, EnvMeta, RunConfig, RunMeta, RunMode } from '../../../shared/types';
import { getAuthState, saveLogin, startLogin } from '../api/auth';
import { listCases } from '../api/cases';
import { getProject } from '../api/projects';
import { deleteRun, exportRun, getRunConfig, listRuns, runProject } from '../api/runs';
import { getErrorMessage } from '../utils/error';
import { canStartRun, getRunButtonText, mergeSelectedCaseKeys } from './run-center';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const authPath = ref('');
const hasAuth = ref(false);
const sessionId = ref('');
const envs = ref<EnvMeta[]>([]);
const selectedEnv = ref('default');
const runMode = ref<RunMode>('headless');
const runConfig = ref<RunConfig>({
  headlessWorkers: 4,
  headedWorkers: 1,
  maxWorkers: 8
});
const workers = ref(runConfig.value.headlessWorkers);
const reportPath = ref('');
const reportUrl = ref('');
const runError = ref('');
const reports = ref<RunMeta[]>([]);
const cases = ref<CaseMeta[]>([]);
const selectedCaseKeys = ref<string[]>([]);

/**
 * 加载项目环境配置。
 */
async function loadProject() {
  const [project, config, items] = await Promise.all([getProject(projectKey), getRunConfig(projectKey), listCases(projectKey)]);

  envs.value = project.envs;
  selectedEnv.value = 'default';
  runConfig.value = config;
  workers.value = config.headlessWorkers;
  cases.value = items;
  selectedCaseKeys.value = mergeSelectedCaseKeys(items, selectedCaseKeys.value);
}

/**
 * 加载项目下的测试报告列表。
 */
async function loadReports() {
  reports.value = await listRuns(projectKey);
}

/**
 * 全选当前项目可用测试用例。
 */
function selectAllCases() {
  selectedCaseKeys.value = cases.value.map((item) => item.key);
}

/**
 * 清空本次测试用例选择。
 */
function clearCases() {
  selectedCaseKeys.value = [];
}

/**
 * 加载项目登录态状态。
 */
async function loadAuthState() {
  const [state] = await Promise.all([getAuthState(projectKey, selectedEnv.value), loadReports()]);
  hasAuth.value = state.exists;
  authPath.value = state.path;
}

/**
 * 切换运行环境后刷新登录态状态。
 */
async function changeEnv() {
  sessionId.value = '';
  await loadAuthState();
}

/**
 * 切换运行模式时使用推荐并发数。
 */
function changeRunMode(mode: RunMode) {
  // 可视调试会打开真实窗口，并发过高容易影响人工观察和本机性能。
  workers.value = mode === 'headless' ? runConfig.value.headlessWorkers : runConfig.value.headedWorkers;
}

/**
 * 打开浏览器让用户自行登录。
 */
async function openLogin() {
  loading.value = true;

  try {
    const session = await startLogin(projectKey, { envKey: selectedEnv.value });
    sessionId.value = session.sessionId;
    ElMessage.success('已打开浏览器，请完成登录后返回本页面保存登录态');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

/**
 * 保存用户手动登录后的登录态。
 */
async function saveAuth() {
  if (!sessionId.value) {
    ElMessage.warning('请先打开浏览器完成登录');
    return;
  }

  saving.value = true;

  try {
    const auth = await saveLogin(projectKey, sessionId.value);
    authPath.value = auth.path;
    hasAuth.value = true;
    sessionId.value = '';
    ElMessage.success('登录态已保存，后续运行测试会自动复用');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

/**
 * 打开本次测试的 HTML 报告。
 */
function openReport() {
  if (!reportUrl.value) {
    return;
  }

  window.open(reportUrl.value, '_blank', 'noopener,noreferrer');
}

/**
 * 打开指定测试报告。
 */
function openRunReport(item: RunMeta) {
  if (!item.reportUrl) {
    return;
  }

  window.open(item.reportUrl, '_blank', 'noopener,noreferrer');
}

/**
 * 导出指定测试报告。
 */
async function exportReport(item: RunMeta) {
  try {
    await exportRun(projectKey, item.id);
    ElMessage.success('已开始下载测试报告');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 删除指定测试报告目录。
 */
async function removeReport(item: RunMeta) {
  const confirmed = await ElMessageBox.confirm(`确认删除测试报告「${item.id}」吗？删除后不可恢复。`, '删除测试报告', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deleteRun(projectKey, item.id);
    await loadReports();
    ElMessage.success('已删除测试报告');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 使用已保存登录态运行测试。
 */
async function startRun() {
  if (!hasAuth.value) {
    ElMessage.warning('请先保存项目登录态');
    return;
  }

  if (selectedCaseKeys.value.length === 0) {
    ElMessage.warning('请选择至少一条测试用例');
    return;
  }

  running.value = true;
  reportPath.value = '';
  reportUrl.value = '';
  runError.value = '';

  try {
    const run = await runProject(projectKey, {
      envKey: selectedEnv.value,
      mode: runMode.value,
      workers: workers.value,
      caseKeys: selectedCaseKeys.value
    });
    reportPath.value = run.reportPath;
    reportUrl.value = run.reportUrl ?? '';
    await loadReports();
    ElMessage.success('测试运行完成');
    openReport();
  } catch (error) {
    runError.value = getErrorMessage(error);
    reportPath.value = getErrorInfo(error, 'reportPath');
    reportUrl.value = getErrorInfo(error, 'reportUrl');
    await loadReports();
    openReport();
    ElMessage.error(runError.value);
  } finally {
    running.value = false;
  }
}

/**
 * 从接口错误中读取附加字段。
 */
function getErrorInfo(error: unknown, key: 'reportPath' | 'reportUrl') {
  if (error && typeof error === 'object' && key in error) {
    const value = error[key as keyof typeof error];

    return typeof value === 'string' ? value : '';
  }

  return '';
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
        <el-button text @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>运行中心</h2>
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
              <el-radio-group v-model="runMode" @change="changeRunMode">
                <el-radio-button label="headless">无头运行</el-radio-button>
                <el-radio-button label="headed">可视调试</el-radio-button>
              </el-radio-group>
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

          <div class="actions">
            <el-button type="primary" :loading="loading" @click="openLogin">打开浏览器登录</el-button>
            <el-button :disabled="!sessionId" :loading="saving" @click="saveAuth">我已完成登录，保存登录态</el-button>
            <el-button type="success" :disabled="!canRun()" :loading="running" @click="startRun">{{ getStartText() }}</el-button>
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
          <div class="case-tools">
            <el-button size="small" @click="selectAllCases">全选</el-button>
            <el-button size="small" @click="clearCases">全不选</el-button>
          </div>
          <div class="table-wrap">
            <el-table :data="cases" border height="100%" empty-text="暂无可运行用例" row-key="key">
              <el-table-column width="54">
                <template #default="{ row }">
                  <el-checkbox v-model="selectedCaseKeys" :value="row.key" />
                </template>
              </el-table-column>
              <el-table-column prop="name" label="用例名称" min-width="150" show-overflow-tooltip />
              <el-table-column prop="startPath" label="起始路径" min-width="130" show-overflow-tooltip />
              <el-table-column prop="updatedAt" label="更新时间" min-width="180" show-overflow-tooltip />
            </el-table>
          </div>
        </el-card>
      </div>

      <el-card class="report-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>测试报告</span>
            <el-button text @click="loadReports">刷新</el-button>
          </div>
        </template>
        <div class="table-wrap">
          <el-table :data="reports" border height="100%" empty-text="暂无测试报告">
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
            <el-table-column prop="createdAt" label="创建时间" min-width="190" />
            <el-table-column label="操作" width="260">
              <template #default="{ row }">
                <el-button size="small" @click="openRunReport(row)">打开</el-button>
                <el-button size="small" @click="exportReport(row)">导出</el-button>
                <el-button size="small" type="danger" @click="removeReport(row)">删除</el-button>
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
}

.toolbar h2 {
  margin: 8px 0 0;
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

.case-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.report-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
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

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
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
