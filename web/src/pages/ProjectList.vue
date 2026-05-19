<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ProjectMeta } from '../../../shared/types';
import { createProject, listProjects } from '../api/projects';

const router = useRouter();
const loading = ref(false);
const dialogOpen = ref(false);
const projects = ref<ProjectMeta[]>([]);
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

    <el-empty v-if="!loading && projects.length === 0" description="暂无测试项目" />

    <div class="grid">
      <el-card v-for="project in projects" :key="project.key" shadow="never">
        <h3>{{ project.name }}</h3>
        <p>{{ project.envs[0]?.baseUrl }}</p>
        <el-button @click="router.push(`/projects/${project.key}`)">进入项目</el-button>
      </el-card>
    </div>

    <el-dialog v-model="dialogOpen" title="新建测试项目" width="520px">
      <el-form label-width="90px">
        <el-form-item label="项目名称">
          <el-input v-model="form.name" placeholder="例如：CRM 系统" />
        </el-form-item>
        <el-form-item label="项目标识">
          <el-input v-model="form.key" placeholder="例如：crm" />
        </el-form-item>
        <el-form-item label="项目 URL">
          <el-input v-model="form.baseUrl" placeholder="https://test.example.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="submitProject">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page {
  padding: 28px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
</style>
