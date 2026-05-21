<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { CaseMeta, CaseStep, StepType } from '../../../shared/types';
import { getCase, startRecord, stopRecord, updateCase } from '../api/cases';
import { getErrorMessage } from '../utils/error';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const caseKey = String(route.params.caseKey);
const item = ref<CaseMeta | null>(null);
const recordId = ref('');
const isRecording = ref(false);
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
const stepTypes: StepType[] = [
  'click',
  'rightClick',
  'doubleClick',
  'hover',
  'fill',
  'wait',
  'assertText',
  'assertVisible',
  'assertValue',
  'assertUrl',
  'assertTitle'
];
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
 * 新增一个步骤。
 */
function addStep(type: StepType) {
  if (!item.value) {
    return;
  }

  item.value.steps.push({
    id: crypto.randomUUID(),
    type,
    selector: type.includes('Url') || type.includes('Title') ? undefined : '',
    value: '',
    timeout: type === 'wait' ? 1000 : undefined
  });
}

/**
 * 删除一个步骤。
 */
function removeStep(step: CaseStep) {
  if (!item.value) {
    return;
  }

  item.value.steps = item.value.steps.filter((row) => row.id !== step.id);
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
          <el-button v-for="type in stepTypes" :key="type" size="small" @click="addStep(type)">添加 {{ type }}</el-button>
        </div>
      </div>

      <div class="table-wrap">
        <el-table :data="item.steps" border height="100%">
          <el-table-column prop="type" label="步骤类型" width="130" />
          <el-table-column label="审查" width="170">
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
              <el-input v-model="row.selector" placeholder="例如：#username" />
            </template>
          </el-table-column>
          <el-table-column label="输入值/断言值">
            <template #default="{ row }">
              <el-input v-model="row.value" placeholder="输入值或断言内容" />
            </template>
          </el-table-column>
          <el-table-column label="等待毫秒" width="150">
            <template #default="{ row }">
              <el-input-number v-model="row.timeout" :min="0" :step="500" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" type="danger" @click="removeStep(row)">删除</el-button>
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
  margin: 16px 0;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
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
