<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { TableInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowUp, CopyDocument, Delete, Finished, MoreFilled, Plus, Select } from '@element-plus/icons-vue';
import type { CaseMeta, CaseStep, EnvMeta, StepType } from '../../../shared/types';
import { getCase, startRecord, stopRecord, updateCase } from '../api/cases';
import { getAppStepConfig, getProject } from '../api/projects';
import { getErrorMessage } from '../utils/error';
import {
  canMoveSteps,
  copyStep,
  copySteps,
  formatStepType,
  getInsertIndex,
  getStartPreview,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  moveSteps,
  removeStep,
  removeSteps,
  stepGroups,
  stepLabels,
  stepTimeouts
} from './case-editor';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const caseKey = String(route.params.caseKey);
const item = ref<CaseMeta | null>(null);
const activeEnv = ref<EnvMeta | null>(null);
const stepConfig = ref(stepTimeouts);
const stepTable = ref<TableInstance>();
const recordId = ref('');
const isRecording = ref(false);
const isBatchMode = ref(false);
const selectedId = ref('');
const batchIds = ref<string[]>([]);
const highlightId = ref('');
const stepFlashMs = 180;
// 浏览器环境下 `window.setTimeout` 返回数值型定时器句柄，避免与 Node 的 `Timeout` 类型混淆。
let highlightTimer: number | undefined;
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
  info: 'info'
} as const;
const reviewMap = computed(() => {
  const map = new Map<string, NonNullable<CaseMeta['review']>['items']>();

  for (const review of item.value?.review?.items ?? []) {
    const items = map.get(review.stepId) ?? [];
    items.push(review);
    map.set(review.stepId, items);
  }

  return map;
});
const hasBatch = computed(() => batchIds.value.length > 0);
const canBatchUp = computed(() => (item.value ? canMoveSteps(item.value.steps, batchIds.value, -1) : false));
const canBatchDown = computed(() => (item.value ? canMoveSteps(item.value.steps, batchIds.value, 1) : false));
const startPreview = computed(() => getStartPreview(item.value, activeEnv.value));

/**
 * 加载当前用例。
 */
async function loadCase() {
  const [caseInfo, config, project] = await Promise.all([
    getCase(projectKey, caseKey),
    getAppStepConfig(),
    getProject(projectKey)
  ]);
  item.value = caseInfo;
  stepConfig.value = config.steps.timeouts;
  activeEnv.value = project.envs.find((env) => env.key === project.defaultEnv) ?? project.envs[0] ?? null;
}

/**
 * 按当前选中位置新增一个步骤。
 */
function addStep(type: StepType) {
  if (!item.value) {
    return;
  }

  const row = insertStep(item.value.steps, getInsertIndex(item.value.steps, selectedId.value), type, stepConfig.value);
  setActiveStep(row);
}

/**
 * 删除一个步骤。
 */
function deleteStep(index: number) {
  if (!item.value) {
    return;
  }

  const row = item.value.steps[index];
  removeStep(item.value.steps, index);

  if (row?.id === selectedId.value) {
    selectedId.value = '';
  }
}

/**
 * 进入或退出批量操作模式。
 */
function toggleBatchMode() {
  isBatchMode.value = !isBatchMode.value;

  if (!isBatchMode.value) {
    clearBatch();
  }
}

/**
 * 同步表格多选状态。
 */
function updateBatch(rows: CaseStep[]) {
  batchIds.value = rows.map((row) => row.id);
}

/**
 * 清空批量选择。
 */
function clearBatch() {
  batchIds.value = [];
  stepTable.value?.clearSelection();
}

/**
 * 全选当前所有步骤。
 */
async function selectAllSteps() {
  if (!item.value) {
    return;
  }

  await nextTick();
  stepTable.value?.clearSelection();

  for (const row of item.value.steps) {
    stepTable.value?.toggleRowSelection(row, true);
  }

  batchIds.value = item.value.steps.map((row) => row.id);
}

/**
 * 批量删除选中的步骤。
 */
async function deleteBatch() {
  if (!item.value || !hasBatch.value) {
    return;
  }

  try {
    await ElMessageBox.confirm(`确认删除选中的 ${batchIds.value.length} 个步骤吗？`, '批量删除', { type: 'warning' });
    const removed = removeSteps(item.value.steps, batchIds.value);
    clearBatch();

    if (removed.some((row) => row.id === selectedId.value)) {
      selectedId.value = '';
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error));
    }
  }
}

/**
 * 批量复制选中的步骤。
 */
function duplicateBatch() {
  if (!item.value || !hasBatch.value) {
    return;
  }

  const rows = copySteps(item.value.steps, batchIds.value);
  setActiveSteps(rows);
  clearBatch();
}

/**
 * 批量调整步骤顺序。
 */
function shiftBatch(offset: -1 | 1) {
  if (!item.value || !hasBatch.value) {
    return;
  }

  const rows = moveSteps(item.value.steps, batchIds.value, offset);
  setActiveSteps(rows);
}

/**
 * 复制一个步骤并插入到其后方。
 */
function duplicateStep(index: number) {
  if (!item.value) {
    return;
  }

  const row = copyStep(item.value.steps, index);
  setActiveStep(row);
}

/**
 * 调整步骤顺序。
 */
function shiftStep(index: number, offset: -1 | 1) {
  if (!item.value) {
    return;
  }

  const row = moveStep(item.value.steps, index, offset);
  setActiveStep(row);
}

/**
 * 设置当前焦点步骤和短暂高亮。
 */
function setActiveStep(step?: CaseStep) {
  if (!step) {
    return;
  }

  selectedId.value = step.id;
  highlightId.value = step.id;

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  // 高亮时长与 CSS 动画保持一致，避免移动后视觉反馈拖沓。
  highlightTimer = window.setTimeout(() => {
    highlightId.value = '';
  }, stepFlashMs);
}

/**
 * 设置多个步骤的短暂高亮。
 */
function setActiveSteps(steps: CaseStep[]) {
  const first = steps[0];

  if (!first) {
    return;
  }

  selectedId.value = first.id;
  highlightId.value = first.id;

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  // 批量操作先高亮第一条受影响步骤，避免多个动画同时闪烁造成干扰。
  highlightTimer = window.setTimeout(() => {
    highlightId.value = '';
  }, stepFlashMs);
}

/**
 * 单击行时切换当前步骤焦点。
 */
function selectStep(row: CaseStep) {
  selectedId.value = row.id;
}

/**
 * 生成步骤行的状态类名。
 */
function getRowClass({ row }: { row: CaseStep }) {
  const classes: string[] = [];

  if (row.id === selectedId.value) {
    classes.push('is-selected-step');
  }

  if (row.id === highlightId.value) {
    classes.push('is-step-flash');
  }

  return classes.join(' ');
}

/**
 * 获取步骤对应的审查结果。
 */
function getStepReviews(step: CaseStep) {
  return reviewMap.value.get(step.id) ?? [];
}

/**
 * 保存用例并重新生成测试文件。
 */
async function saveCase() {
  if (!item.value) {
    return;
  }

  item.value = await updateCase(projectKey, caseKey, item.value);
  await router.push(`/projects/${projectKey}`);
}

/**
 * 启动有头浏览器录制当前用例。
 */
async function startRecordCase() {
  try {
    await ElMessageBox.confirm(
      '录制完成后会用录制结果覆盖当前步骤，请确认当前改动已保存。',
      '开始录制',
      { type: 'warning' }
    );

    const result = await startRecord(projectKey, caseKey);
    recordId.value = result.sessionId;
    isRecording.value = true;
    ElMessage.success('录制窗口已打开，请在浏览器中完成操作和断言');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error));
    }
  }
}

/**
 * 停止录制并导入录制步骤。
 */
async function stopRecordCase() {
  if (!recordId.value) {
    return;
  }

  try {
    item.value = await stopRecord(projectKey, caseKey, recordId.value);
    recordId.value = '';
    isRecording.value = false;
    ElMessage.success('录制结果已导入当前用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(loadCase);
</script>

<template>
  <section class="page" v-if="item">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push(`/projects/${projectKey}`)">返回用例管理</el-button>
        <h2>{{ item.name }}</h2>
      </div>
      <div class="toolbar-actions">
        <el-button v-if="!isRecording" @click="startRecordCase">开始录制</el-button>
        <el-button v-else type="warning" @click="stopRecordCase">停止录制</el-button>
        <el-button type="primary" :disabled="isRecording" @click="saveCase">保存并生成测试文件</el-button>
      </div>
    </div>

    <div class="content">
      <div class="meta">
        <el-alert
          v-if="isRecording"
          class="record-alert"
          title="正在录制，请在有头浏览器中完成操作和断言，完成后点击停止录制。"
          type="warning"
          show-icon
          :closable="false"
        />

        <el-form label-width="90px">
          <el-form-item label="用例名称">
            <el-input v-model="item.name" />
          </el-form-item>
          <el-form-item label="起始路径">
            <el-input v-model="item.startPath" />
          </el-form-item>
          <el-form-item label="实际地址">
            <div class="start-preview">{{ startPreview }}</div>
          </el-form-item>
        </el-form>

        <div class="step-actions">
          <el-dropdown trigger="click" @command="(type) => addStep(type as StepType)">
            <el-button type="primary">
              <el-icon><Plus /></el-icon>
              <span>添加步骤</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu class="step-menu">
                <template v-for="group in stepGroups" :key="group.label">
                  <el-dropdown-item class="step-menu-title" disabled>{{ group.label }}</el-dropdown-item>
                  <el-dropdown-item v-for="type in group.types" :key="type" :command="type">
                    <span class="step-menu-label">{{ stepLabels[type] }}</span>
                    <span class="step-menu-code">{{ type }}</span>
                  </el-dropdown-item>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span class="insert-hint">
            {{ selectedId ? '将插入到选中步骤后方' : '未选中步骤时追加到末尾' }}
          </span>
          <el-divider direction="vertical" />
          <template v-if="!isBatchMode">
            <el-button :icon="Select" @click="toggleBatchMode">批量操作</el-button>
          </template>
          <template v-else>
            <span class="batch-count">已选 {{ batchIds.length }} 条</span>
            <el-button :icon="Finished" @click="selectAllSteps">全选</el-button>
            <el-button :icon="ArrowUp" :disabled="!canBatchUp" @click="shiftBatch(-1)">上移</el-button>
            <el-button :icon="ArrowDown" :disabled="!canBatchDown" @click="shiftBatch(1)">下移</el-button>
            <el-button :icon="CopyDocument" :disabled="!hasBatch" @click="duplicateBatch">复制</el-button>
            <el-button :icon="Delete" type="danger" plain :disabled="!hasBatch" @click="deleteBatch">删除</el-button>
            <el-button @click="toggleBatchMode">取消批量</el-button>
          </template>
        </div>
      </div>

      <div class="table-wrap">
        <el-table
          ref="stepTable"
          :data="item.steps"
          border
          height="100%"
          row-key="id"
          :row-class-name="getRowClass"
          @row-click="selectStep"
          @selection-change="updateBatch"
        >
          <el-table-column v-if="isBatchMode" type="selection" width="44" reserve-selection />
          <el-table-column label="步骤类型" width="120">
            <template #default="{ row }">
              <div class="step-type">
                <strong>{{ formatStepType(row.type).label }}</strong>
                <span>{{ formatStepType(row.type).code }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="审查" width="80">
            <template #default="{ row }">
              <div v-if="getStepReviews(row).length > 0" class="review-tags">
                <el-popover
                  v-for="review in getStepReviews(row)"
                  :key="review.id"
                  placement="top"
                  width="320"
                  trigger="hover"
                >
                  <template #reference>
                    <el-tag :type="reviewTypes[review.level]" effect="light">{{ reviewLabels[review.level] }}</el-tag>
                  </template>
                  <div class="review-popover">
                    <strong>{{ review.message }}</strong>
                    <p>{{ review.suggestion }}</p>
                  </div>
                </el-popover>
              </div>
              <span v-else class="review-pass">通过</span>
            </template>
          </el-table-column>
          <el-table-column label="选择器">
            <template #default="{ row }">
              <el-input v-if="hasSelector(row.type)" v-model="row.selector" placeholder="例如：#username" />
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="输入值/断言值">
            <template #default="{ row }">
              <el-input v-if="hasValue(row.type)" v-model="row.value" placeholder="输入值或断言内容" />
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="等待毫秒" width="180">
            <template #default="{ row }">
              <el-input-number v-if="hasTimeout(row.type)" v-model="row.timeout" :min="0" :step="500" />
              <span v-else class="field-empty">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ $index }">
              <div class="row-actions">
                <el-tooltip content="上移" placement="top" :show-after="500" :hide-after="0">
                  <el-button text circle :disabled="$index === 0" @click="shiftStep($index, -1)">
                    <el-icon><ArrowUp /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="下移" placement="top" :show-after="500" :hide-after="0">
                  <el-button text circle :disabled="$index === item.steps.length - 1" @click="shiftStep($index, 1)">
                    <el-icon><ArrowDown /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="复制" placement="top" :show-after="500" :hide-after="0">
                  <el-button text circle @click="duplicateStep($index)">
                    <el-icon><CopyDocument /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-dropdown
                  trigger="click"
                  popper-class="step-more-menu"
                  @command="(command) => command === 'delete' && deleteStep($index)"
                >
                  <el-button text circle title="更多" @click.stop>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item :icon="Delete" command="delete" class="danger-action">
                        删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
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
  background: #f4f8fc;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  align-items: flex-start;
}

.toolbar h2 {
  margin: 8px 0 0;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, auto) minmax(180px, 1fr);
  gap: 16px;
  overflow: hidden;
}

.meta {
  min-height: 0;
  max-height: min(260px, 36vh);
  overflow: auto;
  padding-right: 4px;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 16px 0;
}

.insert-hint {
  color: #5f7188;
  font-size: 13px;
}

.start-preview {
  width: 100%;
  min-height: 32px;
  padding: 6px 11px;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  border: 1px solid #d8e2ed;
  border-radius: 6px;
  background: #eef5fb;
  color: #315f8f;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.45;
}

.batch-count {
  padding: 0 8px;
  color: #315f8f;
  font-size: 13px;
  font-weight: 600;
}

.step-menu-label {
  display: inline-block;
  min-width: 72px;
  color: #1f2937;
}

.step-menu-code {
  color: #8796aa;
  font-size: 12px;
}

.step-menu-title {
  margin-top: 4px;
  color: #5f7188;
  font-weight: 600;
  cursor: default;
}

.step-type {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.25;
}

.step-type strong {
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}

.step-type span {
  color: #8796aa;
  font-size: 12px;
}

.row-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
}

.field-empty {
  color: #c0c4cc;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.table-wrap :deep(.el-table__row) {
  transition: background-color 160ms ease, transform 160ms ease;
}

.table-wrap :deep(.el-table__row.is-selected-step > td.el-table__cell) {
  background: #eaf4ff;
}

.table-wrap :deep(.el-table__row.is-step-flash > td.el-table__cell) {
  background: #dbeeff;
  animation: step-slide 180ms ease;
}

@keyframes step-slide {
  from {
    transform: translateY(-2px);
  }

  to {
    transform: translateY(0);
  }
}

.review-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.review-pass {
  color: #67c23a;
  font-size: 13px;
}

.review-popover p {
  margin: 8px 0 0;
  color: #606266;
  line-height: 1.5;
}
</style>

<style>
.step-more-menu .danger-action {
  --el-dropdown-menuItem-hover-color: #c93535;
  --el-dropdown-menuItem-hover-fill: #fff1f1;
  color: #d94747;
}

.step-more-menu .danger-action .el-icon {
  color: #d94747;
}

.step-more-menu .danger-action:hover,
.step-more-menu .danger-action:focus {
  background: #fff1f1;
  color: #c93535;
}

.step-more-menu .danger-action:hover .el-icon,
.step-more-menu .danger-action:focus .el-icon {
  color: #c93535;
}
</style>
