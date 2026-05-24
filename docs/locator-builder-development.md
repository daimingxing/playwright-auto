# 定位器构建器开发文档

## 背景

当前用例编辑页在步骤表中直接展示 selector 文本输入框。这个方式对熟悉 Playwright 的用户足够直接，但对没有代码背景的测试人员不友好，也会产生大量语法和 options 校验问题。

定位器构建器的目标是把常见 Playwright 定位方式变成 UI 表单选择，同时保留高级手写 selector。构建器不替代基础检查，基础检查仍负责兜底校验和质量提示。

## 目标

- 测试人员可以通过 UI 选择常用定位方式生成 selector。
- 技术用户仍可以切换到高级模式手写 selector。
- 步骤表不再把长 selector 输入框作为主要操作面。
- 不改变 `case.json` 的主存储格式，第一期仍保存最终 selector 字符串。
- 前端编辑预览和后端正式基础检查继续使用 `shared/case-review.ts`。

## 非目标

- 第一期不实现真实页面点选生成 selector。
- 第一期不引入 AI。
- 第一期不覆盖 Playwright 的全部定位 API。
- 第一期不改变 `case.spec.ts` 的生成逻辑。

## UI 设计

### 步骤表选择器列

步骤表中的选择器列改为轻量展示：

- 有 selector 的步骤显示一行摘要，例如 `角色 / button / 保存`、`文本 / 提交`、`高级选择器`。
- 摘要旁提供 `编辑定位` 按钮。
- 不需要 selector 的步骤仍显示 `-`。
- 基础检查列保持现有展示：错误、警告、建议、待检查和定位通过。

### 定位器构建器抽屉

点击 `编辑定位` 后打开右侧抽屉。抽屉结构：

1. 使用单选按钮组选择定位方式。
2. 中部展示当前定位方式对应的表单。
3. 下部展示高级链式增强。
4. 底部展示只读 selector 预览和操作按钮。

定位方式：

- 角色
- 文本
- 标签
- 占位符
- 测试 ID
- 标题
- 图片文本
- CSS
- 高级

操作按钮：

- `应用`：把生成结果写回步骤 selector，关闭抽屉，并触发当前步骤基础检查预览。
- `高级`：通过定位方式单选项切换到高级手写 selector。
- `取消`：不修改当前步骤。

### 各定位方式表单

#### 角色

字段：

- 角色：下拉框。常用角色置顶：`button`、`textbox`、`checkbox`、`radio`、`combobox`、`link`、`heading`、`dialog`、`option`。
- 名称：输入框。
- 精确匹配：开关。
- 状态约束：表单区域，包含 `checked`、`disabled`、`expanded`、`selected`、`pressed`、`level`、`includeHidden`。

生成示例：

```ts
getByRole('button', { name: '保存' })
getByRole('checkbox', { name: '订阅', checked: true })
```

#### 文本

字段：

- 文本内容：输入框。
- 精确匹配：开关。

生成示例：

```ts
getByText('提交')
getByText('提交', { exact: true })
```

#### 标签

字段：

- 标签文本：输入框。
- 精确匹配：开关。

生成示例：

```ts
getByLabel('用户名')
```

#### 占位符

字段：

- 占位符文本：输入框。
- 精确匹配：开关。

生成示例：

```ts
getByPlaceholder('请输入用户名')
```

#### 测试 ID

字段：

- 测试 ID：输入框。

生成示例：

```ts
getByTestId('submit-button')
```

#### 标题

字段：

- 标题文本：输入框。
- 精确匹配：开关。

生成示例：

```ts
getByTitle('关闭')
```

#### 图片文本

字段：

- 图片替代文本：输入框。
- 精确匹配：开关。

生成示例：

```ts
getByAltText('公司 Logo')
```

#### CSS

字段：

- CSS selector：输入框。

说明：

- CSS 是兜底方式，不作为推荐方式。
- CSS 继续走基础检查，例如裸标签、动态 id、DOM 顺序依赖仍会提示。

生成示例：

```ts
locator('.dialog .submit')
```

#### 高级

字段：

- selector 文本框。

说明：

- 高级模式保留当前手写能力。
- 高级模式下不做构建器字段校验，只做基础检查。

## 高级链式增强

高级链式增强默认折叠，第一期支持：

- 限定区域：在主定位器前增加 `locator('<区域 selector>').`。
- 包含文本：追加 `.filter({ hasText: '<文本>' })`。
- 第几个：追加 `.nth(<index>)`。
- 第一个：追加 `.first()`。
- 最后一个：追加 `.last()`。

组合示例：

```ts
locator('.dialog').getByRole('button', { name: '确认' })
locator('article').filter({ hasText: '订单' }).nth(0)
getByText('删除').first()
```

互斥规则：

- `第几个`、`第一个`、`最后一个` 三者互斥。
- 区域限定为空时不生成区域前缀。
- 包含文本为空时不生成 `filter`。

## 当前能力矩阵

本节记录当前项目已经放入选择器构建器 UI 的能力。未来扩展构建器时，应先更新本节，再同步检查 `docs/case-review-rules.md` 是否需要增加或调整规则。

### 基础定位方式

| UI 定位方式 | 生成表达式 | 已支持字段 | 备注 |
| --- | --- | --- | --- |
| 角色 | `getByRole(role, options)` | `role`、`name`、`exact`、角色状态约束 | 默认角色为 `button`。 |
| 文本 | `getByText(text, { exact })` | `text`、`exact` | 仅支持字符串文本，不支持正则。 |
| 标签 | `getByLabel(text, { exact })` | `text`、`exact` | 仅支持字符串文本，不支持正则。 |
| 占位符 | `getByPlaceholder(text, { exact })` | `text`、`exact` | 仅支持字符串文本，不支持正则。 |
| 测试 ID | `getByTestId(testId)` | `testId` | 仅支持字符串测试 ID，不支持正则。 |
| 标题 | `getByTitle(text, { exact })` | `text`、`exact` | 仅支持字符串文本，不支持正则。 |
| 图片文本 | `getByAltText(text, { exact })` | `text`、`exact` | 仅支持字符串文本，不支持正则。 |
| CSS | `locator(css)` | `css` | 作为兜底定位方式，质量风险继续交给基础检查提示。 |
| 高级 | 原样保存手写 selector | `advancedSelector` | 允许输入构建器暂未覆盖的 Playwright selector。 |

### 当前角色下拉

当前 UI 只放入高频角色，目的是降低非技术用户的选择负担：

| 中文名 | role |
| --- | --- |
| 按钮 | `button` |
| 文本框 | `textbox` |
| 复选框 | `checkbox` |
| 单选框 | `radio` |
| 下拉框 | `combobox` |
| 链接 | `link` |
| 标题 | `heading` |
| 弹窗 | `dialog` |
| 选项 | `option` |
| 表格 | `table` |
| 行 | `row` |
| 单元格 | `cell` |

### getByRole options

当前 UI 已支持：

| 字段 | 生成位置 | UI 控件 | 备注 |
| --- | --- | --- | --- |
| `name` | `getByRole(role, { name })` | 输入框 | 使用“目标文本”字段生成。 |
| `exact` | `getByRole(role, { exact })` | 开关 | 仅在开启时生成。 |
| `checked` | `getByRole(role, { checked })` | 是、否、不限 | 不限时不生成字段。 |
| `disabled` | `getByRole(role, { disabled })` | 是、否、不限 | 不限时不生成字段。 |
| `expanded` | `getByRole(role, { expanded })` | 是、否、不限 | 不限时不生成字段。 |
| `selected` | `getByRole(role, { selected })` | 是、否、不限 | 不限时不生成字段。 |
| `pressed` | `getByRole(role, { pressed })` | 是、否、不限 | 不限时不生成字段。 |
| `includeHidden` | `getByRole(role, { includeHidden })` | 是、否、不限 | 不限时不生成字段。 |
| `level` | `getByRole(role, { level })` | 数字输入 | 当前 UI 限制为 `1` 到 `6`。 |

当前基础检查允许但 UI 暂未支持：

| 字段 | Playwright 类型 | 未放入原因 |
| --- | --- | --- |
| `description` | `string | RegExp` | 使用频率较低，且需要和 `name` 的语义区分清楚。 |

### 链式能力

当前 UI 已支持的链式能力：

| UI 字段 | 生成表达式 | 生成顺序 | 备注 |
| --- | --- | --- | --- |
| 限定区域 | `locator(scope).<主定位器>` | 1 | 只支持 CSS 字符串区域。 |
| 包含文本 | `.filter({ hasText: text })` | 3 | 只支持字符串 `hasText`。 |
| 第几个 | `.nth(index)` | 4 | `index` 从 `0` 开始。 |
| 第一个 | `.first()` | 4 | 和 `nth`、`last` 互斥。 |
| 最后一个 | `.last()` | 4 | 和 `nth`、`first` 互斥。 |

链式生成顺序固定为：

1. 区域限定。
2. 主定位器。
3. `filter({ hasText })`。
4. `nth`、`first` 或 `last`。

## Playwright 支持但未放入 UI

本节基于当前项目锁定的 `@playwright/test` `1.60.0` 和本地类型定义 `node_modules/playwright-core/types/types.d.ts` 梳理。这里的能力并不等于都应该进入 UI；它们只是未来迭代候选项。

### 未放入 UI 的 role

Playwright `getByRole` 支持完整 ARIA role 清单。当前 UI 只放了常用子集，下面这些未放入角色下拉：

```text
alert
alertdialog
application
article
banner
blockquote
caption
code
columnheader
complementary
contentinfo
definition
deletion
directory
document
emphasis
feed
figure
form
generic
grid
gridcell
group
img
insertion
list
listbox
listitem
log
main
marquee
math
menu
menubar
menuitem
menuitemcheckbox
menuitemradio
navigation
none
note
paragraph
presentation
progressbar
radiogroup
region
rowgroup
rowheader
scrollbar
search
searchbox
separator
slider
spinbutton
status
strong
subscript
superscript
switch
tab
tablist
tabpanel
term
time
timer
toolbar
tooltip
tree
treegrid
treeitem
```

后续可以考虑把角色下拉改成“常用置顶 + 全量可搜索”，这样既不增加默认认知负担，又能支持高级用例。

### 未放入 UI 的参数类型

Playwright 多数文本类定位方法支持 `string | RegExp`，当前 UI 只支持字符串：

| 方法或字段 | Playwright 支持 | 当前 UI 状态 |
| --- | --- | --- |
| `getByText(text)` | `string | RegExp` | 只支持字符串。 |
| `getByLabel(text)` | `string | RegExp` | 只支持字符串。 |
| `getByPlaceholder(text)` | `string | RegExp` | 只支持字符串。 |
| `getByTestId(testId)` | `string | RegExp` | 只支持字符串。 |
| `getByTitle(text)` | `string | RegExp` | 只支持字符串。 |
| `getByAltText(text)` | `string | RegExp` | 只支持字符串。 |
| `getByRole(..., { name })` | `string | RegExp` | 只支持字符串。 |
| `getByRole(..., { description })` | `string | RegExp` | UI 未支持。 |
| `filter({ hasText })` | `string | RegExp` | 只支持字符串。 |
| `filter({ hasNotText })` | `string | RegExp` | UI 未支持。 |

如果未来增加正则输入，基础检查需要同步识别合法正则、空正则和容易过宽的正则。

### 未放入 UI 的 locator 和 filter options

Playwright 支持 `locator(selector, options)` 和 `filter(options)`，当前 UI 只覆盖了 `filter({ hasText })` 的字符串形式。

| 能力 | 示例 | 当前 UI 状态 |
| --- | --- | --- |
| `locator(selector, { has })` | `locator('article', { has: getByText('订单') })` | 未支持。 |
| `locator(selector, { hasNot })` | `locator('article', { hasNot: getByText('取消') })` | 未支持。 |
| `locator(selector, { hasText })` | `locator('article', { hasText: '订单' })` | 未支持；当前用链式 `filter({ hasText })` 表达。 |
| `locator(selector, { hasNotText })` | `locator('article', { hasNotText: '取消' })` | 未支持。 |
| `filter({ has })` | `locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })` | 未支持。 |
| `filter({ hasNot })` | `locator('tr').filter({ hasNot: getByText('禁用') })` | 未支持。 |
| `filter({ hasNotText })` | `locator('tr').filter({ hasNotText: '已删除' })` | 未支持。 |
| `filter({ visible })` | `locator('button').filter({ visible: true })` | 未支持。 |

`has` 和 `hasNot` 需要嵌套一个 Locator，UI 上建议先做成“子定位条件”区域，而不是简单文本框。

### 未放入 UI 的链式组合

| 能力 | 示例 | 当前 UI 状态 |
| --- | --- | --- |
| 子树继续定位 | `locator('.dialog').locator('button')` | 未支持。 |
| 交集定位 | `getByRole('button').and(getByTitle('保存'))` | 未支持。 |
| 并集定位 | `getByRole('button', { name: '新建' }).or(getByText('确认安全设置'))` | 未支持。 |
| iframe 定位 | `frameLocator('iframe').getByText('提交')` | 未支持。 |
| 从 locator 进入 iframe | `locator('iframe').contentFrame().getByRole('button')` | 未支持。 |
| 从 frameLocator 回到宿主元素 | `frameLocator('iframe').owner()` | 未支持。 |
| 规范化定位器 | `locator.normalize()` | 未支持。 |

其中 `normalize()` 是异步能力，需要真实页面上下文，不适合放入纯表单生成器第一阶段，更适合未来和页面 DOM 点选、候选 selector 评估一起做。

### 建议迭代优先级

| 优先级 | 能力 | 原因 | 需要同步的检查规则 |
| --- | --- | --- | --- |
| P1 | 全量 role 搜索，常用 role 置顶 | 成本低，能覆盖更多无障碍语义元素。 | role 白名单可以继续沿用 Playwright 全量 role。 |
| P1 | `description` | 已在基础检查白名单内，补 UI 成本低。 | 检查空字符串和正则形态。 |
| P1 | `filter({ visible })` | 表单简单，对多元素匹配很实用。 | 校验 `visible` 必须是布尔值。 |
| P2 | `hasNotText` | 和当前 `hasText` 成对，认知成本低。 | 校验空字符串和正则形态。 |
| P2 | 正则模式 | Playwright 原生支持，适合模糊匹配。 | 校验正则语法和过宽正则。 |
| P2 | `locator(selector, { hasText, hasNotText })` | 和链式 `filter` 有重叠，需要先设计 UI。 | 避免和链式过滤产生重复表达。 |
| P3 | `has`、`hasNot` 子定位条件 | 能力强，但 UI 复杂度明显提高。 | 校验嵌套 Locator 形态和同 frame 限制。 |
| P3 | `and`、`or` | 适合复杂条件，但容易生成难读 selector。 | 校验组合项必须是 Locator。 |
| P3 | `frameLocator`、`contentFrame` | 对 iframe 项目重要，但需要页面结构认知。 | 校验 iframe selector 和链路合法性。 |

## 数据策略

第一期不改变 `CaseStep` 结构，仍只保存：

```ts
selector?: string;
```

构建器的表单状态只存在于前端临时状态中。打开抽屉时：

- 如果 selector 能被构建器识别，则回填对应表单。
- 如果无法识别，则进入高级模式并展示原始 selector。

这样可以兼容录制导入、已有用例和手写 selector。

## 文件拆分

新增文件：

- `web/src/pages/locator-builder.ts`：负责定位器构建器的数据模型、生成 selector、尝试反解析 selector、展示摘要。
- `web/src/components/LocatorBuilderDrawer.vue`：负责抽屉 UI。
- `tests/web/locator-builder.test.ts`：测试生成、反解析和摘要逻辑。

修改文件：

- `web/src/pages/CaseEditor.vue`：把选择器列改为摘要和编辑按钮，挂载抽屉。
- `docs/case-review-rules.md`：记录构建器上线后检查器仍负责兜底的规则。

## 生成器模型

`locator-builder.ts` 中定义：

```ts
export type LocatorMode =
  | 'role'
  | 'text'
  | 'label'
  | 'placeholder'
  | 'testId'
  | 'title'
  | 'altText'
  | 'css'
  | 'advanced';

export interface LocatorBuilderState {
  mode: LocatorMode;
  value: string;
  exact?: boolean;
  role?: string;
  roleOptions?: {
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
    pressed?: boolean;
    includeHidden?: boolean;
    level?: number;
  };
  scope?: string;
  hasText?: string;
  indexMode?: 'none' | 'nth' | 'first' | 'last';
  nth?: number;
  advancedSelector?: string;
}
```

核心函数：

- `buildLocatorSelector(state: LocatorBuilderState): string`
- `parseLocatorSelector(selector: string): LocatorBuilderState`
- `formatLocatorSummary(selector: string): string`
- `createDefaultLocatorState(selector?: string): LocatorBuilderState`

## 生成规则

字符串值必须做转义，避免文本中包含单引号或反斜杠时生成非法 selector。当前实现统一生成单引号字符串字面量，并转义 `\` 与 `'`。

options 只在有有效字段时生成。示例：

```ts
getByText('提交')
getByText('提交', { exact: true })
```

链式增强按固定顺序生成：

1. 区域限定。
2. 主定位器。
3. `filter({ hasText })`。
4. `nth`、`first` 或 `last`。

## 与基础检查的关系

构建器减少错误输入，但不能替代基础检查。

构建器应用 selector 后必须：

- 调用现有 `markStepReviewPending(row)`。
- 停止编辑 400ms 后通过现有机制执行单步骤基础检查。
- 保存草稿、保存并生成测试文件、状态切换时仍由后端正式检查。

检查器规则需要继续更新：

- `locator`、`getByText`、`getByLabel`、`getByPlaceholder`、`getByTestId`、`getByTitle`、`getByAltText` 的首参不能为空，当前已由 `empty-locator-argument` 覆盖。
- `exact` 只允许布尔值，当前已由 `invalid-locator-option` 覆盖。
- `nth` 必须是非负整数，当前已由 `invalid-locator-argument` 覆盖。
- `locator` 的 CSS 参数为空时返回 `empty-locator-argument`，当前已覆盖。
- `has`、`hasNot` 后续再做 Locator 参数形态检查。

## 测试要求

### 单元测试

`tests/web/locator-builder.test.ts` 覆盖：

- 每种定位方式生成正确 selector。
- 文本包含单引号、双引号时能正确转义。
- 空 options 不生成第二参数。
- `exact: true` 正确生成。
- 区域限定、包含文本、nth、first、last 生成顺序正确。
- 识别不了的 selector 进入高级模式。
- 摘要展示对常见 selector 可读。

`tests/shared/case-review.test.ts` 覆盖：

- 构建器可能生成的 selector 全部通过基础语法和方法白名单。
- 空首参、非法 `exact`、非法 `nth` 被基础检查拦截。

### 前端测试

当前前端工具测试覆盖在 `tests/web/locator-builder.test.ts` 中。后续如果引入 Vue 组件挂载测试，再补充 CaseEditor 交互层断言：

- 应用新 selector 后步骤进入待检查。
- 高级模式仍保留原始 selector。

### 手动测试

在用例编辑页逐项验证：

1. 点击需要 selector 的步骤，打开定位器构建器。
2. 用角色方式生成 `getByRole('button', { name: '保存' })`。
3. 用文本方式生成 `getByText('提交', { exact: true })`。
4. 用 CSS 方式生成 `locator('.dialog .submit')`。
5. 切换到高级模式，手写 selector 并应用。
6. 确认步骤表显示摘要，基础检查显示待检查后更新。
7. 保存草稿和保存并生成测试文件均能保留 selector。

## 后续扩展

- 接入真实页面 DOM 后，增加页面点选能力。
- 从 DOM 提取候选 selector，并按稳定性排序。
- 对候选 selector 执行匹配数量检查。
- 增加 `and`、`or`、`frameLocator` 等高级链式能力。
