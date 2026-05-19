<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getAuthState, saveLogin, startLogin } from '../api/auth';
import { runProject } from '../api/runs';
import { getErrorMessage } from '../utils/error';

const route = useRoute();
const projectKey = String(route.params.projectKey);
const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const authPath = ref('');
const hasAuth = ref(false);
const sessionId = ref('');
const reportPath = ref('');

/**
 * 加载项目登录态状态。
 */
async function loadAuthState() {
  const state = await getAuthState(projectKey);
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
 * 使用已保存登录态运行测试。
 */
async function startRun() {
  if (!hasAuth.value) {
    ElMessage.warning('请先保存项目登录态');
    return;
  }

  running.value = true;
  reportPath.value = '';

  try {
    const run = await runProject(projectKey);
    reportPath.value = run.reportPath;
    ElMessage.success('测试运行完成');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    running.value = false;
  }
}

onMounted(loadAuthState);
</script>

<template>
  <section class="page">
    <h2>运行中心</h2>
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
      <el-alert v-if="reportPath" class="result" type="success" :closable="false" :title="`报告目录：${reportPath}`" />
    </el-card>
  </section>
</template>

<style scoped>
.page {
  padding: 28px;
}

.result {
  margin-top: 16px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 18px;
}
</style>
