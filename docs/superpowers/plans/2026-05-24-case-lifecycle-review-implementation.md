# 用例生命周期与基础检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现用例草稿、待启用、启用状态，以及自动基础检查、运行中心过滤和必要的 Pinia 跨页面状态。

**Architecture:** 后端以 `CaseMeta.status` 和 `CaseMeta.review` 为唯一事实来源，基础检查由原定位检查扩展而来。前端项目页负责状态筛选和批量操作，用例编辑页展示基础检查问题，运行中心只展示启用且基础检查通过的用例。

**Tech Stack:** TypeScript、Express、Vue 3、Element Plus、Pinia、Vitest、Playwright。

---

### Task 1: 后端状态模型与基础检查

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/src/services/case-review/types.ts`
- Modify: `server/src/services/case-review/index.ts`
- Modify: `server/src/services/case-review/summary.ts`
- Test: `tests/server/case-review.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/case-review.test.ts` 增加测试：空步骤用例返回 `empty-steps` 高危项；缺少 selector、缺少 value、timeout 越界分别返回完整性问题；`warning` 不阻断基础检查，`error` 和 `danger` 阻断。

- [ ] **Step 2: 验证测试失败**

Run: `npx vitest run tests/server/case-review.test.ts`
Expected: FAIL，因为完整性规则和基础检查通过判断尚未实现。

- [ ] **Step 3: 最小实现**

在共享类型中新增 `CaseStatus`、`ReviewGroup`、`CheckStatus`，给 `CaseReviewItem` 增加 `group`。扩展 `reviewCase`，先检查用例完整性，再执行定位质量规则。新增 `isReviewPassed` 与 `getCaseCheckStatus`。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run tests/server/case-review.test.ts`
Expected: PASS。

### Task 2: 后端用例状态存储与状态切换接口

**Files:**
- Modify: `server/src/lib/case-store.ts`
- Modify: `server/src/routes/cases.ts`
- Modify: `web/src/api/cases.ts`
- Test: `tests/server/api-cases.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：新建用例默认草稿且未审查；复制用例默认草稿、复制基础检查、不复制实测；基础检查不通过不能切待启用或启用；基础检查通过可以切待启用或启用；批量切换返回成功和失败明细。

- [ ] **Step 2: 验证测试失败**

Run: `npx vitest run tests/server/api-cases.test.ts`
Expected: FAIL，因为状态字段、状态切换接口和批量接口尚未实现。

- [ ] **Step 3: 最小实现**

新增 `updateCaseStatus` 和 `batchUpdateCaseStatus`。新建用例写入 `status: 'draft'` 且不生成 review。复制用例复用 review、不复制 practicalReview、状态为草稿。保存和停止录制仍重新生成 review。状态切换时校验基础检查通过，否则抛出 400 并返回可读原因。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run tests/server/api-cases.test.ts`
Expected: PASS。

### Task 3: 运行中心后端过滤

**Files:**
- Modify: `server/src/services/runner.ts`
- Test: `tests/server/run-service.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：未启用用例不生成运行文件；启用但基础检查不通过会被拒绝；指定不可运行用例时返回明确错误。

- [ ] **Step 2: 验证测试失败**

Run: `npx vitest run tests/server/run-service.test.ts`
Expected: FAIL，因为运行服务当前不看用例状态。

- [ ] **Step 3: 最小实现**

`getProjectRunFiles` 只选择 `status === 'active'` 且基础检查通过的用例。若显式选择的 key 中存在不可运行用例，返回“选择的测试用例未启用或基础检查不通过”。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run tests/server/run-service.test.ts`
Expected: PASS。

### Task 4: Pinia 与前端工具函数

**Files:**
- Modify: `web/src/main.ts`
- Create: `web/src/state/project-ui.ts`
- Modify: `web/src/state/project-env.ts`
- Modify: `web/src/pages/case-editor.ts`
- Modify: `web/src/pages/run-center.ts`
- Test: `tests/web/project-env.test.ts`
- Test: `tests/web/case-editor.test.ts`
- Test: `tests/web/run-center.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：项目环境选择通过 store 持久化；检查状态格式化；运行中心只合并启用且基础检查通过的用例；用例状态标签格式化。

- [ ] **Step 2: 验证测试失败**

Run: `npx vitest run tests/web/project-env.test.ts tests/web/case-editor.test.ts tests/web/run-center.test.ts`
Expected: FAIL，因为 store 和格式化函数尚未实现。

- [ ] **Step 3: 最小实现**

挂载 Pinia。新增 `project-ui` store 管理项目环境、项目页筛选和运行中心选择。保留 `project-env.ts` 兼容导出。新增格式化函数。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run tests/web/project-env.test.ts tests/web/case-editor.test.ts tests/web/run-center.test.ts`
Expected: PASS。

### Task 5: 项目页、编辑页和运行中心 UI

**Files:**
- Modify: `web/src/pages/ProjectDetail.vue`
- Modify: `web/src/pages/CaseEditor.vue`
- Modify: `web/src/pages/RunCenter.vue`
- Modify: `web/src/api/cases.ts`
- Test: `tests/web/case-editor.test.ts`
- Test: `tests/web/run-center.test.ts`

- [ ] **Step 1: 写失败测试或扩展现有工具测试**

覆盖状态筛选、状态下拉依赖的格式化和批量请求 payload。组件视觉部分用类型检查和浏览器截图验证。

- [ ] **Step 2: 实现 UI**

项目详情页新增状态筛选、多选、状态列和批量状态按钮。编辑页把定位检查改为基础检查，展示分组提示。运行中心列表只消费后端返回的可运行用例，并保留前端二次过滤。

- [ ] **Step 3: 浏览器检查**

Run: 使用 Playwright 打开 `http://localhost:5173/projects/cctq` 和用例编辑页截图。
Expected: 状态列、检查状态列和基础检查列不遮挡、不溢出。

### Task 6: 文档与全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/agent-code-map.md`
- Modify: `docs/agent-commands.md` if needed
- Modify: `docs/problem-record.md` if needed

- [ ] **Step 1: 更新文档**

补充用例状态、基础检查、运行中心过滤、Pinia store 入口。

- [ ] **Step 2: 全量验证**

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Expected: 全部 PASS。
