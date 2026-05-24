<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowRight, Delete, Download, Monitor, Setting } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { EnvMeta, ProjectMeta } from '../../../shared/types';
import {
  addProjectEnv,
  createProject,
  deleteProject,
  deleteProjectEnv,
  exportProject,
  listProjects,
  updateProjectEnv
} from '../api/projects';
import { getDefaultEnv, getProjectEnv, isDefaultEnv, setProjectEnv } from '../state/project-env';
import { getErrorMessage } from '../utils/error';

const router = useRouter();
const loading = ref(false);
const dialogOpen = ref(false);
const envDialogOpen = ref(false);
const projects = ref<ProjectMeta[]>([]);
const activeProject = ref<ProjectMeta | null>(null);
const envMode = ref<'create' | 'edit'>('create');
const envForm = reactive({
  name: '',
  key: '',
  baseUrl: ''
});
const form = reactive({
  name: '',
  key: '',
  envName: '',
  baseUrl: ''
});

/**
 * 加载项目列表。
 */
async function loadProjects() {
  loading.value = true;
  try {
    projects.value = await listProjects();
  } finally {
    loading.value = false;
  }
}

/**
 * 归一化路径标识输入。
 */
function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

/**
 * 提交新建项目表单。
 */
async function submitProject() {
  try {
    const item = await createProject({
      name: form.name,
      key: normalizeKey(form.key),
      envName: form.envName,
      baseUrl: form.baseUrl
    });
    dialogOpen.value = false;
    await loadProjects();
    await router.push(`/projects/${item.key}`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 读取卡片当前选中的环境。
 */
function getSelectedEnv(project: ProjectMeta) {
  return getProjectEnv(project);
}

/**
 * 判断项目是否有多个可切换环境。
 */
function hasMultipleEnvs(project: ProjectMeta) {
  return project.envs.length > 1;
}

/**
 * 切换项目卡片当前展示的环境。
 */
function selectEnv(project: ProjectMeta, envKey: string) {
  setProjectEnv(project.key, envKey);
}

/**
 * 打开环境配置弹窗。
 */
function openEnvDialog(project: ProjectMeta) {
  activeProject.value = project;
  envDialogOpen.value = true;
  resetEnvForm();
}

/**
 * 重置环境表单为新增状态。
 */
function resetEnvForm() {
  envMode.value = 'create';
  envForm.name = '';
  envForm.key = '';
  envForm.baseUrl = '';
}

/**
 * 填充环境表单为编辑状态。
 */
function editEnv(env: EnvMeta) {
  envMode.value = 'edit';
  envForm.name = env.name;
  envForm.key = env.key;
  envForm.baseUrl = env.baseUrl;
}

/**
 * 提交新增或编辑环境。
 */
async function submitEnv() {
  if (!activeProject.value) {
    return;
  }

  const isCreate = envMode.value === 'create';

  try {
    if (isCreate) {
      await addProjectEnv(activeProject.value.key, {
        name: envForm.name,
        key: envForm.key,
        baseUrl: envForm.baseUrl
      });
    } else {
      await updateProjectEnv(activeProject.value.key, envForm.key, {
        name: envForm.name,
        baseUrl: envForm.baseUrl
      });
    }

    await refreshActiveProject();
    resetEnvForm();
    ElMessage.success(isCreate ? '环境已新增' : '环境已更新');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 删除当前项目环境。
 */
async function removeEnv(env: EnvMeta) {
  if (!activeProject.value) {
    return;
  }

  const confirmed = await ElMessageBox.confirm(`确认删除环境「${env.name}」吗？`, '删除环境', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deleteProjectEnv(activeProject.value.key, env.key);
    await refreshActiveProject();
    resetEnvForm();
    ElMessage.success('环境已删除');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 导出项目压缩包。
 */
async function exportItem(project: ProjectMeta) {
  const confirmed = await ElMessageBox.confirm(
    `确认导出项目「${project.name}」吗？导出包不包含登录态文件，迁移后需要重新登录。`,
    '导出项目',
    {
      confirmButtonText: '导出',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await exportProject(project.key);
    ElMessage.success('已开始下载项目');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 二次确认后彻底删除项目。
 */
async function removeProject(project: ProjectMeta) {
  const firstConfirmed = await ElMessageBox.confirm(
    `确认彻底删除项目「${project.name}」吗？这会删除所有用例、历史报告、回收站和失败解析。需要备份请先导出项目。`,
    '彻底删除项目',
    {
      confirmButtonText: '继续',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).catch(() => false);

  if (!firstConfirmed) {
    return;
  }

  const value = await ElMessageBox.prompt(`请输入项目标识「${project.key}」确认删除。`, '再次确认', {
    confirmButtonText: '彻底删除',
    cancelButtonText: '取消',
    inputPattern: new RegExp(`^${project.key}$`),
    inputErrorMessage: '项目标识不一致',
    type: 'error',
    distinguishCancelAndClose: true
  }).catch(() => false);

  if (!value) {
    return;
  }

  try {
    await deleteProject(project.key);
    await loadProjects();
    ElMessage.success('项目已彻底删除');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 刷新弹窗中的当前项目配置。
 */
async function refreshActiveProject() {
  const key = activeProject.value?.key;

  await loadProjects();

  if (key) {
    activeProject.value = projects.value.find((project) => project.key === key) ?? null;
  }
}

onMounted(loadProjects);
</script>

<template>
  <section class="page">
    <div class="toolbar btn-shadow-md">
      <div>
        <h2>测试项目</h2>
        <p>创建项目后，URL、用例、回收站和运行产物都会按项目分目录保存。</p>
      </div>
      <el-button type="primary" size="large" @click="dialogOpen = true">新建项目</el-button>
    </div>

    <div class="content">
      <el-empty v-if="!loading && projects.length === 0" description="暂无测试项目" />

      <div v-else class="grid">
        <el-card v-for="project in projects" :key="project.key" class="project-card" shadow="never">
          <div class="project-head">
            <div>
              <h3>{{ project.name }}</h3>
              <p>{{ project.key }}</p>
            </div>
            <el-tag size="small">{{ project.envs.length }} 个环境</el-tag>
          </div>
          <div class="env-info">
            <el-dropdown
              v-if="hasMultipleEnvs(project)"
              trigger="click"
              @command="(envKey: string) => selectEnv(project, envKey)"
            >
              <button class="env-switch" type="button">
                <el-icon><Monitor /></el-icon>
                <strong>{{ getSelectedEnv(project)?.name }}</strong>
                <el-tag v-if="isDefaultEnv(project, getSelectedEnv(project))" size="small" type="info" effect="light">
                  默认
                </el-tag>
                <el-icon class="env-arrow"><ArrowDown /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="env in project.envs" :key="env.key" :command="env.key">
                    <div class="env-option">
                      <span>{{ env.name }}</span>
                      <el-tag v-if="isDefaultEnv(project, env)" size="small" type="info" effect="light">默认</el-tag>
                    </div>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div v-else class="env-static">
              <el-icon><Monitor /></el-icon>
              <strong>{{ getSelectedEnv(project)?.name }}</strong>
              <el-tag v-if="isDefaultEnv(project, getSelectedEnv(project))" size="small" type="info" effect="light">
                默认
              </el-tag>
            </div>
            <div class="url-panel">
              <span>URL</span>
              <p>{{ getSelectedEnv(project)?.baseUrl }}</p>
            </div>
          </div>
          <div class="card-actions btn-shadow-sm">
            <el-button type="primary" :icon="ArrowRight" @click="router.push(`/projects/${project.key}`)">
              进入项目
            </el-button>
            <el-button :icon="Setting" @click="openEnvDialog(project)">环境配置</el-button>
            <el-button :icon="Download" @click="exportItem(project)">导出项目</el-button>
            <el-button
              class="delete-project"
              size="small"
              type="danger"
              :icon="Delete"
              title="删除项目"
              aria-label="删除项目"
              @click="removeProject(project)"
            />
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="dialogOpen" title="新建测试项目" width="520px">
      <el-form label-width="90px">
        <el-form-item label="项目名称">
          <el-input v-model="form.name" placeholder="管理系统" />
        </el-form-item>
        <el-form-item label="项目标识">
          <el-input v-model="form.key" placeholder="例如：imms" />
        </el-form-item>
        <el-form-item label="环境名称">
          <el-input v-model="form.envName" placeholder="不填则使用：默认环境" />
        </el-form-item>
        <el-form-item label="环境 URL">
          <el-input v-model="form.baseUrl" placeholder="https://test.example.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="submitProject">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="envDialogOpen" title="环境配置" width="760px" @closed="resetEnvForm">
      <div v-if="activeProject" class="env-layout">
        <el-table :data="activeProject.envs" border stripe>
          <el-table-column label="环境" min-width="170">
            <template #default="{ row }">
              <div class="env-name">
                <strong>{{ row.name }}</strong>
                <span>{{ row.key }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="baseUrl" label="URL" min-width="240" />
          <el-table-column label="操作" width="150">
            <template #default="{ row }">
              <el-button size="small" @click="editEnv(row)">编辑</el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="row.key === 'default'"
                @click="removeEnv(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-form class="env-form" label-width="90px">
          <h3>{{ envMode === 'create' ? '新增环境' : '编辑环境' }}</h3>
          <el-form-item label="环境名称">
            <el-input v-model="envForm.name" placeholder="例如：预发环境" />
          </el-form-item>
          <el-form-item label="环境标识">
            <el-input v-model="envForm.key" :disabled="envMode === 'edit'" placeholder="例如：pre" />
          </el-form-item>
          <el-form-item label="环境 URL">
            <el-input v-model="envForm.baseUrl" placeholder="https://pre.example.com" />
          </el-form-item>
          <div class="env-actions">
            <el-button @click="resetEnvForm">清空</el-button>
            <el-button type="primary" @click="submitEnv">{{ envMode === 'create' ? '新增' : '保存' }}</el-button>
          </div>
        </el-form>
      </div>
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
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.toolbar h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.toolbar p {
  margin: 0;
  color: #6b7280;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
  gap: 16px;
  align-content: start;
}

.project-card {
  border: 1px solid #e8edf5;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.project-card:hover {
  border-color: #d5e1f1;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.1);
  transform: translateY(-1px);
}

.project-card :deep(.el-card__body) {
  padding: 22px 24px 20px;
}

.project-head {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.project-head h3 {
  margin: 0 0 4px;
  color: #111827;
  font-size: 18px;
  line-height: 1.35;
}

.project-head p,
.env-info p {
  color: #6b7280;
  margin: 0;
}

.env-info p {
  word-break: break-all;
}

.env-info {
  border-top: 1px solid #edf0f5;
  margin-top: 16px;
  padding-top: 16px;
}

.env-switch,
.env-static {
  appearance: none;
  background: #ffffff;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  min-height: 28px;
  padding: 3px 6px;
}

.env-switch {
  cursor: pointer;
}

.env-static {
  padding-left: 0;
}

.env-switch:hover {
  background: #f8fbff;
  border-color: #bfdbfe;
}

.env-switch:hover strong,
.env-switch:focus-visible strong {
  color: #2563eb;
}

.env-switch:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

.env-switch :deep(.el-icon),
.env-static :deep(.el-icon) {
  color: #3b82f6;
  font-size: 16px;
}

.env-switch strong,
.env-static strong {
  font-size: 14px;
  color: #374151;
}

.env-arrow {
  color: #64748b;
  font-size: 12px;
}

.env-option {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 160px;
}

.url-panel {
  background: #f8fafc;
  border: 1px solid #edf2f7;
  border-radius: 6px;
  margin-top: 10px;
  padding: 10px 12px;
}

.url-panel span {
  color: #64748b;
  display: block;
  font-size: 12px;
  line-height: 1;
  margin-bottom: 6px;
}

.url-panel p {
  color: #334155;
  line-height: 1.5;
}

.card-actions {
  border-top: 1px solid #edf0f5;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  flex-wrap: nowrap;
}

.card-actions :deep(.el-button) {
  margin-left: 0;
}

.card-actions :deep(.el-button:not(.delete-project)) {
  flex: 0 0 auto;
  min-width: 0;
}

.card-actions :deep(.delete-project) {
  flex: 0 0 auto;
  margin-left: auto;
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  border-radius: 7px;
  box-shadow: 0 1px 6px rgba(220, 38, 38, 0.22);
}

.card-actions :deep(.delete-project .el-icon) {
  font-size: 16px;
}

.card-actions :deep(.delete-project:not(.is-disabled):hover),
.card-actions :deep(.delete-project:not(.is-disabled):focus-visible) {
  box-shadow: 0 3px 10px rgba(220, 38, 38, 0.28);
  transform: none;
}

.env-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}

.env-name {
  display: grid;
  gap: 4px;
}

.env-name span {
  color: #6b7280;
  font-size: 12px;
}

.env-form {
  border-top: 1px solid #edf0f5;
  padding-top: 16px;
}

.env-form h3 {
  font-size: 16px;
  margin: 0 0 14px;
}

.env-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
