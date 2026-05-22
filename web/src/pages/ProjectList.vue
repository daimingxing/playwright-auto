<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { EnvMeta, ProjectMeta } from '../../../shared/types';
import {
  addProjectEnv,
  createProject,
  deleteProjectEnv,
  listProjects,
  updateProjectEnv
} from '../api/projects';
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
 * 提交新建项目表单。
 */
async function submitProject() {
  const item = await createProject({
    name: form.name,
    key: form.key,
    baseUrl: form.baseUrl
  });
  dialogOpen.value = false;
  await loadProjects();
  await router.push(`/projects/${item.key}`);
}

/**
 * 读取项目固定默认环境。
 */
function getDefaultEnv(project: ProjectMeta) {
  return project.envs.find((env) => env.key === 'default') ?? project.envs[0];
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
    <div class="toolbar">
      <div>
        <h2>测试项目</h2>
        <p>创建项目后，URL、用例、回收站和运行产物都会按项目分目录保存。</p>
      </div>
      <el-button type="primary" @click="dialogOpen = true">新建项目</el-button>
    </div>

    <div class="content">
      <el-empty v-if="!loading && projects.length === 0" description="暂无测试项目" />

      <div v-else class="grid">
        <el-card v-for="project in projects" :key="project.key" shadow="never">
          <div class="project-head">
            <div>
              <h3>{{ project.name }}</h3>
              <p>{{ project.key }}</p>
            </div>
            <el-tag size="small">{{ project.envs.length }} 个环境</el-tag>
          </div>
          <div class="env-info">
            <div class="env-header">
              <el-tag size="small" type="info" effect="light">默认</el-tag>
              <strong>{{ getDefaultEnv(project)?.name }}</strong>
            </div>
            <p>{{ getDefaultEnv(project)?.baseUrl }}</p>
          </div>
          <div class="card-actions">
            <el-button @click="router.push(`/projects/${project.key}`)">进入项目</el-button>
            <el-button @click="openEnvDialog(project)">环境配置</el-button>
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="dialogOpen" title="新建测试项目" width="520px">
      <el-form label-width="90px">
        <el-form-item label="项目名称">
          <el-input v-model="form.name" placeholder="例如：CRM 系统" />
        </el-form-item>
        <el-form-item label="项目标识">
          <el-input v-model="form.key" placeholder="例如：crm" />
        </el-form-item>
        <el-form-item label="默认 URL">
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
        <el-table :data="activeProject.envs" border>
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
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  align-content: start;
}

.project-head {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.project-head h3 {
  margin: 0 0 4px;
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
  margin-top: 14px;
  padding-top: 14px;
}

.env-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.env-header strong {
  font-size: 14px;
  color: #374151;
}

.card-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
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
