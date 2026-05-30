# Kendo 页面地图字段语义层设计

## 目标

当前 AI 导入已经支持页面地图、安全探索缓存和按 `uiLibrary` 生成动态提示词，但页面地图给 AI 的上下文仍以 `buttons/inputs/selects/links/navigation/tables` 平铺元素列表为主。对于 Kendo UI 表单，字段名称经常存在于同一字段容器内的 `label`，而控件本体没有 `aria-label`、`placeholder` 或标准 `label for` 关系，导致平台采集到的是控件当前值，例如 `---请选择---`，无法体现该下拉框归属于“取样类别”。

本设计目标是在保留现有页面地图状态缓存机制的基础上，为每个页面状态增加面向 AI 的字段语义层。平台负责识别字段容器、控件类型、字段名、当前值、候选定位器和 Kendo 元数据；AI 优先使用这些结构化字段生成草稿，减少基于可见文本的猜测。

## 已确认边界

- 保留现有页面地图概念：页面地图仍按环境、目标 URL、登录态、视口和 `uiLibrary` 缓存。
- 保留页面地图安全探索：平台继续根据导入步骤执行受控动作，发现静态初始页面未渲染的弹窗、菜单、页签和下拉状态，并缓存复用。
- 保留 `uiLibrary` 作为策略入口：`auto/native/kendo` 不只影响提示词，也影响采集策略、selector 候选和执行策略。
- 本次优先解决 Kendo 表单字段归属丢失、下拉 selector 不可靠、AI 误把当前值当字段名的问题。
- AI 仍只生成草稿，不直接操作浏览器，不执行保存、提交、删除、审批等高风险动作。
- 兼容旧页面地图和旧 `elements` 结构，不要求一次性迁移历史缓存。

## 暂不处理

- 不引入完整 HTML 作为模型输入。
- 不做通用视觉识别或截图 OCR。
- 不把 Kendo 官方所有组件一次性全量覆盖；先覆盖导入用例高频表单控件。
- 不让 AI 自主探索页面，也不让 AI 决定新增探索动作。
- 不把用户模板里的一个 `select` 步骤拆成多个 `click` 步骤暴露给用户。

## 现状问题

当前传给 AI 的页面地图由 `summarizePageMap()` 压缩生成，结构类似：

```json
{
  "mapId": "pm-xxx",
  "targetUrl": "/web/IMQM07",
  "uiLibrary": "kendo",
  "states": [
    {
      "stateId": "state-initial",
      "name": "初始页面",
      "actionName": "新增",
      "page": {
        "url": "...",
        "title": "取样规则管理(IMQM07)",
        "headings": []
      },
      "elements": {
        "buttons": [],
        "inputs": [],
        "selects": [
          {
            "text": "---请选择---",
            "locator": "getByLabel('---请选择---')",
            "unique": false
          }
        ],
        "links": [],
        "navigation": [],
        "tables": []
      },
      "warnings": []
    }
  ]
}
```

该结构对普通按钮和链接仍可用，但对 Kendo 表单不够。以“取样类别”为例，真实 DOM 中 `label` 和 Kendo 下拉控件位于同一字段容器内：

```html
<div class="i-col i-col-12 i-select xr-fc">
  <div class="i-row">
    <div class="i-col i-col-8 i-input-inner-left">
      <label><span class="i-input-required">*</span><span>取样类别</span></label>
    </div>
    <div class="i-col i-col-16">
      <span class="k-picker k-dropdownlist" role="combobox" aria-controls="edit-0-sampleType_listbox">
        <span class="k-input-value-text">---请选择---</span>
        <input id="edit-0-sampleType" name="edit-0-sampleType" data-role="dropdownlist" style="display: none;">
      </span>
    </div>
  </div>
</div>
```

控件自身没有稳定可访问名称，`---请选择---` 只是当前显示值，不是字段名。当前采集算法把当前值当成 selector 依据，会造成 AI 上下文错误。

## 目标结构

在 `PageContext` 中新增 `fields` 语义层，旧 `elements` 继续保留：

```ts
interface PageContext {
  page: PageInfo;
  elements: PageElements;
  fields?: PageField[];
  uiLibrary?: UiLibrary;
  warnings: string[];
}

interface PageField {
  name: string;
  type: TargetType;
  ui?: string;
  required?: boolean;
  value?: string;
  state?: 'enabled' | 'disabled' | 'readonly';
  locators: PageLocator[];
  attrs?: Record<string, string>;
  options?: PageOption[];
  source: 'label-container' | 'native-label' | 'aria' | 'heuristic';
  confidence: AiLevel;
}

interface PageLocator {
  selector: string;
  kind: 'role' | 'label' | 'field-container' | 'attr' | 'text';
  unique: boolean;
  confidence: AiLevel;
  reason?: string;
}

interface PageOption {
  text: string;
  value?: string;
  locator?: string;
}
```

示例输出：

```json
{
  "name": "取样类别",
  "type": "select",
  "ui": "kendo-dropdownlist",
  "required": true,
  "value": "---请选择---",
  "source": "label-container",
  "confidence": "high",
  "attrs": {
    "inputId": "edit-0-sampleType",
    "inputName": "edit-0-sampleType",
    "ariaControls": "edit-0-sampleType_listbox",
    "dataRole": "dropdownlist"
  },
  "locators": [
    {
      "selector": "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist,[role=\"combobox\"]')",
      "kind": "field-container",
      "unique": true,
      "confidence": "high",
      "reason": "字段名来自同一字段容器内的 label"
    }
  ],
  "options": []
}
```

## Kendo 采集策略

当 `uiLibrary` 为 `kendo` 时，启用 Kendo 字段采集策略。当 `uiLibrary` 为 `auto` 时，如果页面出现 Kendo 特征类或 `data-role`，也启用该策略。当 `uiLibrary` 为 `native` 时，不主动采集 Kendo 字段。

Kendo 字段采集分为四步：

1. 识别候选控件。
   - 下拉：`.k-dropdownlist`、`.k-combobox`、`.k-picker[role="combobox"]`、`[data-role="dropdownlist"]` 的可见包装控件。
   - 多选或树形选择：`.k-multiselect`、`.k-dropdowntree`、`[role="combobox"]` 且同容器有 Kendo 输入结构。
   - 输入增强控件：`.k-numerictextbox`、`.k-datepicker`、`.k-datetimepicker`、`.k-timepicker`。

2. 从控件反向定位字段容器。
   - 优先向上查找 `.xr-fc`、`.i-select`、`.i-input`、`.el-form-item`、`.ant-form-item`、`.form-row`、`.field-row`。
   - 字段容器内存在 `label` 时读取 label 文本，去掉必填星号和冒号。
   - 如果没有 label，再读取 `aria-label`、`aria-labelledby`、`title`、隐藏 input 的 `name/id` 作为低置信兜底。

3. 读取控件元数据。
   - 当前值：`.k-input-value-text`、`.k-input-inner`、`.k-input` 中的可见文本。
   - 控件类型：根据 Kendo class、`data-role`、`role` 推断为 `kendo-dropdownlist`、`kendo-combobox` 等。
   - 属性：`id`、`name`、`data-role`、`aria-controls`、`aria-expanded`、`aria-disabled`、`aria-readonly`。
   - 状态：根据 `k-disabled`、`aria-disabled`、`aria-readonly` 标记 disabled 或 readonly。

4. 生成候选定位器。
   - 首选字段容器定位器：字段容器包含字段名，容器内定位 Kendo 控件。
   - 如果隐藏 input 的 `name/id` 稳定，可生成属性定位器作为次选。
   - 不把当前值作为字段定位器的主要依据。
   - 所有候选都做现场 count 校验，写入 `unique`。

## 页面地图与探索关系

页面地图仍由多个状态组成，每个状态保存一份 `PageContext` 快照。新增 `fields` 后，每个状态都有自己的字段语义层：

```json
{
  "stateId": "state-002",
  "name": "新增后页面",
  "actionName": "新增",
  "context": {
    "page": {},
    "elements": {},
    "fields": []
  }
}
```

安全探索继续使用模板步骤生成动作。对于 Kendo 页面，探索成功后的弹窗字段会进入对应状态的 `fields`。AI 生成草稿时可以看到“初始页面”和“新增后页面”的不同字段集合。

对于 `targetType=select` 且 `inputValue` 非空的步骤，页面地图可以在后续迭代中尝试展开 Kendo 下拉采集 `options`。该动作仍属于受控安全探索，只读展开面板中的选项文本，不做保存或提交。第一步可以先完成字段归属和 trigger 定位，options 采集作为同一设计下的第二优先级实现。

## AI 输入结构

`summarizePageMap()` 需要优先传递 `fields`，并保留旧 `elements` 兜底：

```json
{
  "pageMap": {
    "uiLibrary": "kendo",
    "states": [
      {
        "stateId": "state-002",
        "name": "新增后页面",
        "actionName": "新增",
        "page": {},
        "fields": [
          {
            "name": "取样类别",
            "type": "select",
            "ui": "kendo-dropdownlist",
            "value": "---请选择---",
            "locators": []
          }
        ],
        "elements": {}
      }
    ]
  }
}
```

如果字段列表过长，摘要阶段优先保留与导入步骤 `targetName`、`targetType`、`inputValue` 相关的字段，再保留高置信字段和初始状态字段。

## selector 补全规则

平台的确定性 selector 补全应优先使用 `fields`：

1. 用 `targetType` 筛选字段类型。
2. 用 `targetName` 精确匹配 `field.name`。
3. 精确匹配失败时，做包含匹配和去空白匹配。
4. 从 `field.locators` 中选择最高置信且唯一的候选。
5. 使用非初始状态字段时，在步骤 warnings 中说明来源状态。
6. 未找到字段时再回退旧 `elements`。

这能避免 AI 返回 `getByText('新增')` 或 `getByLabel('---请选择---')` 后无人修正。

## 提示词调整

动态提示词继续由 `uiLibrary` 控制，但语义应从“UI 库知识”调整为“如何使用页面地图字段”：

- `fields` 是平台从真实页面采集的字段语义，优先级高于自然语言推测。
- `field.name` 是测试人员可见的字段名，`field.value` 是当前值，不能把当前值当字段名。
- `targetType=select/input/date` 时优先匹配 `fields[].name`。
- 有 `field.locators` 时必须优先原样使用最高置信候选。
- Kendo 下拉即使输出步骤类型为 `select`，执行层会负责点击下拉控件并点击选项，不要拆成多个 click。
- 没有字段证据时才允许低置信推测，并写明人工确认风险。

## 前端展示

页面地图详情页应逐步展示字段语义层，方便排查 AI 输入是否可靠：

- 状态名称。
- 字段名、类型、UI 控件、当前值。
- 首选 selector。
- 是否唯一。
- 来源说明和 warnings。

第一版可以只在页面地图详情抽屉中展示，不影响导入预览主流程。

## 兼容策略

- 历史页面地图没有 `fields` 时，AI 输入仍使用旧 `elements`。
- 新页面地图同时保存 `fields` 和 `elements`。
- `PageElement` 可继续保持旧字段，避免大范围改动。
- `PageField` 作为新增结构进入 `PageContext`，不会破坏旧快照读取。
- `native` 模式下可从标准 label、placeholder、select 生成基础 `fields`，但不启用 Kendo 容器规则。
- `auto` 模式下检测到 Kendo 特征时，采集 Kendo 字段，并在 `uiLibrary` 或字段 `ui` 中体现实际识别结果。

## 测试计划

- 单元测试：Kendo 下拉字段容器识别，验证 `取样类别` 被采集为 `field.name`，`---请选择---` 被采集为 `field.value`。
- 单元测试：同名当前值的多个下拉不会生成 `getByLabel('---请选择---')` 作为首选 selector。
- 单元测试：`native` 模式不主动采集 Kendo 字段。
- 单元测试：`auto` 模式检测到 Kendo 控件时生成 Kendo 字段。
- 单元测试：selector 补全优先匹配 `fields`，找不到时回退 `elements`。
- 集成测试：页面地图多状态中，点击“新增”后的弹窗字段进入非初始状态，并能被草稿步骤引用。
- Prompt 测试：Kendo 模式 system prompt 包含 `fields` 使用规则和 Kendo select 执行语义。
- 全量检查：运行 `rtk npm test`、`rtk npm run typecheck`、`rtk npm run build`。

## 风险与缓解

- 字段容器选择过宽可能把多个字段合并。缓解方式是优先选择最近且包含单个 Kendo 控件的 `.xr-fc/.i-select/.i-input` 容器，并对异常容器降低置信度。
- `inputId` 中包含行号或动态前缀，不适合作为唯一首选。缓解方式是把字段容器 selector 作为首选，属性 selector 作为次选。
- Kendo popup 选项可能渲染在 body 末尾，不在字段容器内。缓解方式是通过 `aria-controls` 关联 popup，后续 options 采集使用该属性。
- 页面地图缓存中旧策略和新策略并存。缓解方式是 `fields` 缺失时继续走旧 `elements`，并建议用户刷新页面地图获得更高正确率。

## 实施建议

建议分三步实施：

1. 增加 `PageField` 数据结构和 Kendo 字段采集，先解决字段归属丢失。
2. 改造 AI 输入摘要、selector 补全和提示词，让草稿生成优先使用 `fields`。
3. 增强 Kendo 下拉 options 展开采集和页面地图详情展示，提高选择值匹配和问题可诊断性。
