# 静态用例审查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现第一阶段静态用例审查，在录制导入和保存用例后生成审查结果，并在列表页和编辑页展示问题状态。

**Architecture:** 新增独立 `case-review` 服务，规则放在单独 `rules` 目录中，每条规则只负责一种风险。后端保存 `review` 到 `case.json`，前端读取后展示组合摘要和步骤级标记。

**Tech Stack:** TypeScript、Vitest、Express、Vue 3、Element Plus、Playwright 用例元数据。

---

### Task 1: 审查类型与规则引擎

**Files:**
- Modify: `shared/types.ts`
- Create: `server/src/services/case-review/types.ts`
- Create: `server/src/services/case-review/summary.ts`
- Create: `server/src/services/case-review/index.ts`
- Create: `server/src/services/case-review/rules/dynamic-id.ts`
- Create: `server/src/services/case-review/rules/wide-framework-selector.ts`
- Create: `server/src/services/case-review/rules/transient-state-class.ts`
- Create: `server/src/services/case-review/rules/structure-selector.ts`
- Create: `server/src/services/case-review/rules/weak-role-selector.ts`
- Create: `server/src/services/case-review/rules/index.ts`
- Test: `tests/server/case-review.test.ts`

- [ ] **Step 1: 写失败测试**

新增 `tests/server/case-review.test.ts`，覆盖 UUID、宽泛框架选择器、瞬态状态、结构选择器、弱 role 选择器、具名 role 通过、摘要聚合、非定位步骤跳过。

- [ ] **Step 2: 运行失败测试**

Run: `rtk npm run test -- tests/server/case-review.test.ts`

Expected: FAIL，提示找不到 `server/src/services/case-review` 模块。

- [ ] **Step 3: 扩展共享类型**

在 `shared/types.ts` 增加 `ReviewLevel`、`CaseReviewItem`、`CaseReviewSummary`、`CaseReview`，并给 `CaseMeta` 增加可选 `review?: CaseReview`。

- [ ] **Step 4: 实现规则接口和摘要**

在 `case-review/types.ts` 定义 `ReviewContext`、`ReviewRule`，在 `summary.ts` 实现 `createReviewSummary` 和 `formatReviewSummary`。

- [ ] **Step 5: 实现独立规则文件**

每条规则单独文件实现，统一从 `rules/index.ts` 导出。

- [ ] **Step 6: 实现审查入口**

在 `case-review/index.ts` 实现 `reviewCase`、`reviewStep`、`shouldReviewStep`。

- [ ] **Step 7: 运行测试确认通过**

Run: `rtk npm run test -- tests/server/case-review.test.ts`

Expected: PASS。

### Task 2: 后端保存与读取接入

**Files:**
- Modify: `server/src/services/record-session.ts`
- Modify: `server/src/lib/case-store.ts`
- Modify: `server/src/routes/cases.ts`
- Test: `tests/server/record-session.test.ts`
- Test: `tests/server/api-cases.test.ts`

- [ ] **Step 1: 写失败测试**

补充录制停止导入保存 `review` 的测试，补充保存用例后重新生成 `review` 的 API 测试。

- [ ] **Step 2: 运行失败测试**

Run: `rtk npm run test -- tests/server/record-session.test.ts tests/server/api-cases.test.ts`

Expected: FAIL，返回数据没有 `review`。

- [ ] **Step 3: 录制导入后审查**

在 `stopRecordSession` 中构造 `nextItem` 后调用 `reviewCase(nextItem)`，把结果写入 `review`。

- [ ] **Step 4: 用例保存时审查**

在用例保存路径中统一调用 `reviewCase`，确保手工编辑步骤后也更新 `review`。

- [ ] **Step 5: 列表和详情返回审查数据**

保留详情完整 `review.items`，列表可返回完整用例对象或至少包含 `review.summary`。

- [ ] **Step 6: 运行后端相关测试**

Run: `rtk npm run test -- tests/server/record-session.test.ts tests/server/api-cases.test.ts`

Expected: PASS。

### Task 3: 前端列表摘要展示

**Files:**
- Modify: `web/src/pages/ProjectDetail.vue`
- Test: Existing typecheck/build coverage

- [ ] **Step 1: 增加审查状态列**

在用例列表表格中新增审查状态列，展示 `错误 1 / 高危 2 / 警告 3`、`通过` 或 `未审查`。

- [ ] **Step 2: 增加摘要格式化函数**

在页面内实现轻量格式化函数，避免新增公共工具。

- [ ] **Step 3: 运行类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

### Task 4: 前端编辑页步骤标记

**Files:**
- Modify: `web/src/pages/CaseEditor.vue`
- Test: Existing typecheck/build coverage

- [ ] **Step 1: 按 stepId 聚合审查项**

在编辑页把 `case.review.items` 聚合为 `stepId -> items`，供步骤列表快速读取。

- [ ] **Step 2: 步骤行展示标记**

在有问题的步骤旁展示级别标签，支持同一步骤多个问题。

- [ ] **Step 3: 展示问题说明和建议**

用 tooltip、popover 或展开内容展示 `message` 和 `suggestion`。

- [ ] **Step 4: 运行类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

### Task 5: 全量验证

**Files:**
- No new files.

- [ ] **Step 1: 运行服务端和前端测试**

Run: `rtk npm run test`

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

- [ ] **Step 3: 检查工作区差异**

Run: `rtk git diff --stat`

Expected: 只包含本功能相关文件。

