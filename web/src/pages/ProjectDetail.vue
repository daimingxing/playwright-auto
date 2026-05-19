<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CaseMeta } from '../../../shared/types';
import { createCase, deleteCase, listCases, listTrash } from '../api/cases';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const dialogOpen = ref(false);
const cases = ref<CaseMeta[]>([]);
const trash = ref<CaseMeta[]>([]);
const form = reactive({
  name: '',
  startPath: '/'
});

/**
 * 加载项目用例和回收站。
 */
async function loadData() {
  const [caseList, trashList] = await Promise.all([listCases(projectKey), listTrash(projectKey)]);
  cases.value = caseList;
  trash.value = trashList;
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
  await deleteCase(projectKey, item.key);
  await loadData();
}

onMounted(loadData);
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push('/')">返回项目列表</el-button>
        <h2>{{ projectKey }} 用例管理</h2>
      </div>
      <div class="actions">
        <el-button @click="router.push(`/projects/${projectKey}/runs`)">运行测试</el-button>
        <el-button type="primary" @click="dialogOpen = true">新建用例</el-button>
      </div>
    </div>

    <el-table :data="cases" border>
      <el-table-column prop="name" label="用例名称" />
      <el-table-column prop="startPath" label="起始路径" />
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button size="small" @click="router.push(`/projects/${projectKey}/cases/${row.key}`)">编辑</el-button>
          <el-button size="small" type="danger" @click="removeCase(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <section class="trash">
      <h3>回收站</h3>
      <el-tag v-for="item in trash" :key="item.key" type="info">{{ item.name }}</el-tag>
    </section>

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

.actions {
  display: flex;
  gap: 10px;
}

.trash {
  margin-top: 24px;
}
</style>
