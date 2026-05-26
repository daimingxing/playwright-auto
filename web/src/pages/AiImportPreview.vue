<script setup lang="ts">
import { Back, RefreshRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { TableInstance } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ImportItem, ImportJob } from '../../../shared/types';
import { getImport, listImportItems, retryImportItem, saveImportItems, skipImportItem } from '../api/imports';
import { getErrorMessage } from '../utils/error';
import {
  canRetryImportItem,
  canSaveImportItem,
  canSkipImportItem,
  filterImportItems,
  formatAiLevel,
  formatDraftStepType,
  formatImportItemStatus,
  formatImportStatus,
  formatImportTime,
  getActionSteps,
  getCheckSteps,
  getCheckSummary,
  getImportProgress,
  getItemIssueText,
  type ImportFilter
} from './ai-import';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const importId = String(route.params.importId);
const loading = ref(false);
const saving = ref(false);
const job = ref<ImportJob | null>(null);
const items = ref<ImportItem[]>([]);
const filter = ref<ImportFilter>('all');
const page = ref(1);
const pageSize = ref(20);
const selectedRows = ref<ImportItem[]>([]);
const detailOpen = ref(false);
const detailItem = ref<ImportItem | null>(null);
const table = ref<TableInstance>();
let timer: ReturnType<typeof window.setInterval> | undefined;

const filterOptions: Array<{ label: string; value: ImportFilter }> = [
  { label: '全部', value: 'all' },
  { label: '待确认', value: 'pendingReview' },
  { label: '已保存', value: 'saved' },
  { label: '生成失败', value: 'failed' },
  { label: '已跳过', value: 'skipped' },
  { label: '低置信', value: 'lowConfidence' },
  { label: '有风险提示', value: 'warning' }
];

const filteredItems = computed(() => filterImportItems(items.value, filter.value));
const pagedItems = computed(() => {
  const start = (page.value - 1) * pageSize.value;

  return filteredItems.value.slice(start, start + pageSize.value);
});
const selectedSaveIds = computed(() => selectedRows.value.filter(canSaveImportItem).map((item) => item.itemId));
const selectedSkipIds = computed(() => selectedRows.value.filter(canSkipImportItem).map((item) => item.itemId));

/**
 * 加载导入任务和导入项。
 */
async function loadData() {
  loading.value = true;

  try {
    const [nextJob, nextItems] = await Promise.all([getImport(projectKey, importId), listImportItems(projectKey, importId)]);
    job.value = nextJob;
    items.value = nextItems;
    selectedRows.value = selectedRows.value.filter((row) => nextItems.some((item) => item.itemId === row.itemId));
    syncPolling();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

/**
 * 根据任务状态开启或停止预览页轮询。
 */
function syncPolling() {
  if (job.value?.status === 'running' && !timer) {
    timer = window.setInterval(() => {
      void loadData();
    }, 2000);
    return;
  }

  if (job.value?.status !== 'running' && timer) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

/**
 * 切换筛选条件并回到第一页。
 */
function changeFilter() {
  page.value = 1;
  table.value?.clearSelection();
}

/**
 * 同步表格当前选择。
 */
function updateSelection(rows: ImportItem[]) {
  selectedRows.value = rows;
}

/**
 * 打开导入项详情。
 */
function openDetail(item: ImportItem) {
  detailItem.value = item;
  detailOpen.value = true;
}

/**
 * 保存选中的待确认导入项。
 */
async function saveSelected() {
  if (selectedSaveIds.value.length === 0) {
    ElMessage.warning('请先选择待确认用例');
    return;
  }

  saving.value = true;

  try {
    const result = await saveImportItems(projectKey, importId, selectedSaveIds.value);
    await loadData();

    if (result.failed.length > 0) {
      ElMessage.warning(`已保存 ${result.saved.length} 条，${result.failed.length} 条未保存：${result.failed[0].message}`);
      return;
    }

    ElMessage.success(`已保存 ${result.saved.length} 条草稿`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

/**
 * 跳过选中的导入项。
 */
async function skipSelected() {
  if (selectedSkipIds.value.length === 0) {
    ElMessage.warning('请先选择可跳过用例');
    return;
  }

  const confirmed = await ElMessageBox.confirm(`确认跳过 ${selectedSkipIds.value.length} 条用例吗？`, '跳过用例', {
    confirmButtonText: '跳过',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  await Promise.all(selectedSkipIds.value.map((itemId) => skipImportItem(projectKey, importId, itemId)));
  await loadData();
  ElMessage.success('已跳过选中用例');
}

/**
 * 重试单条生成失败的导入项。
 */
async function retryItem(item: ImportItem) {
  try {
    await retryImportItem(projectKey, importId, item.itemId);
    await loadData();
    ElMessage.success('已重新加入生成队列');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 跳过单条导入项。
 */
async function skipItem(item: ImportItem) {
  try {
    await skipImportItem(projectKey, importId, item.itemId);
    await loadData();
    ElMessage.success('已跳过该用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

/**
 * 判断表格行是否可勾选。
 */
function canSelect(row: ImportItem) {
  return canSaveImportItem(row) || canSkipImportItem(row);
}

/**
 * 读取基础检查摘要。
 */
function getReviewText(item: ImportItem) {
  if (!item.review) {
    return '暂无检查结果';
  }

  const summary = item.review.summary;

  if (summary.level === 'pass') {
    return '基础检查通过';
  }

  return `需处理 ${summary.error + summary.danger + summary.warning + summary.info} 项`;
}

/**
 * 打开保存后的草稿用例。
 */
function openSavedCase(item: ImportItem) {
  if (item.savedCaseKey) {
    void router.push(`/projects/${projectKey}/cases/${item.savedCaseKey}`);
  }
}

onMounted(loadData);
onBeforeUnmount(() => {
  if (timer) {
    window.clearInterval(timer);
  }
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <el-button text :icon="Back" class="back-btn" @click="router.push(`/projects/${projectKey}/imports`)">返回导入记录</el-button>
        <h2>导入预览</h2>
      </div>
      <div class="toolbar-actions btn-shadow-md">
        <el-button :icon="RefreshRight" :loading="loading" @click="loadData">刷新</el-button>
        <el-button :disabled="selectedSkipIds.length === 0" @click="skipSelected">跳过选中</el-button>
        <el-button type="primary" :disabled="selectedSaveIds.length === 0" :loading="saving" @click="saveSelected">
          保存选中为草稿
        </el-button>
      </div>
    </div>

    <el-card class="summary-card" shadow="never">
      <div class="summary-grid">
        <div>
          <span>文件</span>
          <strong>{{ job?.fileName ?? '-' }}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{{ job ? formatImportStatus(job.status) : '-' }}</strong>
        </div>
        <div>
          <span>生成进度</span>
          <el-progress :percentage="job ? getImportProgress(job) : 0" :stroke-width="8" />
        </div>
        <div>
          <span>更新时间</span>
          <strong>{{ formatImportTime(job?.updatedAt) }}</strong>
        </div>
      </div>
    </el-card>

    <div class="content">
      <div class="list-head">
        <el-radio-group v-model="filter" @change="changeFilter">
          <el-radio-button v-for="option in filterOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </el-radio-button>
        </el-radio-group>
        <span class="count-text">当前 {{ filteredItems.length }} 条</span>
      </div>

      <div class="table-wrap">
        <el-table
          ref="table"
          :data="pagedItems"
          border
          stripe
          height="100%"
          row-key="itemId"
          empty-text="暂无导入项"
          @selection-change="updateSelection"
        >
          <el-table-column type="selection" width="44" :selectable="canSelect" reserve-selection />
          <el-table-column prop="caseNo" label="用例编号" width="120" show-overflow-tooltip />
          <el-table-column prop="caseName" label="用例名称" min-width="220" show-overflow-tooltip />
          <el-table-column label="步骤数" width="90">
            <template #default="{ row }">
              {{ row.draft?.steps.length ?? row.source.steps.length }}
            </template>
          </el-table-column>
          <el-table-column label="检查步骤" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              {{ getCheckSummary(row) }}
            </template>
          </el-table-column>
          <el-table-column label="置信度" width="100">
            <template #default="{ row }">
              <el-tag :type="formatAiLevel(row.draft?.confidence).type" effect="light">
                {{ formatAiLevel(row.draft?.confidence).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="formatImportItemStatus(row.status).type" effect="light">
                {{ formatImportItemStatus(row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="问题提示" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ getItemIssueText(row) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="250" fixed="right">
            <template #default="{ row }">
              <div class="row-actions btn-shadow-sm">
                <el-button size="small" @click="openDetail(row)">详情</el-button>
                <el-button size="small" :disabled="!canRetryImportItem(row)" @click="retryItem(row)">重试</el-button>
                <el-button size="small" :disabled="!canSkipImportItem(row)" @click="skipItem(row)">跳过</el-button>
                <el-button v-if="row.savedCaseKey" size="small" type="primary" @click="openSavedCase(row)">草稿</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="filteredItems.length"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </div>

    <el-drawer v-model="detailOpen" size="720px" title="用例详情">
      <div v-if="detailItem" class="detail">
        <section class="detail-block">
          <h3>Excel 原始用例</h3>
          <dl class="info-grid">
            <dt>用例编号</dt>
            <dd>{{ detailItem.caseNo }}</dd>
            <dt>用例名称</dt>
            <dd>{{ detailItem.caseName }}</dd>
            <dt>目标页面</dt>
            <dd>{{ detailItem.source.caseInfo.targetUrl }}</dd>
            <dt>前置条件</dt>
            <dd>{{ detailItem.source.caseInfo.precondition || '-' }}</dd>
            <dt>预期结果</dt>
            <dd>{{ detailItem.source.caseInfo.expectedResult }}</dd>
          </dl>
        </section>

        <section class="detail-block">
          <h3>原始步骤</h3>
          <el-table :data="detailItem.source.steps" border stripe>
            <el-table-column prop="stepNo" label="序号" width="80" />
            <el-table-column prop="actionText" label="操作描述" min-width="220" />
            <el-table-column prop="targetText" label="目标对象" min-width="140" />
            <el-table-column label="数据引用" min-width="140">
              <template #default="{ row }">
                {{ row.dataKeys.join(', ') || '-' }}
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="detail-block">
          <h3>测试数据</h3>
          <el-table :data="detailItem.source.data" border stripe empty-text="暂无测试数据">
            <el-table-column prop="dataKey" label="数据标识" min-width="120" />
            <el-table-column prop="dataName" label="数据名称" min-width="140" />
            <el-table-column prop="dataValue" label="数据值" min-width="180" />
          </el-table>
        </section>

        <section class="detail-block">
          <h3>AI 生成步骤</h3>
          <el-table :data="getActionSteps(detailItem)" border stripe empty-text="暂无生成步骤">
            <el-table-column label="序号" width="80">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="动作" width="110">
              <template #default="{ row }">
                {{ formatDraftStepType(row.type) }}
              </template>
            </el-table-column>
            <el-table-column prop="text" label="说明" min-width="260" />
            <el-table-column label="置信度" width="100">
              <template #default="{ row }">
                <el-tag :type="formatAiLevel(row.confidence).type" effect="light">{{ formatAiLevel(row.confidence).label }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="detail-block">
          <h3>草稿检查</h3>
          <el-table :data="getCheckSteps(detailItem)" border stripe empty-text="暂无检查步骤">
            <el-table-column label="序号" width="80">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="检查方式" width="130">
              <template #default="{ row }">
                {{ formatDraftStepType(row.type) }}
              </template>
            </el-table-column>
            <el-table-column prop="text" label="检查内容" min-width="260" />
            <el-table-column label="置信度" width="100">
              <template #default="{ row }">
                <el-tag :type="formatAiLevel(row.confidence).type" effect="light">{{ formatAiLevel(row.confidence).label }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="detail-block">
          <h3>基础检查结果</h3>
          <el-alert :title="getReviewText(detailItem)" :closable="false" :type="detailItem.review?.summary.level === 'pass' ? 'success' : 'warning'" />
          <ul v-if="detailItem.review?.items.length" class="issue-list">
            <li v-for="issue in detailItem.review.items" :key="issue.id">{{ issue.message }}{{ issue.suggestion }}</li>
          </ul>
        </section>

        <section class="detail-block">
          <h3>风险提示</h3>
          <el-empty
            v-if="!detailItem.errorMessage && !detailItem.draft?.warnings.length && !detailItem.draft?.missingInfo.length"
            description="暂无风险提示"
          />
          <ul v-else class="issue-list">
            <li v-if="detailItem.errorMessage">{{ detailItem.errorMessage }}</li>
            <li v-for="warning in detailItem.draft?.warnings ?? []" :key="warning">{{ warning }}</li>
            <li v-for="info in detailItem.draft?.missingInfo ?? []" :key="info">{{ info }}</li>
          </ul>
        </section>

        <section v-if="detailItem.savedCaseKey" class="detail-block">
          <h3>保存结果</h3>
          <el-button type="primary" @click="openSavedCase(detailItem)">打开草稿用例</el-button>
        </section>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 28px;
}

.toolbar {
  align-items: flex-end;
  display: flex;
  flex: 0 0 auto;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 20px;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.back-btn {
  color: #315f8f;
  font-weight: 600;
  margin-left: -8px;
}

.back-btn:hover,
.back-btn:focus {
  background-color: #eef5fb;
  color: #24466b;
}

.summary-card {
  flex: 0 0 auto;
  margin-bottom: 20px;
}

.summary-grid {
  align-items: center;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(180px, 1.2fr) minmax(100px, 0.5fr) minmax(220px, 1fr) minmax(160px, 0.8fr);
}

.summary-grid div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.summary-grid span {
  color: #64748b;
  font-size: 12px;
}

.summary-grid strong {
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  display: grid;
  flex: 1;
  gap: 12px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
}

.list-head {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 2px;
}

.count-text {
  color: #64748b;
  flex: 0 0 auto;
  font-size: 13px;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
}

.row-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}

.row-actions :deep(.el-button) {
  margin-left: 0;
}

.pager {
  display: flex;
  justify-content: flex-end;
}

.detail {
  display: grid;
  gap: 18px;
}

.detail-block {
  display: grid;
  gap: 12px;
}

.detail-block h3 {
  font-size: 16px;
  margin: 0;
}

.info-grid {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  margin: 0;
  overflow: hidden;
}

.info-grid dt,
.info-grid dd {
  border-bottom: 1px solid #edf2f7;
  margin: 0;
  padding: 10px 12px;
}

.info-grid dt {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.info-grid dd {
  color: #1f2937;
  word-break: break-word;
}

.info-grid dt:last-of-type,
.info-grid dd:last-of-type {
  border-bottom: 0;
}

.issue-list {
  margin: 0;
  padding-left: 18px;
}

.issue-list li {
  line-height: 1.7;
}

@media (max-width: 980px) {
  .page {
    overflow: auto;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
