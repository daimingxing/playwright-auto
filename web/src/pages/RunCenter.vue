<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RunMeta } from '../../../shared/types';
import { getAuthState, saveLogin, startLogin } from '../api/auth';
import { deleteRun, exportRun, listRuns, runProject } from '../api/runs';
import { getErrorMessage } from '../utils/error';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const authPath = ref('');
const hasAuth = ref(false);
const sessionId = ref('');
const reportPath = ref('');
const reportUrl = ref('');
const runError = ref('');
const reports = ref<RunMeta[]>([]);

/**
 * 加载项目下的测试报告列表。
 */
async function loadReports() {
  reports.value = await listRuns(projectKey);
}

/**
 * 加载项目登录态状态。
 */
async function loadAuthState() {
  const [state] = await Promise.all([getAuthState(projectKey), loadReports()]);
  hasAuth.value = state.exists;
  authPath.value = state.path;
}

/**
 * 打开浏览器让用户自行登录。
 */
async function openLogin() {
  loading.value = true;

  try {
    const session = await startLogin(projectKey);
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

  running.value = true;
  reportPath.value = '';
  reportUrl.value = '';
  runError.value = '';

  try {
    const run = await runProject(projectKey);
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

onMounted(loadAuthState);
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>运行中心</h2>
      </div>
    </div>
    <el-card shadow="never">
      <el-alert
        class="result"
        :type="hasAuth ? 'success' : 'warning'"
        :closable="false"
        :title="hasAuth ? '已保存项目登录态，运行测试会自动复用' : '当前项目还没有保存登录态'"
      />

      <div class="actions">
        <el-button type="primary" :loading="loading" @click="openLogin">打开浏览器登录</el-button>
        <el-button :disabled="!sessionId" :loading="saving" @click="saveAuth">我已完成登录，保存登录态</el-button>
        <el-button type="success" :disabled="!hasAuth" :loading="running" @click="startRun">运行测试</el-button>
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

    <el-card class="report-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>测试报告</span>
          <el-button text @click="loadReports">刷新</el-button>
        </div>
      </template>
      <el-table :data="reports" border empty-text="暂无测试报告">
        <el-table-column prop="id" label="报告编号" min-width="180" />
        <el-table-column prop="envKey" label="环境" width="120" />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column prop="createdAt" label="创建时间" min-width="190" />
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button size="small" @click="openRunReport(row)">打开</el-button>
            <el-button size="small" @click="exportReport(row)">导出</el-button>
            <el-button size="small" type="danger" @click="removeReport(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<style scoped>
.page {
  padding: 28px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.result {
  margin-top: 16px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 18px;
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
  margin-top: 20px;
}

.card-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
</style>
