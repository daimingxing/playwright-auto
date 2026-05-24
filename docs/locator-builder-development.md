# 定位器构建器开发文档

## 背景

用例编辑页面向没有代码背景的测试人员。直接手写 Playwright selector 容易产生语法、options 和稳定性问题，因此项目提供定位器构建器，把常用定位方式转换成表单操作，同时保留手写定位模式。

构建器不替代基础检查。构建器负责降低输入门槛，`shared/case-review.ts` 继续负责前端即时预览、后端保存、生成测试文件和状态切换时的兜底检查。

## 当前目标

- 测试人员可以通过 UI 选择常用定位方式生成 selector。
- 技术用户仍可以切换到手写定位模式手写 selector。
- 复杂 selector 再次打开时可以通过 `selectorDraft` 回填表单。
- 正式测试文件和实测检查脚本在存在 `selectorDraft` 时优先用结构化状态生成可执行 Locator 表达式。
- `selector` 字符串继续作为展示、兼容旧数据和基础检查的主字段。

## 非目标

- 当前不实现真实页面点选生成 selector。
- 当前不引入 AI。
- 当前不支持 `and()`、`or()`、iframe 链路和无限嵌套。
- 当前不让 `has` / `hasNot` 子定位器继续嵌套过滤条件。

## 文件入口

- `shared/locator-builder.ts`：构建器状态、role 清单、selector 生成、测试文件表达式生成、摘要和旧 selector 反解析。
- `web/src/pages/locator-builder.ts`：前端转出口，供页面和测试稳定导入。
- `web/src/components/LocatorBuilderDrawer.vue`：构建器抽屉 UI。
- `web/src/pages/CaseEditor.vue`：选择器列展示、打开抽屉、写回 `selector` 和 `selectorDraft`。
- `server/src/services/case-generator.ts`：正式 `case.spec.ts` 生成。
- `server/src/services/practical-review-spec.ts`：实测检查脚本生成。
- `shared/case-review.ts`：构建器生成结果和手写定位 selector 的基础检查规则。

## 数据结构

`CaseStep` 当前保存两个定位字段：

```ts
selector?: string;
selectorDraft?: LocatorBuilderState;
```

- `selector`：最终 Playwright selector 字符串，用于展示、基础检查、兼容录制导入和旧数据。
- `selectorDraft`：构建器结构化状态，用于 UI 回填和后端结构化生成。

打开构建器时：

1. 如果存在 `selectorDraft`，优先用它回填。
2. 如果没有 `selectorDraft`，尝试从 `selector` 反解析。
3. 如果反解析失败，进入手写定位模式并保留原始 selector。

应用构建器时：

1. 根据表单状态生成新的 `selector`。
2. 同步保存新的 `selectorDraft`。
3. 当前步骤进入待检查状态。
4. 停止编辑 400ms 后复用共享基础检查规则预览当前步骤。

复制步骤时会深拷贝 `selectorDraft`，避免复制后的步骤和原步骤共享嵌套对象。

## UI 结构

抽屉按操作语义分区：

- 定位方式：角色、文本、标签、占位符、测试 ID、标题、图片文本、CSS（高级）、手写定位。
- 基础定位：填写目标文本、role、description、exact 和 role 状态。
- 过滤条件：默认折叠，包含文本、排除文本、可见性、包含元素、排除元素、匹配序号。
- 高级范围：默认折叠，包含先限定区域、结果内继续找。
- 生成结果：固定展示在抽屉底部，避免长表单滚动时看不到最终 selector。

角色下拉支持全量 role 搜索，常用 role 置顶。

## 当前能力矩阵

### 基础定位方式

| UI 定位方式 | 生成表达式 | 当前能力 |
| --- | --- | --- |
| 角色 | `getByRole(role, options)` | 全量 role 搜索、`name`、`description`、`exact`、role 状态 options。 |
| 文本 | `getByText(text, options)` | 普通文本、正则、完整正则字面量、`exact`。 |
| 标签 | `getByLabel(text, options)` | 普通文本、正则、完整正则字面量、`exact`。 |
| 占位符 | `getByPlaceholder(text, options)` | 普通文本、正则、完整正则字面量、`exact`。 |
| 测试 ID | `getByTestId(testId)` | 普通文本、正则、完整正则字面量。 |
| 标题 | `getByTitle(text, options)` | 普通文本、正则、完整正则字面量、`exact`。 |
| 图片文本 | `getByAltText(text, options)` | 普通文本、正则、完整正则字面量、`exact`。 |
| CSS（高级） | `locator(css)` | CSS selector，作为偏技术的定位方式。 |
| 手写定位 | 原样保存手写 selector | 用于构建器暂未覆盖的 Playwright selector。 |

### getByRole options

当前 UI 支持：

- `name`
- `description`
- `exact`
- `checked`
- `disabled`
- `expanded`
- `selected`
- `pressed`
- `includeHidden`
- `level`

其中 `name` 和 `description` 支持普通文本、拆分正则和完整正则字面量。

### 文本值模式

所有文本类字段使用统一模型：

```ts
interface LocatorTextValue {
  kind: 'text' | 'regex' | 'regexLiteral';
  text: string;
  flags?: string;
}
```

生成规则：

- `text`：生成字符串字面量，例如 `'保存'`。
- `regex`：用表达式和 flags 组合正则字面量，例如 `/订单\d+/i`。
- `regexLiteral`：直接使用完整正则字面量，例如 `/订单\d+/i`。

基础检查会校验正则字面量是否合法，规则见 `docs/case-review-rules.md`。

### 链式能力

| UI 字段 | 生成表达式 | 说明 |
| --- | --- | --- |
| 先限定区域 | `locator(scope).<主定位器>` | 用 CSS 字符串限定父级区域，放在默认折叠的高级范围里。 |
| 结果内继续找 | `<主定位器>.locator(childSelector)` | 在主定位器结果内继续用 CSS 子定位，放在默认折叠的高级范围里。 |
| 包含文本 | `.filter({ hasText })` | 支持普通文本和正则。 |
| 排除文本 | `.filter({ hasNotText })` | 支持普通文本和正则。 |
| 可见性 | `.filter({ visible })` | 支持可见、隐藏、不限。 |
| 包含元素 | `.filter({ has })` | 子定位器只允许简单定位器。 |
| 排除元素 | `.filter({ hasNot })` | 子定位器只允许简单定位器。 |
| 第一个 | `.first()` | 和 `last`、`nth` 互斥。 |
| 最后一个 | `.last()` | 和 `first`、`nth` 互斥。 |
| 指定第几个 | `.nth(index)` | `index` 从 `0` 开始。 |

链式生成顺序固定为：

1. 先限定区域。
2. 主定位器。
3. 结果内继续找。
4. filter 条件。
5. `first`、`last` 或 `nth`。

## has 和 hasNot 限制

`has` / `hasNot` 子定位器只允许简单定位器：

- 角色。
- 文本。
- 标签。
- 占位符。
- 测试 ID。
- 标题。
- 图片文本。
- CSS。

子定位器允许普通文本和正则。角色子定位器允许 `name`、`description`、`exact` 和 role 状态 options。

子定位器不允许：

- 先限定区域。
- 结果内继续找。
- `hasText` / `hasNotText`。
- `visible`。
- `has` / `hasNot`。
- `first` / `last` / `nth`。
- 手写定位模式。

示例：

```ts
locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })
locator('.card').filter({ hasNot: getByText(/已删除|停用/) })
```

## 生成测试文件

展示和保存到 `selector` 的表达式不带页面变量：

```ts
locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })
```

生成正式测试文件或实测检查脚本时，如果存在 `selectorDraft`，会渲染成可执行表达式：

```ts
page.locator('tr').filter({ has: page.getByRole('button', { name: '编辑' }) })
```

如果步骤存在 `pageAlias`，内部 Locator 也使用同一个页面变量：

```ts
popup.locator('tr').filter({ has: popup.getByRole('button', { name: '编辑' }) })
```

没有 `selectorDraft` 的旧用例继续走历史 selector 字符串兼容逻辑。

## 基础检查同步

当前基础检查已经覆盖本轮构建器能力：

- 正则字面量语法。
- 正则 flags 合法性和重复检查。
- 空正则。
- `description` 空值和参数形态。
- `visible` 必须是布尔值。
- `has` / `hasNot` 必须是简单 Locator。
- `has` / `hasNot` 子定位器不能继续过滤、序号、链式子定位或使用页面变量前缀。
- 方法白名单和 options 白名单。

规则清单见 `docs/case-review-rules.md`。

## Playwright 支持但当前未放入 UI

以下能力由 Playwright 支持，但当前构建器 UI 未提供专门控件；技术用户仍可通过手写定位模式输入。

| 能力 | 示例 | 未放入原因 |
| --- | --- | --- |
| `locator(selector, options)` | `locator('article', { hasText: '订单' })` | 与当前链式 filter 能力重叠，需避免 UI 表达重复。 |
| `and()` | `getByRole('button').and(getByTitle('保存'))` | 组合语义较技术化，暂不适合默认 UI。 |
| `or()` | `getByRole('button', { name: '新建' }).or(getByText('确认'))` | 容易生成难读 selector，后续需单独设计。 |
| `frameLocator()` | `frameLocator('iframe').getByText('提交')` | 需要页面结构认知，适合和真实 DOM 点选一起设计。 |
| `contentFrame()` | `locator('iframe').contentFrame().getByRole('button')` | iframe 语义较复杂，暂不进入本轮。 |
| `owner()` | `frameLocator('iframe').owner()` | 使用场景少，且依赖 iframe 模型。 |
| `normalize()` | `locator.normalize()` | 需要真实页面上下文，不适合纯表单构建器。 |

## 建议迭代优先级

| 优先级 | 能力 | 原因 |
| --- | --- | --- |
| P1 | 真实页面点选生成 selector | 对非技术测试人员帮助最大，也能减少手写和猜测。 |
| P1 | 候选 selector 评估 | 基于 DOM 和匹配数量提示最佳 selector。 |
| P2 | `locator(selector, options)` | 可减少链式表达长度，但需要和现有 filter UI 统一。 |
| P2 | iframe 定位 | 对包含嵌入页面的系统很关键，但需要额外页面上下文。 |
| P3 | `and()` / `or()` | 适合复杂页面，但 UI 和检查规则都需要更强约束。 |

## 测试要求

已覆盖的自动测试：

- `tests/web/locator-builder.test.ts`：生成器、正则、全量 role、`description`、filter、has/hasNot、可执行表达式渲染。
- `tests/web/case-editor.test.ts`：步骤复制、批量复制和 `selectorDraft` 深拷贝。
- `tests/shared/case-review.test.ts`：正则、visible、has/hasNot、options、方法白名单和质量规则。
- `tests/server/case-generator.test.ts`：正式测试文件生成时 `selectorDraft` 优先和页面别名。
- `tests/server/practical-review-service.test.ts`：实测检查脚本生成时 `selectorDraft` 内部 Locator 页面前缀。

手动测试建议：

1. 在用例编辑页打开一个需要 selector 的步骤，点击“编辑定位”。
2. 搜索非常用 role，例如 `navigation` 或 `treeitem`。
3. 用 role + `description` 生成定位器。
4. 用拆分正则生成 `getByText(/订单\d+/i)`。
5. 用完整正则生成 `getByRole('button', { name: /保存|提交/ })`。
6. 生成 `locator('tr').filter({ hasText: /订单\d+/, visible: true })`。
7. 生成 `locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })`。
8. 应用后确认步骤进入待检查，400ms 后显示基础检查结果。
9. 保存草稿后重新打开构建器，确认复杂表单能通过 `selectorDraft` 回填。
10. 保存并生成测试文件，确认 `case.spec.ts` 中 has/hasNot 内部 Locator 带页面变量前缀。
