# 代码地图

本文件只在需要定位代码入口时查阅。不要把它当作启动必读上下文。

## 按问题类型查找

- 涉及核心数据结构、步骤类型、运行状态：看 `shared/types.ts`
- 涉及前端页面跳转：看 `web/src/router/index.ts`
- 涉及前端页面逻辑：看 `web/src/pages/*`
- 涉及前端请求：看 `web/src/api/*`
- 涉及后端 API 挂载：看 `server/src/app.ts`
- 涉及具体后端接口：看 `server/src/routes/*`
- 涉及业务流程：看 `server/src/services/*`
- 涉及文件读写、路径、校验：看 `server/src/lib/*`
- 涉及测试：按领域看 `tests/server/*`、`tests/web/*`、`tests/smoke/*`
- 涉及存储的数据和playwright测试报告：`data/projects/*`

## 功能入口

- 项目管理：`web/src/api/projects.ts`、`server/src/routes/projects.ts`、`server/src/lib/project-store.ts`
- 用例管理、回收站、导出：`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/lib/case-store.ts`、`server/src/services/export.ts`
- 用例步骤编辑和批量操作：`web/src/pages/CaseEditor.vue`、`web/src/pages/case-editor.ts`、`tests/web/case-editor.test.ts`
- 用例步骤生成 Playwright spec：`server/src/services/case-generator.ts`
- Playwright codegen 录制导入：`server/src/routes/record.ts`、`server/src/services/record-session.ts`、`server/src/services/codegen-parser.ts`
- 运行项目与报告：`web/src/api/runs.ts`、`server/src/routes/runs.ts`、`server/src/services/runner.ts`、`server/src/lib/run-store.ts`
- 登录态：`web/src/api/auth.ts`、`server/src/routes/auth.ts`、`server/src/services/auth-session.ts`
- 本地应用配置和步骤默认等待时间：`playwright-auto.config.json`、`server/src/lib/app-config.ts`、`server/src/app.ts`、`web/src/api/projects.ts`
- 离线浏览器依赖：`server/src/services/vendor-browser.ts`、`server/src/services/browser-path.ts`、`scripts/install-browsers.mjs`

## 调用关系

- 前端页面通过 `web/src/api/*` 调用 `/api/*`
- Vite 开发代理在 `web/vite.config.ts` 中把 `/api` 转发到本地服务
- 后端路由由 `server/src/app.ts` 统一挂载到 Express
- 路由层只处理 HTTP 入参和响应，主要业务逻辑放在 `server/src/services/*` 或 `server/src/lib/*`
- 持久化数据写入 `data/projects/<projectKey>/`
- 生成的用例文件包含 `case.json` 和 `case.spec.ts`

## 修改提醒

- 改共享类型时，同步检查前端页面、前端 API、后端存储和测试
- 改 API 路径或响应结构时，同步检查 `web/src/api/*`、`server/src/routes/*` 和对应 `tests/server/*`
- 改用例步骤类型时，同步检查 `shared/types.ts`、`CaseEditor.vue`、`case-editor.ts`、`case-generator.ts`、`codegen-parser.ts` 和相关测试
- 改用例步骤编辑交互或批量操作时，同步检查 `CaseEditor.vue`、`case-editor.ts` 和 `tests/web/case-editor.test.ts`
- 改步骤默认等待时间配置时，同步检查 `playwright-auto.config.json`、`app-config.ts`、`web/src/api/projects.ts`、`CaseEditor.vue`、`codegen-parser.ts` 和相关测试
- 改运行报告时，同步检查 `runner.ts`、`run-store.ts`、`routes/runs.ts` 和 `tests/server/api-runs.test.ts`
- 改登录态时，同步检查 `auth-session.ts`、`routes/auth.ts`、`RunCenter.vue` 和 `tests/server/api-auth.test.ts`
