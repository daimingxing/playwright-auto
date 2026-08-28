<script setup lang="ts">
import { Back, Delete, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { PageArchive, PageArchiveDetail } from "../../../../shared/types";
import {
  deletePageArchive,
  getPageArchive,
  listPageArchives,
  refreshPageArchive,
} from "../../api/page-archives";
import { getErrorMessage } from "../../utils/error";
import { formatDateTime } from "../../utils/time";
import {
  formatPageArchiveStatus,
  formatPageTarget,
  getDeletePageArchiveConfirm,
  getRefreshPageArchiveConfirm,
} from "./page-archives";

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const archives = ref<PageArchive[]>([]);
const selectedId = ref("");
const detail = ref<PageArchiveDetail | null>(null);
const loading = ref(false);
let pollTimer: ReturnType<typeof setInterval> | undefined;

const selected = computed(() => archives.value.find((item) => item.id === selectedId.value));
const currentTargets = computed(() => detail.value?.current.states.flatMap((state) => state.targets) ?? []);
const currentRecipes = computed(() => detail.value?.current.states.flatMap((state) => state.recipes) ?? []);
const entrySteps = computed(() => detail.value?.current.states[0]?.entrySteps ?? []);

/**
 * 加载档案列表；已选中的继续拉详情。
 */
async function loadArchives() {
  archives.value = await listPageArchives(projectKey);

  if (selectedId.value && !archives.value.some((item) => item.id === selectedId.value)) {
    selectedId.value = "";
    detail.value = null;
  }

  if (!selectedId.value && archives.value[0]) {
    selectedId.value = archives.value[0].id;
  }

  if (selectedId.value) {
    await loadDetail(selectedId.value);
  }
}

/**
 * 读取档案详情。
 */
async function loadDetail(archiveId: string) {
  detail.value = await getPageArchive(projectKey, archiveId);
  syncSelectedStatus(detail.value);
}

/**
 * 把详情状态写回列表，避免刷新中列表落后。
 */
function syncSelectedStatus(next: PageArchiveDetail) {
  archives.value = archives.value.map((item) => (item.id === next.id ? { ...item, ...pickSummary(next) } : item));
}

/**
 * 从详情取出列表需要的摘要字段。
 */
function pickSummary(next: PageArchiveDetail): PageArchive {
  const { current: _current, previous: _previous, ...summary } = next;
  return summary;
}

/**
 * 选中一条档案。
 */
async function selectArchive(archive: PageArchive) {
  selectedId.value = archive.id;
  await loadDetail(archive.id);
}

/**
 * 刷新整个页面档案；失败保留旧版本。
 */
async function refreshSelected() {
  const archive = selected.value;

  if (!archive) {
    return;
  }

  const confirmed = await ElMessageBox.confirm(getRefreshPageArchiveConfirm(archive.title), "刷新页面档案", {
    confirmButtonText: "刷新",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    const started = await refreshPageArchive(projectKey, archive.id);
    detail.value = started;
    syncSelectedStatus(started);
    ElMessage.success(started.status === "refreshing" ? "已开始刷新" : "页面档案已更新");
    await pollUntilSettled(archive.id);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 删除页面档案，不修改已有测试计划。
 */
async function removeSelected() {
  const archive = selected.value;

  if (!archive) {
    return;
  }

  const confirmed = await ElMessageBox.confirm(getDeletePageArchiveConfirm(archive.title), "删除页面档案", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  try {
    await deletePageArchive(projectKey, archive.id);
    selectedId.value = "";
    detail.value = null;
    await loadArchives();
    ElMessage.success("已删除页面档案");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 刷新进行中时轮询详情，直到可用或失败。
 */
async function pollUntilSettled(archiveId: string) {
  stopPolling();

  if (detail.value?.status !== "refreshing") {
    await loadArchives();
    return;
  }

  pollTimer = setInterval(async () => {
    try {
      const next = await getPageArchive(projectKey, archiveId);
      detail.value = next;
      syncSelectedStatus(next);

      if (next.status !== "refreshing") {
        stopPolling();
        await loadArchives();
        if (next.status === "failed") {
          ElMessage.error(next.refreshFailure?.message || "刷新失败，已保留旧版本");
        } else {
          ElMessage.success("页面档案已更新");
        }
      }
    } catch (error) {
      stopPolling();
      ElMessage.error(getErrorMessage(error));
    }
  }, 1000);
}

/**
 * 停止刷新轮询。
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

onMounted(async () => {
  loading.value = true;

  try {
    await loadArchives();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}`)">
          返回用例管理
        </el-button>
        <h2>页面档案</h2>
      </div>
    </div>

    <div class="content">
      <section class="list-block">
        <h3>档案列表</h3>
        <p class="hint">按项目环境和业务路由归并。刷新或删除不会修改已经生成的测试计划和测试代码。</p>
        <div class="table-wrap">
          <el-table
            :data="archives"
            border
            stripe
            height="100%"
            empty-text="暂无页面档案。完成 AI 导入探索后会出现在这里。"
            highlight-current-row
            @row-click="selectArchive"
          >
            <el-table-column prop="title" label="页面" min-width="160" />
            <el-table-column prop="routePattern" label="路由模式" min-width="180" />
            <el-table-column prop="envKey" label="环境" width="120" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="formatPageArchiveStatus(row.status).type" size="small">
                  {{ formatPageArchiveStatus(row.status).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" min-width="170">
              <template #default="{ row }">
                {{ formatDateTime(row.updatedAt) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="detail-block" v-loading="loading">
        <div class="detail-toolbar">
          <h3>{{ detail?.title || "档案详情" }}</h3>
          <div class="btn-shadow-md">
            <el-button :icon="Refresh" :disabled="!detail || detail.status === 'refreshing'" @click="refreshSelected">
              刷新整个页面档案
            </el-button>
            <el-button type="danger" plain :icon="Delete" :disabled="!detail" @click="removeSelected">删除</el-button>
          </div>
        </div>
        <p v-if="!detail" class="hint">从左侧选择一条页面档案。</p>
        <template v-else>
          <p v-if="detail.refreshFailure" class="fail-hint">{{ detail.refreshFailure.message }}</p>
          <p class="meta">
            当前版本 {{ detail.currentRevisionId }}
            <span v-if="detail.previousRevisionId">；上一份 {{ detail.previousRevisionId }}</span>
          </p>
          <h4>进入步骤</h4>
          <ul>
            <li v-for="(step, index) in entrySteps" :key="`${step.action}-${index}`">
              {{ step.action }} {{ step.target }}
            </li>
          </ul>
          <h4>页面目标</h4>
          <ul>
            <li v-for="target in currentTargets" :key="target.key">{{ formatPageTarget(target) }}</li>
            <li v-if="currentTargets.length === 0">暂无已验证页面目标</li>
          </ul>
          <h4>操作配方</h4>
          <ul>
            <li v-for="recipe in currentRecipes" :key="recipe.id">
              {{ recipe.action }}「{{ recipe.target }}」{{ recipe.fromStateId }} → {{ recipe.toStateId }}
            </li>
            <li v-if="currentRecipes.length === 0">暂无操作配方</li>
          </ul>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 22px 28px 18px;
  box-sizing: border-box;
  overflow: hidden;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(320px, 1.1fr) minmax(280px, 0.9fr);
  gap: 16px;
  overflow: hidden;
}

.list-block,
.detail-block {
  background: #ffffff;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  padding: 14px 16px;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.list-block h3,
.detail-block h3,
.detail-block h4 {
  margin: 0 0 8px;
}

.hint,
.meta,
.fail-hint {
  color: #64748b;
  font-size: 13px;
  margin: 0 0 12px;
}

.fail-hint {
  color: #b91c1c;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.detail-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail-block ul {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 13px;
}
</style>
