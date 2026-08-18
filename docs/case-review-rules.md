# 基础检查规则

基础检查在保存草稿、生成测试文件和切换用例状态时执行，结果保存在 `case.json` 的 `review` 字段中。实现入口是 `shared/case-review.ts`。

检查只处理结构完整性、数值边界和无需解析表达式即可确定的定位风险。Playwright selector 的方法、参数、options 和正则语法由生成测试或实测运行验证，项目不维护第二套表达式解析器。

## 阻断规则

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `empty-steps` | `danger` | 用例没有任何步骤。 |
| `missing-selector` | `error` | 需要元素定位的步骤缺少 selector。 |
| `missing-value` | `error` | 需要值的步骤缺少 value。 |
| `invalid-timeout` | `error` | timeout 不是 `0` 到 `600000` 的整数。 |
| `dynamic-id` | `error` | selector 使用 UUID 形式的动态 id。 |
| `wide-framework-selector` | `danger` | selector 只描述通用框架控件 class 且没有语义锚点。 |

`error` 和 `danger` 会阻断生成测试文件以及切换到待启用或启用状态。

## 提示规则

| 规则码 | 级别 | 触发条件 |
| --- | --- | --- |
| `transient-state-class` | `warning` | selector 包含 hover、focus、active 等瞬态 class。 |
| `structure-selector` | `warning` | selector 使用 `:nth-child()`、`:nth-of-type()` 或过长 DOM 层级。 |
| `weak-role-selector` | `warning` | `getByRole` 缺少 name 或父级范围。 |
| `weak-css-selector` | `warning` | selector 只是宽泛的裸标签或裸词 CSS。 |

`warning` 只提示，不阻断用例状态和测试文件生成。
