# 运行中心用例选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运行中心支持勾选本次运行的测试用例，并只运行选中的用例。

**Architecture:** 前端在 `RunCenter.vue` 加载项目用例并维护选中 key 列表，运行时通过 `RunInput.caseKeys` 提交给后端。后端在 `runner.ts` 校验并过滤用例，继续复用现有 Playwright 文件参数运行方式。

**Tech Stack:** Vue 3、Element Plus、Express、TypeScript、Vitest、Supertest、Playwright Test。

---

### Task 1: 后端用例筛选

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/src/services/runner.ts`
- Test: `tests/server/run-service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/run-service.test.ts` 增加对 `getProjectRunFiles()` 的测试：

```ts
it('只返回选中用例的运行文件过滤参数', async () => {
  const files = await getProjectRunFiles(projectKey, [caseKey]);

  expect(files).toHaveLength(1);
  expect(files[0]).toContain(caseKey);
});

it('传入空用例列表时提示选择用例', async () => {
  await expect(getProjectRunFiles(projectKey, [])).rejects.toThrow('请选择至少一条测试用例');
});

it('传入不存在的用例时提示用例不存在', async () => {
  await expect(getProjectRunFiles(projectKey, ['missing-case'])).rejects.toThrow('选择的测试用例不存在或已被删除');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/server/run-service.test.ts`

Expected: 新增筛选相关测试失败，因为 `getProjectRunFiles()` 还不支持第二个参数。

- [ ] **Step 3: 实现后端筛选**

修改 `RunInput`，增加：

```ts
caseKeys?: string[];
```

修改 `runner.ts`：

```ts
const files = await getProjectRunFiles(projectKey, input.caseKeys);
```

并让 `getProjectRunFiles(projectKey, caseKeys)` 支持空数组、缺失用例和部分筛选。

- [ ] **Step 4: 运行后端相关测试**

Run: `npm run test -- tests/server/run-service.test.ts tests/server/api-runs.test.ts`

Expected: 相关测试通过。

### Task 2: 前端运行中心选择用例

**Files:**
- Modify: `web/src/pages/RunCenter.vue`
- Test: `tests/web/run-center.test.ts` 或现有运行中心测试文件

- [ ] **Step 1: 写失败测试**

增加前端测试覆盖：

```ts
it('默认全选可用用例并提交选中 key', async () => {
  // mock 用例列表、登录态和运行接口。
  // 渲染运行中心后点击运行按钮。
  // 断言请求体包含 caseKeys。
});

it('全不选后禁用运行按钮', async () => {
  // 渲染运行中心。
  // 点击全不选。
  // 断言运行按钮不可用。
});
```

- [ ] **Step 2: 运行前端测试确认失败**

Run: `npm run test -- tests/web/run-center.test.ts`

Expected: 测试失败，因为运行中心还没有用例选择 UI。

- [ ] **Step 3: 实现运行中心 UI**

在 `RunCenter.vue`：

- 引入 `CaseMeta` 和 `listCases()`。
- 增加 `cases`、`selectedCaseKeys` 状态。
- 加载项目时并行加载用例，默认全选。
- 新增 `selectAllCases()`、`clearCases()`、`canRun()`。
- 在运行请求中传入 `caseKeys`。
- 按设计增加左右分栏和用例表格。

- [ ] **Step 4: 运行前端测试**

Run: `npm run test -- tests/web/run-center.test.ts`

Expected: 前端运行中心测试通过。

### Task 3: 全量检查

**Files:**
- Verify all modified files

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`

Expected: 通过。

- [ ] **Step 2: 单元测试**

Run: `npm run test`

Expected: 通过。

- [ ] **Step 3: 构建**

Run: `npm run build`

Expected: 通过。

