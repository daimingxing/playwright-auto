# 基础检查规则

本文档记录当前已经实现的基础检查规则。实现入口是 `shared/case-review.ts`，前端编辑页的即时预览和后端保存、生成、状态切换使用同一套共享规则。

## 检查顺序

基础检查按下面顺序执行：

1. 完整性检查：检查步骤数量、必填选择器、必填值和等待时间。
2. 选择器基础语法检查：检查括号、方括号、花括号、引号是否成对，部分 Playwright 定位表达式是否缺少必要参数，以及空定位器链路。
3. Playwright 定位方法白名单检查：检查表达式中的定位方法名是否属于当前支持范围。
4. 参数和 options 检查：检查 `getByRole` 和 `filter` 的 options 结构与字段是否合法。
5. 选择器质量检查：检查动态 id、框架通用 class、瞬态状态 class、结构顺序依赖、弱 role 定位和过弱 CSS 选择器。

阻断级别为 `error` 和 `danger`。只有 `warning` 不阻断基础检查通过。

## 完整性规则

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `empty-steps` | `danger` | 用例没有任何步骤。 |
| `missing-selector` | `error` | 需要元素定位的步骤缺少 selector。 |
| `missing-value` | `error` | 需要值的步骤缺少 value。 |
| `invalid-timeout` | `error` | timeout 不是整数，或小于 `0`，或大于 `600000` 毫秒。 |

需要元素定位的步骤类型包括：`click`、`rightClick`、`doubleClick`、`hover`、`fill`、`select`、`assertVisible`、`assertText`、`assertValue`。

需要值的步骤类型包括：`goto`、`fill`、`select`、`assertText`、`assertValue`、`assertUrl`、`assertTitle`。

## 选择器语法规则

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `invalid-selector` | `error` | 括号、方括号、花括号或引号不成对；定位方法缺少必要首参；`getByRole` 或 `filter` 的 options 对象结构无法解析。 |
| `empty-locator-argument` | `error` | 出现 `locator()`、`filter()`、`filter({})`、`nth()` 这类缺少关键参数的链路，或 `locator`、`getByText`、`getByLabel`、`getByPlaceholder`、`getByTestId`、`getByTitle`、`getByAltText` 的首参是空字符串。 |
| `invalid-locator-option` | `error` | 定位器 options 的基础类型不符合规则，例如 `exact` 不是布尔值。 |
| `invalid-locator-argument` | `error` | 定位器链式参数不符合规则，例如 `nth` 不是非负整数。 |
| `empty-locator-option` | `error` | options 字段有冒号但没有值，或字符串值为空白。 |
| `external-locator-variable` | `error` | options 使用对象简写，例如 `{ name }`、`{ checked }`、`{ hasText }`，会依赖外部变量。 |

当前语法检查是轻量规则，不是完整 JavaScript AST 解析。它会检查已覆盖的常见错误，但不会保证任意 JavaScript 表达式都被完整解析。

## 定位方法白名单规则

当前只允许以下 Playwright 风格定位方法：

- `locator`
- `filter`
- `getByRole`
- `getByText`
- `getByLabel`
- `getByPlaceholder`
- `getByTestId`
- `getByTitle`
- `getByAltText`
- `nth`
- `first`
- `last`

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `unknown-locator-method` | `error` | selector 中出现不在白名单中的方法，例如 `getBysasaText()`、`findByText()`。 |

示例：

```ts
locator('.panel').getByText('保存').first() // 通过
getBysasaText('asdad') // unknown-locator-method
locator('div').findByText('保存') // unknown-locator-method
```

## getByRole options 规则

当前项目锁定 Playwright `1.60.0`。`getByRole(role, options)` 只允许以下 options：

- `checked`
- `description`
- `disabled`
- `exact`
- `expanded`
- `includeHidden`
- `level`
- `name`
- `pressed`
- `selected`

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `unknown-role-option` | `error` | `getByRole` 使用不在上述白名单里的 options，例如 `id` 或 `hasText`。 |
| `external-locator-variable` | `error` | `getByRole` options 使用对象简写。 |
| `empty-locator-option` | `error` | `getByRole` options 值为空。 |

示例：

```ts
getByRole('textbox', { name: '用户名' }) // 通过
getByRole('textbox', { id: 'userName' }) // unknown-role-option
getByRole('textbox', { hasText: '用户名' }) // unknown-role-option
getByRole('textbox', { name }) // external-locator-variable
getByRole('textbox', { name: ' ' }) // empty-locator-option
```

## filter options 规则

`locator().filter(options)` 只允许以下 options：

- `has`
- `hasNot`
- `hasText`
- `hasNotText`
- `visible`

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `unknown-filter-option` | `error` | `filter` 使用不在上述白名单里的 options，例如 `id`。 |
| `external-locator-variable` | `error` | `filter` options 使用对象简写。 |
| `empty-locator-option` | `error` | `filter` options 值为空。 |
| `invalid-selector` | `error` | `filter` 的 options 对象前有多余字符，或对象字段不是合法字段格式。 |

示例：

```ts
locator('article').filter({ hasText: '订单', visible: true }) // 通过
locator('div').filter({ id: 'panel' }) // unknown-filter-option
locator('div').filter({ hasText }) // external-locator-variable
locator('div').filter({ hasText: ' ' }) // empty-locator-option
locator('div').filter(asdada{ hasText: /^文本$/ }) // invalid-selector
locator('div').filter({ z hasText: /^文本$/ }) // invalid-selector
```

## 选择器质量规则

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `dynamic-id` | `error` | 选择器使用 UUID 形式的动态 id。 |
| `wide-framework-selector` | `danger` | 选择器只描述通用框架控件 class，例如 `.k-picker`、`.k-dropdownlist`、`.el-select`、`.ant-select`，且没有语义锚点。 |
| `transient-state-class` | `warning` | 选择器包含瞬态状态 class，例如 `.k-hover`、`.is-focus`、`.is-active`。 |
| `structure-selector` | `warning` | 选择器包含 `:nth-child()`、`:nth-of-type()`，或过长的 DOM 层级路径。 |
| `weak-role-selector` | `warning` | `getByRole` 缺少 `name` 或区域约束。 |
| `weak-css-selector` | `warning` | 选择器是过弱的裸标签或裸词 CSS，例如 `div`、`asdasdad`。 |

## 已知不足

当前检查仍是轻量规则，不是完整 Playwright 或 TypeScript 解析器。它会检查已支持方法的方法名、部分参数结构和 options 白名单，但不会完整验证所有链式调用的参数类型。例如 `locator(123)` 这类参数类型问题目前不一定能被识别。

定位器构建器上线后，基础检查仍需要继续作为兜底能力。构建器可以减少手写错误，但不能覆盖录制导入、旧数据和高级手写 selector。

后续可以继续增强：

1. 为 `locator`、`getByText`、`getByLabel`、`getByPlaceholder`、`getByTestId`、`getByTitle`、`getByAltText` 增加更完整的参数类型规则，例如拦截 `locator(123)`。
2. 为 `has`、`hasNot` 增加 Locator 参数形态检查。
3. 如后续支持更多 Playwright 定位方法，同步扩展方法白名单和 options 白名单。
