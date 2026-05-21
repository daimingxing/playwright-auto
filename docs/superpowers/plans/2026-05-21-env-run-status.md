# 多环境和运行状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持项目多环境配置、按环境保存登录态、运行时选择环境，并让测试报告状态显示通过或失败。

**Architecture:** 项目环境继续保存在 `project.json` 的 `envs/defaultEnv` 中，新增项目环境 API 和项目管理页配置弹窗。登录态路径改为 `auth/<envKey>.storageState.json`，运行中心按所选环境加载登录态和运行测试，运行结束后更新 `RunMeta.status`。

**Tech Stack:** TypeScript、Express、Vue 3、Element Plus、Vitest、Playwright。

---

### Task 1: 运行状态迭代

**Files:**
- Modify: `server/src/lib/run-store.ts`
- Modify: `server/src/services/runner.ts`
- Modify: `web/src/pages/RunCenter.vue`
- Test: `tests/server/run-service.test.ts`
- Test: `tests/server/api-runs.test.ts`

- [ ] **Step 1: 写失败测试**

补充测试：运行成功后 `run.json.status` 为 `passed`；运行失败后 `run.json.status` 为 `failed`。

- [ ] **Step 2: 确认失败**

Run: `rtk npm run test -- tests/server/run-service.test.ts tests/server/api-runs.test.ts`

Expected: FAIL，当前状态仍为 `created`。

- [ ] **Step 3: 实现 updateRun**

在 `run-store.ts` 增加 `updateRun(projectKey, runId, input)`，校验 `runId` 后读取并写回 `run.json`。

- [ ] **Step 4: runner 写状态**

在 `runProject` 成功后写 `passed`，失败前写 `failed`。

- [ ] **Step 5: 前端状态中文化**

运行中心状态列显示 `已创建 / 运行中 / 通过 / 失败`。

- [ ] **Step 6: 测试通过**

Run: `rtk npm run test -- tests/server/run-service.test.ts tests/server/api-runs.test.ts`

Expected: PASS。

### Task 2: 项目环境配置接口

**Files:**
- Modify: `server/src/lib/schema.ts`
- Modify: `server/src/lib/project-store.ts`
- Modify: `server/src/routes/projects.ts`
- Test: `tests/server/api-projects.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖新增环境、重复 key、编辑环境、删除环境、禁止删除 `default`、删除环境清理对应登录态。

- [ ] **Step 2: 确认失败**

Run: `rtk npm run test -- tests/server/api-projects.test.ts`

Expected: FAIL，环境接口不存在。

- [ ] **Step 3: 实现 schema**

增加 `createEnvSchema`、`updateEnvSchema`。

- [ ] **Step 4: 实现 project-store 函数**

新增 `listProjectEnvs`、`addProjectEnv`、`updateProjectEnv`、`deleteProjectEnv`。

- [ ] **Step 5: 实现项目环境路由**

在 `projectsRouter` 增加 `/envs` 相关接口。

- [ ] **Step 6: 测试通过**

Run: `rtk npm run test -- tests/server/api-projects.test.ts`

Expected: PASS。

### Task 3: 按环境登录态

**Files:**
- Modify: `server/src/services/auth-session.ts`
- Modify: `server/src/routes/auth.ts`
- Modify: `server/src/services/runner.ts`
- Modify: `server/src/services/record-session.ts`
- Test: `tests/server/api-auth.test.ts`
- Test: `tests/server/record-session.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖 `default` 和 `pre` 分别保存登录态到不同文件；运行测试读取当前环境登录态。

- [ ] **Step 2: 确认失败**

Run: `rtk npm run test -- tests/server/api-auth.test.ts tests/server/record-session.test.ts`

Expected: FAIL，登录态仍按项目共用。

- [ ] **Step 3: auth-session 支持 envKey**

`getProjectAuthPath`、`hasProjectAuth`、`startLoginSession`、`saveLoginSession` 增加 `envKey` 参数。

- [ ] **Step 4: auth 路由透传 envKey**

从 query 或 body 读取 `envKey`，没有传时用固定 `default` 环境。

- [ ] **Step 5: runner 和 record-session 使用 envKey 登录态**

运行测试和录制时使用对应环境登录态。

- [ ] **Step 6: 测试通过**

Run: `rtk npm run test -- tests/server/api-auth.test.ts tests/server/record-session.test.ts`

Expected: PASS。

### Task 4: 前端项目环境配置

**Files:**
- Modify: `web/src/api/projects.ts`
- Modify: `web/src/pages/ProjectList.vue`

- [ ] **Step 1: API 封装**

增加环境配置相关 API 方法。

- [ ] **Step 2: 项目卡片展示默认环境**

卡片展示默认环境名称、key、URL 和环境数量。

- [ ] **Step 3: 环境配置弹窗**

支持新增、编辑、删除。删除按钮对 `default` 环境禁用。

- [ ] **Step 4: 类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

### Task 5: 前端运行中心按环境运行

**Files:**
- Modify: `web/src/api/auth.ts`
- Modify: `web/src/api/runs.ts`
- Modify: `web/src/pages/RunCenter.vue`

- [ ] **Step 1: API 透传 envKey**

登录态和运行接口都支持传入 `envKey`。

- [ ] **Step 2: 运行环境下拉框**

加载项目配置，默认选中 `default`，切换时刷新登录态状态。

- [ ] **Step 3: 报告环境和状态展示**

环境列显示 `环境名称（key）`，找不到显示 key；状态列使用中文标签。

- [ ] **Step 4: 类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

### Task 6: 全量验证

**Files:**
- No new files.

- [ ] **Step 1: 全量测试**

Run: `rtk npm run test`

Expected: PASS。

- [ ] **Step 2: 类型检查**

Run: `rtk npm run typecheck`

Expected: PASS。

- [ ] **Step 3: 构建**

Run: `rtk npm run build`

Expected: PASS。

- [ ] **Step 4: 浏览器验证**

打开 `http://localhost:5173`，验证项目卡片环境信息、环境配置弹窗、运行中心环境下拉框和报告状态标签。
