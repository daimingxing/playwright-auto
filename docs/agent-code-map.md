# 代码地图

本文件只在需要定位代码入口或判断业务边界时查阅，不作为启动必读上下文。

## 维护原则

- 本文件只维护“问题到首要入口”的导航和跨模块稳定约束，不记录完整依赖、调用方或测试清单。
- 每个条目只保留最少的首要文件或目录；需要继续追踪调用关系、关联页面或测试时，使用 CodeGraph 和当前代码渐进展开。
- 仅在新增业务边界、入口迁移或稳定行为变化时更新本文件；局部实现调整不更新。
- 路径或行为不再成立时删除或修正对应条目，避免保留历史说明。

## 按问题类型查找

- 核心数据结构、步骤类型、运行状态：`shared/types.ts`
- 前端路由：`web/src/router/index.ts`
- 前端页面逻辑：`web/src/pages/`
- 前端请求：`web/src/api/`
- 跨页面 UI 状态：`web/src/state/project-ui.ts`
- 后端 API 挂载：`server/src/app.ts`
- 具体后端接口：`server/src/routes/`
- 业务流程：`server/src/services/`
- 文件读写、路径、参数校验、HTTP 错误：`server/src/lib/`
- 自动化测试：`tests/server/`、`tests/web/`、`tests/smoke/`
- 项目数据和 Playwright 报告：`data/projects/`

## 业务入口

- 项目管理：`web/src/api/projects.ts`、`server/src/routes/projects.ts`
- 用例管理、回收站和导出：`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/services/export.ts`
- 用例状态和基础检查：`shared/types.ts`、`shared/case-review.ts`、`server/src/services/case-review/`
- 步骤编辑和批量操作：`web/src/pages/case-editor/`
- 定位器构建器：`shared/locator-builder.ts`、`web/src/components/LocatorBuilderDrawer.vue`
- Playwright spec 生成：`server/src/services/case/case-generator.ts`、`server/src/services/case/case-step-render.ts`
- Playwright codegen 录制：`server/src/routes/record.ts`、`server/src/services/record/`
- 用例运行和报告：`web/src/pages/run-center/`、`server/src/routes/runs.ts`、`server/src/services/run/`
- 项目登录态：`web/src/composables/project-auth.ts`、`server/src/routes/auth.ts`、`server/src/services/auth-session.ts`
- AI 导入任务与 Excel 解析：`web/src/api/imports.ts`、`web/src/pages/ai-import/`、`server/src/routes/imports.ts`、`server/src/services/import/`、`server/src/lib/import-store.ts`
- 页面档案、版本替换与 Exploration Lease：`server/src/lib/page-archive-store.ts`、`server/src/services/import/exploration-lease.ts`、`web/src/pages/page-archives/`
- 导入任务检查点、恢复、清理与删除：`server/src/lib/import-store.ts`、`server/src/routes/imports.ts`
- TestIntent 审阅、OpenCode 探索与 Fake AgentRunner：`shared/types.ts`、`server/src/services/import/agent-runner.ts`、`server/src/services/import/opencode-runner.ts`、`server/src/services/import/import-review.ts`
- Action IR 预览、定位编辑与显式发布：`server/src/services/import/intent-compile.ts`、`server/src/services/import/import-action-ir.ts`、`server/src/services/import/import-publish.ts`
- 项目测试资产库：`server/src/lib/asset-store.ts`
- 本地应用配置和 CORS：`playwright-auto.config.json.example`、`server/src/lib/app-config.ts`
- 浏览器依赖：`server/src/services/playwright/`、`scripts/install-browsers.mjs`
- 开发启动入口：`package.json`
- 路径参数和 HTTP 错误：`server/src/lib/guard.ts`、`server/src/lib/http-error.ts`

## 稳定约束

- 前端通过 `web/src/api/` 调用 `/api/`，Vite 在 `web/vite.config.ts` 将 `/api` 转发到本地服务。
- 后端路由由 `server/src/app.ts` 挂载；路由层处理 HTTP 入参和响应，业务逻辑放在 `server/src/services/` 或 `server/src/lib/`。
- `data/projects/<projectKey>/` 保存项目数据；`case.json` 是用例源数据，`case.spec.ts` 由它生成。
- AI 导入任务保存在 `data/projects/<projectKey>/imports/<taskId>/`，解析结果属于任务临时数据；确认后的 TestIntent 保存在任务 `cases/<itemId>/intent.json`。只有显式发布才写入正式 `case.json`。
- 测试资产保存在 `data/projects/<projectKey>/assets/<sha256>/`，按内容去重；导入任务不得因相同文件哈希而跳过创建。
- 导入任务恢复以 `checkpoint.json` 和逐用例 `status.json` 为准，不重新解析 Excel。
- Agent 过程资料写入该任务的 `work/`、`output/`、`diagnostics/`；清理只删除这些目录，不影响已确认意图、输入快照、检查点、正式用例或其他项目。删除整个导入任务会去掉该任务目录，仍不影响已发布正式用例和项目资产库。
- 页面档案保存在 `data/projects/<projectKey>/page-archives/`，使用 current/previous 不可变版本；刷新或删除不修改已发布 `case.json` / `case.spec.ts`。
- 页面探索按探索租约去重；成功探索写入项目级页面档案，后续同一页面用例复用已验证定位器。AgentRunner 可替换；生产默认 OpenCode + 官方 Playwright MCP，测试可注入 Fake。单次探索定位器仍写入任务 `output/`，确认后保留在 `cases/<itemId>/exploration.json`。
- 只有 `active` 且基础检查通过的用例能进入运行中心。
- `browser.openTimeoutMs` 控制平台打开业务 URL；`steps.timeouts` 控制生成、运行和实测等待。

## 相关文档

- 基础检查和定位质量规则：`docs/case-review-rules.md`
