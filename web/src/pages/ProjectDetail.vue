<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CaseMeta } from '../../../shared/types';
import {
  createCase,
  deleteCase,
  exportCase,
  listCases,
  listTrash,
  removeTrashCase,
  restoreCase
} from '../api/cases';
import { getErrorMessage } from '../utils/error';

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
const reviewLabels = {
  error: '错误',
  danger: '高危',
  warning: '警告',
  info: '提示'
} as const;
const reviewTypes = {
  error: 'danger',
  danger: 'warning',
  warning: 'warning',
  info: 'info',
  pass: 'success'
} as const;

/**
 * 加载项目用例和回收站。
 */
async function loadData() {
  const [caseList, trashList] = await Promise.all([listCases(projectKey), listTrash(projectKey)]);
  cases.value = caseList;
  trash.value = trashList;
}

/**
 * 格式化用例审查摘要。
 */
function formatReview(item: CaseMeta) {
  const summary = item.review?.summary;

  if (!summary) {
    return '未审查';
  }

  const parts = (['error', 'danger', 'warning', 'info'] as const)
    .filter((level) => summary[level] > 0)
    .map((level) => `${reviewLabels[level]} ${summary[level]}`);

  return parts.length > 0 ? parts.join(' / ') : '通过';
}

/**
 * 获取审查摘要标签类型。
 */
function getReviewType(item: CaseMeta) {
  return reviewTypes[item.review?.summary.level ?? 'info'];
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
  try {
    await deleteCase(projectKey, item.key);
    await loadData();
    ElMessage.success('已移入回收站');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 导出单条测试用例。
 */
async function exportItem(item: CaseMeta) {
  try {
    await exportCase(projectKey, item.key);
    ElMessage.success('已开始下载测试用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 恢复回收站中的用例。
 */
async function restoreItem(item: CaseMeta) {
  try {
    await restoreCase(projectKey, item.key);
    await loadData();
    ElMessage.success('已恢复用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 彻底删除回收站中的用例。
 */
async function removeTrashItem(item: CaseMeta) {
  const confirmed = await ElMessageBox.confirm(`确认彻底删除「${item.name}」吗？删除后不可恢复。`, '彻底删除用例', {
    confirmButtonText: '彻底删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await removeTrashCase(projectKey, item.key);
    await loadData();
    ElMessage.success('已彻底删除用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
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

    <div class="content">
      <section class="list-block">
        <h3>用例列表</h3>
        <div class="table-wrap">
          <el-table :data="cases" border height="100%">
            <el-table-column prop="name" label="用例名称" />
            <el-table-column prop="startPath" label="起始路径" />
            <el-table-column label="审查状态" width="220">
              <template #default="{ row }">
                <el-tag :type="getReviewType(row)" effect="light">{{ formatReview(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240">
              <template #default="{ row }">
                <el-button size="small" @click="router.push(`/projects/${projectKey}/cases/${row.key}`)">编辑</el-button>
                <el-button size="small" @click="exportItem(row)">导出</el-button>
                <el-button size="small" type="danger" @click="removeCase(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="trash list-block">
        <h3>回收站</h3>
        <div class="table-wrap">
          <el-table :data="trash" border height="100%" empty-text="回收站暂无用例">
            <el-table-column prop="name" label="用例名称" />
            <el-table-column prop="key" label="目录编号" width="140" />
            <el-table-column label="操作" width="220">
              <template #default="{ row }">
                <el-button size="small" @click="restoreItem(row)">恢复</el-button>
                <el-button size="small" type="danger" @click="removeTrashItem(row)">彻底删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
}

.list-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list-block h3 {
  flex: 0 0 auto;
  margin: 0 0 12px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}
</style>
