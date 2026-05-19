# Playwright 自动化测试平台 Implementation Plan

> **给执行者：** 需要使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行，步骤使用 `- [ ]` 跟踪。

**Goal:** 构建一个本地 Web 界面 + Node 服务的 Playwright 自动化测试平台，支持按项目保存 URL、用例分文件存储、步骤级可视化编辑、临时登录态、按项目运行测试，以及报告/截图/视频/trace 导出。

**Architecture:** 前端使用 Vue 3 负责项目、用例、录制、编辑和运行界面；后端使用 Node 服务统一负责文件系统、Playwright 会话、测试执行和产物导出。`case.json` 作为可视化编辑的真实数据源，`case.spec.ts` 作为可迁移的生成产物；所有项目数据统一落在 `data/projects/<projectKey>/` 下，便于整体复制、回收站管理和后续迁移到独立项目中继续跑。

**Tech Stack:** Vue 3、Vite、TypeScript、Vue Router、Pinia、Element Plus、Express、Playwright、Vitest、Zod、tsx、concurrently、archiver。

---

### Task 1: 初始化仓库骨架与开发脚本

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/src/main.ts`
- Create: `web/src/App.vue`
- Create: `server/src/index.ts`
- Create: `shared/types.ts`
- Create: `playwright.config.ts`
- Create: `data/.gitkeep`
- Create: `data/projects/.gitkeep`
- Create: `tests/smoke/startup.test.ts`

- [ ] **Step 1: 写入基础脚本与依赖**

`package.json` 需要先定义好这些脚本：`dev`、`dev:web`、`dev:server`、`build`、`test`、`test:e2e`、`lint`。  
`dev` 负责同时启动 Vue 前端和 Node 服务，`test` 先跑单元测试，`test:e2e` 跑浏览器流程验证。

- [ ] **Step 2: 启动基础服务**

运行：`npm run dev`  
预期：前端页面能在本地地址打开，Node 服务能返回健康检查接口。

- [ ] **Step 3: 跑最小烟雾测试**

运行：`npm run test`  
预期：`tests/smoke/startup.test.ts` 通过，说明基础脚手架可用。

### Task 2: 定义数据模型与文件存储规则

**Files:**
- Modify: `shared/types.ts`
- Create: `server/src/lib/path.ts`
- Create: `server/src/lib/fs.ts`
- Create: `server/src/lib/schema.ts`
- Create: `server/src/lib/project-store.ts`
- Create: `server/src/lib/case-store.ts`
- Create: `server/src/lib/run-store.ts`
- Create: `server/src/lib/auth-store.ts`
- Create: `tests/server/fs-store.test.ts`

- [ ] **Step 1: 固定数据结构**

`shared/types.ts` 先定义四类核心数据：`ProjectMeta`、`CaseMeta`、`RunMeta`、`AuthState`。  
其中 `ProjectMeta` 保存项目名称、项目标识、环境列表和默认环境；`CaseMeta` 保存用例名称、起始路径、步骤列表和更新时间；`RunMeta` 保存运行编号、项目标识、环境标识和报告路径；`AuthState` 只保存本次运行的临时登录态路径。

- [ ] **Step 2: 固定目录布局**

统一使用 `data/projects/<projectKey>/` 作为项目根目录，内部固定分成 `cases/`、`trash/`、`runs/`、`auth/`。  
用例目录内每个用例独占一个文件夹，里面同时保存 `case.json` 和生成的 `case.spec.ts`，这样复制一个目录就能迁移一条可用用例。

- [ ] **Step 3: 写文件读写与移动逻辑**

`server/src/lib/*.ts` 负责创建目录、读写 JSON、把用例文件夹移动到回收站、创建运行目录和清理临时登录态。  
删除时不是打标，而是把整个用例目录移动到 `data/projects/<projectKey>/trash/<caseKey>/`。

- [ ] **Step 4: 跑存储测试**

运行：`npm run test -- tests/server/fs-store.test.ts`  
预期：项目目录能创建、用例能写入和读取、删除能移动到回收站、运行目录能自动生成。

### Task 3: 实现项目与用例的本地 API

**Files:**
- Create: `server/src/routes/projects.ts`
- Create: `server/src/routes/cases.ts`
- Create: `server/src/routes/runs.ts`
- Create: `server/src/routes/auth.ts`
- Create: `server/src/app.ts`
- Create: `tests/server/api-projects.test.ts`
- Create: `tests/server/api-cases.test.ts`

- [ ] **Step 1: 实现项目 CRUD**

`POST /api/projects` 创建项目并生成 `data/projects/<projectKey>/project.json`。  
`GET /api/projects` 返回全部项目列表。  
`GET /api/projects/:projectKey` 返回单个项目详情。  
创建项目时前端只提交名称、标识、URL，目录创建和 JSON 写入全部由 Node 服务完成。

- [ ] **Step 2: 实现用例 CRUD**

`POST /api/projects/:projectKey/cases` 创建用例目录和 `case.json`。  
`PUT /api/projects/:projectKey/cases/:caseKey` 更新用例名称、起始路径、步骤列表和断言。  
`DELETE /api/projects/:projectKey/cases/:caseKey` 把整个目录移动到回收站。  
`GET /api/projects/:projectKey/cases` 只返回 `cases/` 下仍然可用的用例。

- [ ] **Step 3: 实现回收站查询**

`GET /api/projects/:projectKey/trash` 返回回收站中的用例目录列表。  
这样前端能单独展示“可用用例”和“已删除用例”，并支持后续恢复或彻底清理。

- [ ] **Step 4: 跑 API 测试**

运行：`npm run test -- tests/server/api-projects.test.ts tests/server/api-cases.test.ts`  
预期：新建、编辑、删除、查询回收站都返回正确结果。

### Task 4: 搭建 Vue 3 本地管理界面

**Files:**
- Create: `web/src/router/index.ts`
- Create: `web/src/stores/app.ts`
- Create: `web/src/api/http.ts`
- Create: `web/src/api/projects.ts`
- Create: `web/src/api/cases.ts`
- Create: `web/src/pages/ProjectList.vue`
- Create: `web/src/pages/ProjectDetail.vue`
- Create: `web/src/pages/CaseEditor.vue`
- Create: `web/src/pages/RunCenter.vue`
- Create: `web/src/components/ProjectForm.vue`
- Create: `web/src/components/CaseForm.vue`
- Create: `web/src/components/StepList.vue`
- Create: `web/src/components/StepForm.vue`
- Create: `web/src/components/TrashPanel.vue`
- Create: `web/src/components/ArtifactPanel.vue`
- Create: `tests/e2e/project-ui.spec.ts`

- [ ] **Step 1: 做项目列表与新建项目弹窗**

首页展示项目列表、项目状态、最近运行时间和进入按钮。  
新建项目弹窗收集项目名称、项目标识和项目 URL，提交后由 API 创建目录。

- [ ] **Step 2: 做项目详情页**

项目详情页展示项目环境、用例列表、回收站、运行入口和产物导出入口。  
测试人员可以在这里完成“看项目、建用例、进回收站、跑测试”的所有主流程。

- [ ] **Step 3: 做可视化步骤编辑器**

编辑器按步骤列表展示当前用例的动作、选择器、输入值、等待时间和断言。  
用户可以拖动顺序、修改输入值、修改选择器、修改断言文本、删除步骤，不需要直接接触源码。

- [ ] **Step 4: 跑界面冒烟测试**

运行：`npm run test:e2e -- tests/e2e/project-ui.spec.ts`  
预期：能从首页创建项目、进入项目详情、看到用例列表和回收站入口。

### Task 5: 实现录制会话与临时登录态

**Files:**
- Create: `server/src/services/record-session.ts`
- Create: `server/src/services/auth-session.ts`
- Create: `server/src/services/browser.ts`
- Create: `server/src/routes/record.ts`
- Create: `web/src/components/LoginDialog.vue`
- Create: `web/src/components/RecorderPanel.vue`
- Create: `web/src/pages/RecordSession.vue`
- Create: `tests/e2e/record-session.spec.ts`

- [ ] **Step 1: 录制前要求输入用户名和密码**

启动录制会话时，前端弹出登录对话框，用户一次性输入用户名和密码。  
前端不保存这两个值，直接发送给 Node 服务，由 Node 服务驱动 Playwright 浏览器登录。

- [ ] **Step 2: 保存本次运行的临时登录态**

登录成功后，Playwright 生成的 `storageState` 保存到 `data/projects/<projectKey>/runs/<runId>/auth/storageState.json`。  
这个文件只用于本次运行，不写入项目长期配置，运行结束后由清理逻辑删除。

- [ ] **Step 3: 让录制会话可见**

录制过程中，Node 服务通过 SSE 推送当前步骤、页面 URL、输入值和点击动作，前端显示实时状态。  
这样测试人员能边操作浏览器边看到录制结果是否已经被抓到。

- [ ] **Step 4: 跑录制流程测试**

运行：`npm run test:e2e -- tests/e2e/record-session.spec.ts`  
预期：能输入用户名密码、完成登录、生成临时 `storageState`、看到录制动作进入步骤列表。

### Task 6: 生成 Playwright 测试文件并支持步骤级断言

**Files:**
- Create: `server/src/services/case-generator.ts`
- Create: `server/src/services/assertion.ts`
- Create: `server/src/services/step-normalizer.ts`
- Create: `web/src/components/AssertionDialog.vue`
- Create: `web/src/components/StepPreview.vue`
- Create: `tests/server/case-generator.test.ts`

- [ ] **Step 1: 把 case.json 变成可运行的 spec.ts**

`case.json` 作为真实数据源，保存后立即生成对应的 `case.spec.ts`。  
生成规则要支持 `goto`、`click`、`fill`、`select`、`wait`、`assertText`、`assertVisible`、`assertUrl` 等步骤。

- [ ] **Step 2: 支持断言补充**

录制过程中自动生成的步骤不够完整时，用户可以在断言弹窗里补充页面可见性、文本、URL 和标题断言。  
断言保存后同步回 `case.json`，再重新生成 `case.spec.ts`。

- [ ] **Step 3: 保持生成结果可迁移**

生成的 `case.spec.ts` 必须是标准 Playwright TypeScript 测试文件，后续可以直接复制到别的项目里跑。  
这样平台内管理和外部项目迁移使用同一份测试逻辑，不需要额外转换。

- [ ] **Step 4: 跑生成器测试**

运行：`npm run test -- tests/server/case-generator.test.ts`  
预期：同一份 `case.json` 每次都能生成稳定的 `case.spec.ts`，断言和步骤顺序保持一致。

### Task 7: 实现按项目运行测试、报告与产物导出

**Files:**
- Create: `server/src/services/runner.ts`
- Create: `server/src/services/report.ts`
- Create: `server/src/services/export.ts`
- Create: `server/src/services/artifact.ts`
- Create: `server/src/routes/run-exec.ts`
- Modify: `playwright.config.ts`
- Create: `web/src/pages/RunCenter.vue`
- Create: `web/src/components/RunStatus.vue`
- Create: `web/src/components/ExportDialog.vue`
- Create: `tests/e2e/run-export.spec.ts`

- [ ] **Step 1: 只运行当前项目的可用用例**

运行时只扫描 `data/projects/<projectKey>/cases/`，不读取 `trash/`。  
通过项目和环境配置把 `baseURL`、临时 `storageState`、截图、视频和 trace 统一注入到 Playwright。

- [ ] **Step 2: 生成 Playwright 原生报告与产物**

每次运行都生成 HTML report、截图、视频和 trace，并放入 `data/projects/<projectKey>/runs/<runId>/`。  
运行结束后前端可以直接查看报告，也可以把整次运行导出成压缩包。

- [ ] **Step 3: 支持导出**

导出时把 `html-report/`、`test-results/`、`screenshots/`、`videos/`、`traces/` 一并打包。  
这样测试人员可以把一次运行的完整证据直接发给别人复核。

- [ ] **Step 4: 跑运行与导出测试**

运行：`npm run test:e2e -- tests/e2e/run-export.spec.ts`  
预期：能按项目启动运行、生成报告、看到截图/视频/trace，并成功导出压缩包。

### Task 8: 补全验收路径、文档和回归检查

**Files:**
- Create: `README.md`
- Create: `tests/e2e/full-flow.spec.ts`
- Create: `tests/server/validation.test.ts`

- [ ] **Step 1: 写最小使用说明**

`README.md` 只写本地启动、目录结构、项目创建、录制、运行、导出这五件事，不写大段概念说明。  
目标是让测试人员第一次打开仓库时能知道怎么启动和怎么用。

- [ ] **Step 2: 跑一条完整用户链路**

运行：`npm run test:e2e -- tests/e2e/full-flow.spec.ts`  
预期：从新建项目、输入 URL、录制登录、编辑步骤、保存用例、删除到回收站、重新运行、导出报告，整条链路都能走通。

- [ ] **Step 3: 统一做最终回归**

运行：`npm run lint && npm run test && npm run test:e2e`  
预期：代码风格、单元测试、界面流程都稳定通过，才进入第一版对外使用。

