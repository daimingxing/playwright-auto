<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildLocatorSelector, createDefaultLocatorState, locatorModes, roleOptions, type LocatorBuilderState, type LocatorMode } from "../pages/locator-builder";

const props = defineProps<{
  modelValue: boolean;
  selector?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  apply: [selector: string];
}>();
const localOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const state = ref<LocatorBuilderState>(createDefaultLocatorState(props.selector ?? ""));
const previewSelector = computed(() => buildLocatorSelector(state.value));
const booleanRoleOptions = [
  { key: "checked", label: "选中" },
  { key: "disabled", label: "禁用" },
  { key: "expanded", label: "展开" },
  { key: "selected", label: "已选" },
  { key: "pressed", label: "按下" },
  { key: "includeHidden", label: "含隐藏" },
] as const;

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      state.value = normalizeState(createDefaultLocatorState(props.selector ?? ""));
    }
  },
);

/**
 * 关闭定位器构建器抽屉。
 */
function closeDrawer() {
  localOpen.value = false;
}

/**
 * 应用当前定位器配置到步骤。
 */
function applySelector() {
  emit("apply", previewSelector.value);
  closeDrawer();
}

/**
 * 切换定位方式并补齐当前模式需要的默认字段。
 */
function changeMode(mode: string | number | boolean) {
  const nextMode = String(mode) as LocatorMode;

  state.value = normalizeState({
    ...state.value,
    mode: nextMode,
    advancedSelector: nextMode === "advanced" ? previewSelector.value : state.value.advancedSelector,
  });
}

/**
 * 清理 role 状态布尔项，让未设置和 false 的含义保持可区分。
 */
function clearRoleOption(key: keyof NonNullable<LocatorBuilderState["roleOptions"]>) {
  if (!state.value.roleOptions) {
    return;
  }

  delete state.value.roleOptions[key];
}

/**
 * 生成模板可直接绑定的 role 状态对象。
 */
function getRoleOptions() {
  if (!state.value.roleOptions) {
    state.value.roleOptions = {};
  }

  return state.value.roleOptions;
}

/**
 * 按定位方式补齐默认值，避免模板绑定到空对象。
 */
function normalizeState(input: LocatorBuilderState): LocatorBuilderState {
  const next: LocatorBuilderState = {
    ...input,
    indexMode: input.indexMode ?? "none",
  };

  if (next.mode === "role") {
    next.role = next.role || "button";
    next.roleOptions = next.roleOptions ?? {};
  }

  if (next.mode === "advanced") {
    next.advancedSelector = next.advancedSelector ?? props.selector ?? "";
  }

  return next;
}
</script>

<template>
  <el-drawer v-model="localOpen" title="编辑定位器" size="520px" destroy-on-close>
    <div class="locator-builder">
      <el-form label-width="86px">
        <el-form-item label="定位方式">
          <el-radio-group :model-value="state.mode" @change="changeMode">
            <el-radio-button
              v-for="mode in locatorModes"
              :key="mode.value"
              :label="mode.value"
            >
              {{ mode.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <template v-if="state.mode !== 'advanced'">
          <el-form-item v-if="state.mode === 'role'" label="角色">
            <el-select v-model="state.role" filterable>
              <el-option
                v-for="role in roleOptions"
                :key="role.value"
                :label="role.label"
                :value="role.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item :label="state.mode === 'css' ? 'CSS' : '目标文本'">
            <el-input
              v-model="state.value"
              :placeholder="state.mode === 'css' ? '.dialog .submit' : '保存'"
              clearable
            />
          </el-form-item>

          <el-form-item v-if="state.mode !== 'css'" label="精确匹配">
            <el-switch v-model="state.exact" />
          </el-form-item>

          <el-form-item v-if="state.mode === 'role'" label="角色状态">
            <div class="role-option-grid">
              <div v-for="option in booleanRoleOptions" :key="option.key" class="role-option">
                <span>{{ option.label }}</span>
                <el-select
                  :model-value="getRoleOptions()[option.key]"
                  clearable
                  placeholder="不限"
                  @clear="clearRoleOption(option.key)"
                  @change="(value: boolean | '') => value === '' ? clearRoleOption(option.key) : getRoleOptions()[option.key] = value"
                >
                  <el-option label="是" :value="true" />
                  <el-option label="否" :value="false" />
                </el-select>
              </div>
              <div class="role-option">
                <span>标题级别</span>
                <el-input-number
                  v-model="getRoleOptions().level"
                  :min="1"
                  :max="6"
                  :step="1"
                  controls-position="right"
                />
              </div>
            </div>
          </el-form-item>

          <el-divider />

          <el-form-item label="限定区域">
            <el-input v-model="state.scope" placeholder=".dialog、[data-testid='panel']" clearable />
          </el-form-item>

          <el-form-item label="包含文本">
            <el-input v-model="state.hasText" placeholder="订单编号" clearable />
          </el-form-item>

          <el-form-item label="匹配序号">
            <div class="index-row">
              <el-radio-group v-model="state.indexMode">
                <el-radio-button label="none">不限</el-radio-button>
                <el-radio-button label="first">第一个</el-radio-button>
                <el-radio-button label="last">最后一个</el-radio-button>
                <el-radio-button label="nth">指定</el-radio-button>
              </el-radio-group>
              <el-input-number
                v-if="state.indexMode === 'nth'"
                v-model="state.nth"
                :min="0"
                :step="1"
                controls-position="right"
              />
            </div>
          </el-form-item>
        </template>

        <el-form-item v-else label="选择器">
          <el-input
            v-model="state.advancedSelector"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 10 }"
            placeholder="getByRole('button', { name: '保存' })"
          />
        </el-form-item>

        <el-form-item label="生成结果">
          <el-input :model-value="previewSelector" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" readonly />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="drawer-actions">
        <el-button @click="closeDrawer">取消</el-button>
        <el-button type="primary" @click="applySelector">应用</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.locator-builder {
  padding-right: 4px;
}

.locator-builder :deep(.el-radio-group) {
  gap: 6px;
  flex-wrap: wrap;
}

.role-option-grid {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.role-option {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  color: #5f7188;
  font-size: 13px;
}

.index-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
