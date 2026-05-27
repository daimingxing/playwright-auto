<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  buildLocatorSelector,
  createDefaultLocatorState,
  locatorModes,
  roleOptions,
  type LocatorBuilderState,
  type LocatorMode,
  type LocatorTextKind,
  type LocatorTextValue,
  type SimpleLocatorState,
} from "../pages/locator-builder/locator-builder";

type TextField = "value" | "description" | "hasText" | "hasNotText";
type SimpleField = "has" | "hasNot";
type SimpleTextField = "value" | "description";

interface LocatorApplyPayload {
  selector: string;
  draft: LocatorBuilderState;
}

const props = defineProps<{
  modelValue: boolean;
  selector?: string;
  draft?: LocatorBuilderState;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  apply: [payload: LocatorApplyPayload];
}>();
const localOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const state = ref<LocatorBuilderState>(createDefaultLocatorState(props.selector ?? ""));
const previewSelector = computed(() => buildLocatorSelector(state.value));
const foldNames = ref<string[]>([]);
const visibleModel = computed<boolean | "">({
  get: () => state.value.visible ?? "",
  set: (value) => {
    if (value === "") {
      delete state.value.visible;
      return;
    }

    state.value.visible = value;
  },
});
const booleanRoleOptions = [
  { key: "checked", label: "选中" },
  { key: "disabled", label: "禁用" },
  { key: "expanded", label: "展开" },
  { key: "selected", label: "已选" },
  { key: "pressed", label: "按下" },
  { key: "includeHidden", label: "含隐藏" },
] as const;
const textKindOptions = [
  { label: "普通文本", value: "text" },
  { label: "正则", value: "regex" },
  { label: "正则字面量", value: "regexLiteral" },
] as const;
const simpleModes = locatorModes.filter((mode) => mode.value !== "advanced");

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      state.value = normalizeState(cloneState(props.draft) ?? createDefaultLocatorState(props.selector ?? ""));
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
  const draft = normalizeState(cloneState(state.value) ?? createDefaultLocatorState());
  emit("apply", {
    selector: buildLocatorSelector(draft),
    draft,
  });
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
 * 切换简单子定位器的定位方式。
 */
function changeSimpleMode(field: SimpleField, mode: string | number | boolean) {
  const current = state.value[field] ?? createSimpleState();
  state.value[field] = normalizeSimpleState({
    ...current,
    mode: String(mode) as SimpleLocatorState["mode"],
  });
}

/**
 * 启用 has 或 hasNot 简单子定位器。
 */
function enableSimple(field: SimpleField) {
  state.value[field] = createSimpleState();
}

/**
 * 清除 has 或 hasNot 简单子定位器。
 */
function clearSimple(field: SimpleField) {
  delete state.value[field];
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
 * 读取主定位器文本模式。
 */
function getTextKind(field: TextField) {
  return getTextValue(state.value[field]).kind;
}

/**
 * 读取主定位器文本内容。
 */
function getTextText(field: TextField) {
  return getTextValue(state.value[field]).text;
}

/**
 * 读取主定位器正则 flags。
 */
function getTextFlags(field: TextField) {
  return getTextValue(state.value[field]).flags ?? "";
}

/**
 * 更新主定位器文本模式。
 */
function changeTextKind(field: TextField, kind: string | number | boolean) {
  updateText(field, { kind: String(kind) as LocatorTextKind });
}

/**
 * 更新主定位器文本内容。
 */
function changeTextText(field: TextField, text: string | number) {
  updateText(field, { text: String(text) });
}

/**
 * 更新主定位器正则 flags。
 */
function changeTextFlags(field: TextField, flags: string | number) {
  updateText(field, { flags: String(flags) });
}

/**
 * 读取简单子定位器文本模式。
 */
function getSimpleTextKind(target: SimpleLocatorState | undefined, field: SimpleTextField) {
  return getTextValue(target?.[field]).kind;
}

/**
 * 读取简单子定位器文本内容。
 */
function getSimpleTextText(target: SimpleLocatorState | undefined, field: SimpleTextField) {
  return getTextValue(target?.[field]).text;
}

/**
 * 读取简单子定位器正则 flags。
 */
function getSimpleTextFlags(target: SimpleLocatorState | undefined, field: SimpleTextField) {
  return getTextValue(target?.[field]).flags ?? "";
}

/**
 * 更新简单子定位器文本模式。
 */
function changeSimpleTextKind(target: SimpleLocatorState, field: SimpleTextField, kind: string | number | boolean) {
  setSimpleText(target, field, { kind: String(kind) as LocatorTextKind });
}

/**
 * 更新简单子定位器文本内容。
 */
function changeSimpleTextText(target: SimpleLocatorState, field: SimpleTextField, text: string | number) {
  setSimpleText(target, field, { text: String(text) });
}

/**
 * 更新简单子定位器正则 flags。
 */
function changeSimpleTextFlags(target: SimpleLocatorState, field: SimpleTextField, flags: string | number) {
  setSimpleText(target, field, { flags: String(flags) });
}

/**
 * 按定位方式补齐默认值，避免模板绑定到空对象。
 */
function normalizeState(input: LocatorBuilderState): LocatorBuilderState {
  const next: LocatorBuilderState = {
    ...input,
    value: normalizeTextValue(input.value),
    description: normalizeOptionalText(input.description),
    hasText: normalizeOptionalText(input.hasText),
    hasNotText: normalizeOptionalText(input.hasNotText),
    indexMode: input.indexMode ?? "none",
  };

  if (next.mode === "role") {
    next.role = next.role || "button";
    next.roleOptions = next.roleOptions ?? {};
  }

  if (next.mode === "advanced") {
    next.advancedSelector = next.advancedSelector ?? props.selector ?? "";
  }

  if (next.has) {
    next.has = normalizeSimpleState(next.has);
  }

  if (next.hasNot) {
    next.hasNot = normalizeSimpleState(next.hasNot);
  }

  return next;
}

/**
 * 补齐简单子定位器默认值。
 */
function normalizeSimpleState(input: SimpleLocatorState): SimpleLocatorState {
  const next: SimpleLocatorState = {
    ...input,
    value: normalizeTextValue(input.value),
    description: normalizeOptionalText(input.description),
  };

  if (next.mode === "role") {
    next.role = next.role || "button";
  }

  return next;
}

/**
 * 创建默认简单子定位器。
 */
function createSimpleState(): SimpleLocatorState {
  return {
    mode: "role",
    role: "button",
    value: { kind: "text", text: "" },
  };
}

/**
 * 深拷贝构建器状态，避免直接修改父组件传入对象。
 */
function cloneState<T>(value: T | undefined): T | undefined {
  return value ? JSON.parse(JSON.stringify(value)) : undefined;
}

/**
 * 标准化必填文本值。
 */
function normalizeTextValue(value: string | LocatorTextValue | undefined): LocatorTextValue {
  return getTextValue(value);
}

/**
 * 标准化可选文本值。
 */
function normalizeOptionalText(value: string | LocatorTextValue | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }

  return getTextValue(value);
}

/**
 * 读取文本配置对象。
 */
function getTextValue(value: string | LocatorTextValue | undefined): LocatorTextValue {
  if (!value) {
    return { kind: "text", text: "" };
  }

  if (typeof value === "string") {
    return { kind: "text", text: value };
  }

  return {
    kind: value.kind ?? "text",
    text: value.text ?? "",
    flags: value.flags ?? "",
  };
}

/**
 * 更新主定位器文本字段。
 */
function updateText(field: TextField, patch: Partial<LocatorTextValue>) {
  state.value[field] = {
    ...getTextValue(state.value[field]),
    ...patch,
  };
}

/**
 * 更新简单子定位器文本字段。
 */
function setSimpleText(target: SimpleLocatorState, field: SimpleTextField, patch: Partial<LocatorTextValue>) {
  target[field] = {
    ...getTextValue(target[field]),
    ...patch,
  };
}
</script>

<template>
  <el-drawer v-model="localOpen" title="编辑定位器" size="850px" destroy-on-close>
    <div class="locator-builder">
      <el-form class="builder-form" label-width="96px">
        <el-form-item label="定位方式">
          <el-radio-group :model-value="state.mode" @change="changeMode">
            <el-radio-button v-for="mode in locatorModes" :key="mode.value" :value="mode.value">
              {{ mode.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <template v-if="state.mode !== 'advanced'">
          <section class="builder-section">
            <header>基础定位</header>
            <el-form-item v-if="state.mode === 'role'" label="角色">
              <el-select v-model="state.role" filterable>
                <el-option v-for="role in roleOptions" :key="role.value" :label="role.label" :value="role.value" />
              </el-select>
            </el-form-item>

            <el-form-item :label="state.mode === 'css' ? 'CSS' : '目标文本'">
              <div class="text-row">
                <el-select :model-value="getTextKind('value')" @change="(value) => changeTextKind('value', value)">
                  <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <el-input
                  :model-value="getTextText('value')"
                  :placeholder="state.mode === 'css' ? '.dialog .submit' : '保存'"
                  clearable
                  @input="(value) => changeTextText('value', value)"
                />
                <el-input
                  v-if="getTextKind('value') === 'regex'"
                  :model-value="getTextFlags('value')"
                  class="flag-input"
                  placeholder="flags"
                  @input="(value) => changeTextFlags('value', value)"
                />
              </div>
            </el-form-item>

            <el-form-item v-if="state.mode === 'role'" label="描述">
              <div class="text-row">
                <el-select
                  :model-value="getTextKind('description')"
                  @change="(value) => changeTextKind('description', value)"
                >
                  <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <el-input
                  :model-value="getTextText('description')"
                  placeholder="可访问描述，可留空"
                  clearable
                  @input="(value) => changeTextText('description', value)"
                />
                <el-input
                  v-if="getTextKind('description') === 'regex'"
                  :model-value="getTextFlags('description')"
                  class="flag-input"
                  placeholder="flags"
                  @input="(value) => changeTextFlags('description', value)"
                />
              </div>
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
                  <el-input-number v-model="getRoleOptions().level" :min="1" :max="6" :step="1" controls-position="right" />
                </div>
              </div>
            </el-form-item>
          </section>

          <el-collapse v-model="foldNames" class="builder-collapse">
            <el-collapse-item name="filters">
              <template #title>
                <span class="collapse-title">过滤条件</span>
                <span class="collapse-tip">匹配太多时使用</span>
              </template>
              <section class="builder-section is-folded">
                <el-form-item label="包含文本">
                  <div class="text-row">
                    <el-select :model-value="getTextKind('hasText')" @change="(value) => changeTextKind('hasText', value)">
                      <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                    <el-input :model-value="getTextText('hasText')" placeholder="订单编号" clearable @input="(value) => changeTextText('hasText', value)" />
                    <el-input
                      v-if="getTextKind('hasText') === 'regex'"
                      :model-value="getTextFlags('hasText')"
                      class="flag-input"
                      placeholder="flags"
                      @input="(value) => changeTextFlags('hasText', value)"
                    />
                  </div>
                </el-form-item>
                <el-form-item label="排除文本">
                  <div class="text-row">
                    <el-select :model-value="getTextKind('hasNotText')" @change="(value) => changeTextKind('hasNotText', value)">
                      <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                    <el-input
                      :model-value="getTextText('hasNotText')"
                      placeholder="已删除、停用"
                      clearable
                      @input="(value) => changeTextText('hasNotText', value)"
                    />
                    <el-input
                      v-if="getTextKind('hasNotText') === 'regex'"
                      :model-value="getTextFlags('hasNotText')"
                      class="flag-input"
                      placeholder="flags"
                      @input="(value) => changeTextFlags('hasNotText', value)"
                    />
                  </div>
                </el-form-item>
                <el-form-item label="可见性">
                  <el-select v-model="visibleModel" placeholder="不限">
                    <el-option label="不限" value="" />
                    <el-option label="只匹配可见" :value="true" />
                    <el-option label="只匹配隐藏" :value="false" />
                  </el-select>
                </el-form-item>

                <el-form-item label="包含元素">
                  <div class="simple-wrap">
                    <el-button v-if="!state.has" @click="enableSimple('has')">添加包含元素</el-button>
                    <template v-else>
                      <div class="simple-box">
                        <div class="simple-head">
                          <strong>包含元素</strong>
                          <el-button text type="danger" @click="clearSimple('has')">移除</el-button>
                        </div>
                        <el-form-item label="方式">
                          <el-select :model-value="state.has.mode" @change="(value) => changeSimpleMode('has', value)">
                            <el-option v-for="mode in simpleModes" :key="mode.value" :label="mode.label" :value="mode.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item v-if="state.has.mode === 'role'" label="角色">
                          <el-select v-model="state.has.role" filterable>
                            <el-option v-for="role in roleOptions" :key="role.value" :label="role.label" :value="role.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item :label="state.has.mode === 'css' ? 'CSS' : '文本'">
                          <div class="text-row">
                            <el-select
                              :model-value="getSimpleTextKind(state.has, 'value')"
                              @change="(value) => state.has && changeSimpleTextKind(state.has, 'value', value)"
                            >
                              <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                            </el-select>
                            <el-input
                              :model-value="getSimpleTextText(state.has, 'value')"
                              clearable
                              @input="(value) => state.has && changeSimpleTextText(state.has, 'value', value)"
                            />
                            <el-input
                              v-if="getSimpleTextKind(state.has, 'value') === 'regex'"
                              :model-value="getSimpleTextFlags(state.has, 'value')"
                              class="flag-input"
                              placeholder="flags"
                              @input="(value) => state.has && changeSimpleTextFlags(state.has, 'value', value)"
                            />
                          </div>
                        </el-form-item>
                      </div>
                    </template>
                  </div>
                </el-form-item>

                <el-form-item label="排除元素">
                  <div class="simple-wrap">
                    <el-button v-if="!state.hasNot" @click="enableSimple('hasNot')">添加排除元素</el-button>
                    <template v-else>
                      <div class="simple-box">
                        <div class="simple-head">
                          <strong>排除元素</strong>
                          <el-button text type="danger" @click="clearSimple('hasNot')">移除</el-button>
                        </div>
                        <el-form-item label="方式">
                          <el-select :model-value="state.hasNot.mode" @change="(value) => changeSimpleMode('hasNot', value)">
                            <el-option v-for="mode in simpleModes" :key="mode.value" :label="mode.label" :value="mode.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item v-if="state.hasNot.mode === 'role'" label="角色">
                          <el-select v-model="state.hasNot.role" filterable>
                            <el-option v-for="role in roleOptions" :key="role.value" :label="role.label" :value="role.value" />
                          </el-select>
                        </el-form-item>
                        <el-form-item :label="state.hasNot.mode === 'css' ? 'CSS' : '文本'">
                          <div class="text-row">
                            <el-select
                              :model-value="getSimpleTextKind(state.hasNot, 'value')"
                              @change="(value) => state.hasNot && changeSimpleTextKind(state.hasNot, 'value', value)"
                            >
                              <el-option v-for="item in textKindOptions" :key="item.value" :label="item.label" :value="item.value" />
                            </el-select>
                            <el-input
                              :model-value="getSimpleTextText(state.hasNot, 'value')"
                              clearable
                              @input="(value) => state.hasNot && changeSimpleTextText(state.hasNot, 'value', value)"
                            />
                            <el-input
                              v-if="getSimpleTextKind(state.hasNot, 'value') === 'regex'"
                              :model-value="getSimpleTextFlags(state.hasNot, 'value')"
                              class="flag-input"
                              placeholder="flags"
                              @input="(value) => state.hasNot && changeSimpleTextFlags(state.hasNot, 'value', value)"
                            />
                          </div>
                        </el-form-item>
                      </div>
                    </template>
                  </div>
                </el-form-item>

                <el-form-item label="匹配序号">
                  <div class="index-row">
                    <el-radio-group v-model="state.indexMode">
                      <el-radio-button value="none">不限</el-radio-button>
                      <el-radio-button value="first">第一个</el-radio-button>
                      <el-radio-button value="last">最后一个</el-radio-button>
                      <el-radio-button value="nth">指定</el-radio-button>
                    </el-radio-group>
                    <el-input-number v-if="state.indexMode === 'nth'" v-model="state.nth" :min="0" :step="1" controls-position="right" />
                  </div>
                </el-form-item>
              </section>
            </el-collapse-item>

            <el-collapse-item name="range">
              <template #title>
                <span class="collapse-title">高级范围</span>
                <span class="collapse-tip">需要 CSS 时使用</span>
              </template>
              <section class="builder-section is-folded">
                <el-form-item label="先限定区域">
                  <el-input v-model="state.scope" placeholder=".dialog、[data-testid='panel']" clearable />
                </el-form-item>
                <el-form-item label="结果内继续找">
                  <el-input v-model="state.childSelector" placeholder="button、.footer [data-testid='save']" clearable />
                </el-form-item>
              </section>
            </el-collapse-item>
          </el-collapse>
        </template>

        <el-form-item v-else label="选择器">
          <el-input
            v-model="state.advancedSelector"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 10 }"
            placeholder="当前表单无法表达时，可直接粘贴 Playwright 定位表达式"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="preview-bar">
        <span>生成结果</span>
        <code>{{ previewSelector || "未生成 selector" }}</code>
      </div>
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

.builder-form {
  padding-bottom: 8px;
}

.locator-builder :deep(.el-radio-group) {
  gap: 6px;
  flex-wrap: wrap;
}

.builder-section {
  padding: 12px 0 4px;
  border-top: 1px solid #e5edf5;
}

.builder-section:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.builder-section > header {
  margin: 0 0 12px 2px;
  color: #315f8f;
  font-size: 13px;
  font-weight: 700;
}

.builder-section.is-folded {
  padding: 8px 0 0;
  border-top: 0;
}

.builder-collapse {
  margin-top: 10px;
  border-top: 1px solid #e5edf5;
}

.builder-collapse :deep(.el-collapse-item__header) {
  gap: 8px;
  min-height: 44px;
  color: #1f2937;
  font-weight: 700;
}

.builder-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
}

.collapse-title {
  font-size: 13px;
  margin-right: 12px;
}

.collapse-tip {
  color: #8796aa;
  font-size: 12px;
  font-weight: 400;
}

.text-row {
  display: grid;
  width: 100%;
  grid-template-columns: 116px minmax(0, 1fr) 72px;
  gap: 8px;
}

.text-row .flag-input {
  width: 72px;
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

.simple-wrap,
.simple-box {
  width: 100%;
}

.simple-box {
  padding: 10px 12px;
  border: 1px solid #d8e2ed;
  border-radius: 8px;
  background: #f8fbfe;
}

.simple-head,
.index-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.simple-head {
  justify-content: space-between;
  margin-bottom: 8px;
}

.simple-head strong {
  color: #1f2937;
  font-size: 13px;
}

.preview-bar {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #d8e2ed;
  border-radius: 8px;
  background: #f8fbfe;
  text-align: left;
}

.preview-bar span {
  color: #5f7188;
  font-size: 13px;
  font-weight: 700;
}

.preview-bar code {
  max-height: 54px;
  overflow: auto;
  overflow-wrap: anywhere;
  color: #315f8f;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 720px) {
  .text-row {
    grid-template-columns: 1fr;
  }

  .role-option-grid {
    grid-template-columns: 1fr;
  }
}
</style>
