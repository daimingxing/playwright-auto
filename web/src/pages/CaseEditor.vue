<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowUp, CopyDocument, Delete, MoreFilled, Plus } from '@element-plus/icons-vue';
import type { CaseMeta, CaseStep, StepType } from '../../../shared/types';
import { getCase, startRecord, stopRecord, updateCase } from '../api/cases';
import { getErrorMessage } from '../utils/error';
import {
  copyStep,
  formatStepType,
  getInsertIndex,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  removeStep,
  stepGroups,
  stepLabels
} from './case-editor';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const caseKey = String(route.params.caseKey);
const item = ref<CaseMeta | null>(null);
const recordId = ref('');
const isRecording = ref(false);
const selectedId = ref('');
const highlightId = ref('');
const stepFlashMs = 180;
let highlightTimer: ReturnType<typeof window.setTimeout> | undefined;
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

/**
 * 加载当前用例。
 */
async function loadCase() {
  item.value = await getCase(projectKey, caseKey);
}

/**
 * 按当前选中位置新增一个步骤。
 */
function addStep(type: StepType) {
  if (!item.value) {
    return;
  }

  const row = insertStep(item.value.steps, getInsertIndex(item.value.steps, selectedId.value), type);
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
        </div>
      </div>

      <div class="table-wrap">
        <el-table
          :data="item.steps"
          border
          height="100%"
          row-key="id"
          :row-class-name="getRowClass"
          @row-click="selectStep"
        >
          <el-table-column label="步骤类型" width="150">
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
          <el-table-column label="操作" width="160">
            <template #default="{ $index }">
              <div class="row-actions">
                <el-tooltip content="上移" placement="top">
                  <el-button text circle :disabled="$index === 0" @click="shiftStep($index, -1)">
                    <el-icon><ArrowUp /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="下移" placement="top">
                  <el-button text circle :disabled="$index === item.steps.length - 1" @click="shiftStep($index, 1)">
                    <el-icon><ArrowDown /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="复制" placement="top">
                  <el-button text circle @click="duplicateStep($index)">
                    <el-icon><CopyDocument /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-dropdown>
                  <el-tooltip content="更多" placement="top">
                    <el-button text circle>
                      <el-icon><MoreFilled /></el-icon>
                    </el-button>
                  </el-tooltip>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item class="danger-action" @click="deleteStep($index)">
                        <el-icon><Delete /></el-icon>
                        <span>删除</span>
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

.danger-action {
  color: #d94747;
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
