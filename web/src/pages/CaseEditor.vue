<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CaseMeta, CaseStep, StepType } from '../../../shared/types';
import { getCase, updateCase } from '../api/cases';

const route = useRoute();
const router = useRouter();
const projectKey = String(route.params.projectKey);
const caseKey = String(route.params.caseKey);
const item = ref<CaseMeta | null>(null);
const stepTypes: StepType[] = ['click', 'fill', 'wait', 'assertText', 'assertVisible', 'assertUrl', 'assertTitle'];

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
 * 保存用例并重新生成测试文件。
 */
async function saveCase() {
  if (!item.value) {
    return;
  }

  item.value = await updateCase(projectKey, caseKey, item.value);
}

onMounted(loadCase);
</script>

<template>
  <section class="page" v-if="item">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push(`/projects/${projectKey}`)">返回项目</el-button>
        <h2>{{ item.name }}</h2>
      </div>
      <el-button type="primary" @click="saveCase">保存并生成测试文件</el-button>
    </div>

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

    <el-table :data="item.steps" border>
      <el-table-column prop="type" label="步骤类型" width="130" />
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

.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
</style>
