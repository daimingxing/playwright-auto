# 用例审查开发文档

## 背景

Playwright codegen 录制脚本会把用户操作转换为元素定位代码。真实测试报告已经证明，部分录制生成的定位方式不适合作为长期自动化用例：

- 动态 UUID id 在重放时可能不存在，导致定位不到元素。
- 只依赖框架 class 的通用控件选择器可能匹配到错误下拉框。
- `nth-child` 这类结构选择器当前可能可用，但页面布局调整后容易失效。
- 瞬态状态 class 只代表录制时的交互状态，不适合作为稳定定位依据。

因此平台需要在录制导入和用例编辑保存后，对所有依赖元素定位的步骤做审查，并把审查状态展示给测试人员。

## 目标

- 第一阶段实现静态审查，只分析用例步骤和选择器文本，不启动浏览器。
- 审查结果跟随 `case.json` 保存，方便列表页和编辑页直接展示。
- 错误级问题允许保存，不阻止开发者运行测试。
- 用例列表展示组合摘要，例如 `错误 1 / 高危 2 / 警告 3`。
- 用例编辑页在具体问题步骤上展示标记、原因和修改建议。
- 审查规则必须独立维护，后续新增规则时不需要改动解析器和生成器主流程。

## 非目标

- 第一阶段不自动修复选择器。
- 第一阶段不启动 Playwright 浏览器，也不检查真实 DOM 匹配数量。
- 第一阶段不诊断业务断言失败，例如文本不符合预期、业务数据不一致。
- 第一阶段不阻止保存错误级用例。

## 分阶段计划

### 第一阶段：静态规则审查

在录制停止导入、用例编辑保存时，对所有元素定位步骤进行静态审查。

审查步骤类型：

- `click`
- `rightClick`
- `doubleClick`
- `hover`
- `fill`
- `select`
- `assertVisible`
- `assertText`
- `assertValue`

暂不审查元素定位的步骤类型：

- `goto`
- `wait`
- `assertUrl`
- `assertTitle`

### 第二阶段：轻量动态审查

用 Playwright 打开页面并按步骤推进，只做定位质量检查，不自动提交保存类动作。

重点检查：

- `locator.count()`
- `locator.first().isVisible()`
- `locator.first().isEnabled()`
- `locator.first().boundingBox()`

第二阶段用于识别静态规则无法判断的问题，例如“选择器匹配多个元素并点错目标”。

### 第三阶段：失败原因诊断

读取 Playwright 报告、trace、错误上下文，为失败测试判断是否属于用例质量问题。

目标诊断范围：

- 定位不到元素。
- 匹配多个元素。
- 元素不可见。
- 元素不可点击。
- 元素被遮挡。
- 操作超时。

非目标诊断范围：

- 业务断言失败。
- 接口返回数据不符合预期。
- 环境数据变化导致的业务失败。

## 模块设计

建议新增独立审查模块：

```text
server/src/services/case-review/
  index.ts
  types.ts
  summary.ts
  rules/
    dynamic-id.ts
    wide-framework-selector.ts
    transient-state-class.ts
    structure-selector.ts
    weak-role-selector.ts
    index.ts
```

职责划分：

- `index.ts`：对外暴露审查入口。
- `types.ts`：维护审查结果、规则接口、上下文类型。
- `summary.ts`：把审查项聚合为列表页摘要。
- `rules/*`：每个文件维护一类规则。
- `rules/index.ts`：集中导出规则列表，新增规则时只需要添加文件并注册。

## 数据结构

建议扩展共享类型：

```ts
export type ReviewLevel = 'error' | 'danger' | 'warning' | 'info';

export interface CaseReviewItem {
  id: string;
  stepId: string;
  stepIndex: number;
  stepType: StepType;
  selector: string;
  level: ReviewLevel;
  ruleCode: string;
  message: string;
  suggestion: string;
}

export interface CaseReviewSummary {
  level: ReviewLevel | 'pass';
  error: number;
  danger: number;
  warning: number;
  info: number;
}

export interface CaseReview {
  summary: CaseReviewSummary;
  items: CaseReviewItem[];
  updatedAt: string;
}
```

`CaseMeta` 建议增加可选字段：

```ts
export interface CaseMeta {
  name: string;
  key: string;
  startPath: string;
  steps: CaseStep[];
  review?: CaseReview;
  createdAt: string;
  updatedAt: string;
}
```

兼容策略：

- 历史 `case.json` 没有 `review` 字段时视为未审查。
- 打开编辑页或保存用例后重新生成 `review`。
- 列表页没有 `review` 时可以显示 `未审查`，也可以在后端读取时补算。

## 规则接口

规则文件必须独立、可组合、易扩展。建议每条规则实现同一个接口。

```ts
export interface ReviewContext {
  step: CaseStep;
  stepIndex: number;
  selector: string;
}

export interface ReviewRule {
  code: string;
  level: ReviewLevel;
  title: string;
  review(context: ReviewContext): CaseReviewItem[];
}
```

规则入口示例：

```ts
import { dynamicIdRule } from './dynamic-id';
import { structureSelectorRule } from './structure-selector';
import { transientStateClassRule } from './transient-state-class';
import { weakRoleSelectorRule } from './weak-role-selector';
import { wideFrameworkSelectorRule } from './wide-framework-selector';

export const reviewRules = [
  dynamicIdRule,
  wideFrameworkSelectorRule,
  transientStateClassRule,
  structureSelectorRule,
  weakRoleSelectorRule
];
```

后续新增规则流程：

1. 在 `server/src/services/case-review/rules/` 下新增规则文件。
2. 实现 `ReviewRule` 接口。
3. 在 `rules/index.ts` 注册规则。
4. 添加对应单元测试。

## 初始规则

### dynamic-id

级别：`error`

命中场景：

- `locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')`
- `locator('#b52924a5-1ae0-4d5a-9fbe-6f0237e7cd17 > .k-input-value-text')`

判断逻辑：

- 选择器中出现 UUID 格式 id。
- 选择器中出现 `#` 后接 UUID。

提示文案：

```text
选择器使用动态 UUID id，重放时该 id 可能不存在。
```

建议文案：

```text
请改用弹窗标题、字段标签、按钮名称、可见文本或稳定业务属性定位。
```

### wide-framework-selector

级别：`danger`

命中场景：

- `.k-picker.k-dropdownlist.k-picker-solid.k-picker-md.k-rounded-md > .k-input-button`
- `.k-picker.k-dropdownlist.k-picker-solid.k-picker-md.k-rounded-md.k-hover > .k-input-button`

判断逻辑：

- 选择器主要由框架 class 组成。
- 选择器指向通用控件，例如 Kendo 下拉框。
- 选择器缺少弹窗名、字段名、角色名称、可见文本等业务语义锚点。

提示文案：

```text
选择器只描述通用框架控件，页面存在多个相似控件时可能点错元素。
```

建议文案：

```text
请使用弹窗标题加字段名称定位目标控件，例如先限定“能源计量点配置维护”，再定位“电力站所”下拉框。
```

### transient-state-class

级别：`warning`

命中场景：

- `.k-hover`
- `.is-focus`
- `.is-active`
- `.is-opened`

判断逻辑：

- 选择器包含交互状态 class。

提示文案：

```text
选择器包含瞬态状态 class，该状态只代表录制时的鼠标或焦点状态。
```

建议文案：

```text
请去掉瞬态状态 class，改用稳定的字段、角色或文本定位。
```

### structure-selector

级别：`warning`

命中场景：

- `div:nth-child(2) > div:nth-child(4) > .i-row > .i-col.i-col-16`
- 超过固定长度的纯 DOM 层级链。

判断逻辑：

- 选择器包含 `nth-child` 或 `nth-of-type`。
- 选择器依赖较长 DOM 层级，且缺少语义锚点。

提示文案：

```text
选择器依赖页面结构顺序，布局调整后容易失效。
```

建议文案：

```text
请改用字段标签、按钮名称、可见文本或角色名称定位。
```

### weak-role-selector

级别：`warning`

命中场景：

- `getByRole('combobox')`
- `getByRole('button')`

不命中场景：

- `getByRole('button', { name: '新增' })`
- `getByLabel('能源计量点配置维护').getByRole('combobox')`

判断逻辑：

- 使用 role 定位但没有 `name`。
- 没有上级弹窗、区域、标签或文本约束。

提示文案：

```text
角色定位缺少名称或区域约束，页面存在多个同类元素时可能点错。
```

建议文案：

```text
请为角色定位增加 name，或先限定弹窗、区域、字段标签。
```

## 审查入口

审查入口建议只接收完整用例，返回完整审查结果。

```ts
/**
 * 静态审查用例中的元素定位步骤。
 */
export function reviewCase(item: CaseMeta): CaseReview {
  const items = item.steps.flatMap((step, index) => reviewStep(step, index));

  return {
    items,
    summary: createReviewSummary(items),
    updatedAt: new Date().toISOString()
  };
}
```

步骤审查逻辑：

```ts
/**
 * 静态审查单个步骤的元素定位质量。
 */
function reviewStep(step: CaseStep, index: number): CaseReviewItem[] {
  if (!shouldReviewStep(step)) {
    return [];
  }

  const selector = step.selector ?? '';

  if (!selector) {
    return [];
  }

  return reviewRules.flatMap((rule) =>
    rule.review({
      step,
      stepIndex: index,
      selector
    })
  );
}
```

## 摘要规则

列表页展示组合摘要，不只展示最高级别。

摘要生成规则：

- `error > 0` 时总体级别为 `error`。
- 否则 `danger > 0` 时总体级别为 `danger`。
- 否则 `warning > 0` 时总体级别为 `warning`。
- 否则 `info > 0` 时总体级别为 `info`。
- 全部为 0 时总体级别为 `pass`。

展示文案：

- 有问题：`错误 1 / 高危 2 / 警告 3`
- 无问题：`通过`
- 未生成审查结果：`未审查`

## 后端接入点

### 录制停止导入

文件：`server/src/services/record-session.ts`

流程：

1. 读取 codegen 输出。
2. `parseCodegenSpec(code)` 生成步骤。
3. 构造新的 `CaseMeta`。
4. 调用 `reviewCase(nextItem)`。
5. 把 `review` 写入 `case.json`。

### 用例编辑保存

文件：`server/src/routes/cases.ts` 或 `server/src/lib/case-store.ts`

流程：

1. 接收前端保存的用例内容。
2. 重新调用 `reviewCase(item)`。
3. 保存带 `review` 的 `case.json`。

### 用例列表读取

文件：`server/src/routes/cases.ts`

流程：

1. 返回用例列表时携带 `review.summary`。
2. 不需要返回完整 `review.items`，避免列表数据过大。
3. 编辑页读取单个用例时返回完整 `review.items`。

## 前端展示

### 用例列表

文件：`web/src/pages/ProjectDetail.vue`

建议新增审查状态列：

- `通过`
- `未审查`
- `错误 1 / 高危 2 / 警告 3`

颜色建议：

- 错误：红色。
- 高危：橙红色。
- 警告：黄色。
- 通过：绿色。
- 未审查：灰色。

### 用例编辑页

文件：`web/src/pages/CaseEditor.vue`

建议在步骤列表中展示步骤级审查标记：

- 每个问题步骤显示对应级别标签。
- 鼠标悬浮或展开后显示 `message` 和 `suggestion`。
- 同一步骤可能命中多条规则，需要能展示多个问题。

## 测试计划

### 单元测试

新增测试文件：

```text
tests/server/case-review.test.ts
```

覆盖场景：

- UUID id 命中 `error`。
- 宽泛 Kendo 下拉框 class 命中 `danger`。
- `.k-hover` 命中 `warning`。
- `nth-child` 命中 `warning`。
- 具名 `getByRole` 不命中风险规则。
- 用例摘要生成 `错误 1 / 高危 2 / 警告 3`。
- 非元素定位步骤不参与审查。

### API 测试

按现有路由测试补充：

- 录制停止导入后保存 `review`。
- 保存用例后重新生成 `review`。
- 列表接口返回 `review.summary`。
- 单个用例接口返回完整 `review.items`。

### 前端测试

按现有前端测试能力补充：

- 用例列表展示组合摘要。
- 用例编辑页的问题步骤显示标记。
- 无问题用例展示 `通过`。
- 历史未审查用例展示 `未审查` 或后端补算后的结果。

## 质量要求

- 审查规则必须有独立单元测试。
- 新增规则时不得修改解析器和生成器主流程。
- 所有审查提示文案必须面向测试人员，避免只写技术术语。
- 静态审查不得执行用户步骤，不得访问外部页面。
- 第一阶段不得阻止错误级用例保存。

