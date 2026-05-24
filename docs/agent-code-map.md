# 代码地图

本文件只在需要定位代码入口时查阅。不要把它当作启动必读上下文。

## 按问题类型查找

- 涉及核心数据结构、步骤类型、运行状态：看 `shared/types.ts`
- 涉及前端页面跳转：看 `web/src/router/index.ts`
- 涉及前端页面逻辑：看 `web/src/pages/*`
- 涉及前端请求：看 `web/src/api/*`
- 涉及前端跨页面 UI 状态：看 `web/src/state/project-ui.ts`
- 涉及后端 API 挂载：看 `server/src/app.ts`
- 涉及具体后端接口：看 `server/src/routes/*`
- 涉及业务流程：看 `server/src/services/*`
- 涉及文件读写、路径、参数校验、HTTP 错误：看 `server/src/lib/*`
- 涉及测试：按领域看 `tests/server/*`、`tests/web/*`、`tests/smoke/*`
- 涉及存储的数据和playwright测试报告：`data/projects/*`

## 功能入口

- 项目管理：`web/src/api/projects.ts`、`server/src/routes/projects.ts`、`server/src/lib/project-store.ts`
- 用例管理、回收站、导出：`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/lib/case-store.ts`、`server/src/services/export.ts`
- 用例状态、批量状态切换：`shared/types.ts`、`web/src/pages/ProjectDetail.vue`、`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/lib/case-store.ts`
- 基础检查和定位质量检查：`shared/case-review.ts`、`server/src/services/case-review/index.ts`、`web/src/pages/case-editor.ts`、`web/src/pages/CaseEditor.vue`，规则文档见 `docs/case-review-rules.md`
- 定位器构建器：`shared/locator-builder.ts`、`web/src/pages/locator-builder.ts`、`web/src/components/LocatorBuilderDrawer.vue`、`server/src/services/case-generator.ts`、`server/src/services/practical-review-spec.ts`，设计和能力矩阵见 `docs/locator-builder-development.md`
- 用例步骤编辑和批量操作：`web/src/pages/CaseEditor.vue`、`web/src/pages/case-editor.ts`、`tests/web/case-editor.test.ts`
- 用例步骤生成 Playwright spec：`server/src/services/case-generator.ts`
- Playwright codegen 录制导入：`server/src/routes/record.ts`、`server/src/services/record-session.ts`、`server/src/services/codegen-parser.ts`
- 运行项目与报告：`web/src/api/runs.ts`、`web/src/pages/RunCenter.vue`、`web/src/pages/run-center.ts`、`server/src/routes/runs.ts`、`server/src/services/runner.ts`、`server/src/lib/run-store.ts`
- 登录态：`web/src/api/auth.ts`、`server/src/routes/auth.ts`、`server/src/services/auth-session.ts`
- 本地应用配置、CORS 来源和步骤默认等待时间：`playwright-auto.config.json`、`server/src/lib/app-config.ts`、`server/src/app.ts`、`web/src/api/projects.ts`
- 离线浏览器依赖：`server/src/services/vendor-browser.ts`、`server/src/services/browser-path.ts`、`scripts/install-browsers.mjs`
- 开发启动健康检查：`scripts/wait-for-server.ts`、`package.json`
- 路径参数校验和 HTTP 错误：`server/src/lib/guard.ts`、`server/src/lib/http-error.ts`、`server/src/lib/path.ts`、`server/src/app.ts`
- Playwright CLI 子进程启动：`server/src/services/playwright-cli.ts`、`server/src/services/runner.ts`、`server/src/services/practical-review.ts`、`server/src/services/record-session.ts`

## 调用关系

- 前端页面通过 `web/src/api/*` 调用 `/api/*`
- Vite 开发代理在 `web/vite.config.ts` 中把 `/api` 转发到本地服务
- `npm run dev` 通过 `scripts/wait-for-server.ts` 等待 `/health` 通过后再启动前端开发服务
- 后端路由由 `server/src/app.ts` 统一挂载到 Express
- `server/src/app.ts` 统一处理 CORS、Zod 参数错误、HTTP 错误状态码和兜底异常
- 路由层只处理 HTTP 入参和响应，主要业务逻辑放在 `server/src/services/*` 或 `server/src/lib/*`
- 路径函数在拼接文件系统路径前会调用 `guard.ts` 做最后校验
- 新建项目会在 `web/src/pages/ProjectList.vue` 和 `server/src/lib/schema.ts` 将项目标识归一化为小写，路径参数仍由 `guard.ts` 按小写规则校验
- 运行、录制和实测检查都使用当前 Node 进程执行本地 Playwright CLI，避免经过 shell 解析
- 持久化数据写入 `data/projects/<projectKey>/`
- `case.json` 是用例源数据，`case.spec.ts` 是由 `case.json` 生成的运行文件
- `case.json.status` 控制用例生命周期，只有 `active` 且基础检查通过的用例能进入运行中心
- `case.json.review` 是基础检查结果，包含完整性、定位、断言和等待时间问题
- `case.json.steps[].selector` 保存最终定位表达式，`case.json.steps[].selectorDraft` 保存定位器构建器结构化状态；生成正式测试文件和实测检查脚本时优先用 `selectorDraft` 渲染内部 Locator 的页面变量前缀
- 保存草稿只写 `case.json`，保存并生成测试文件、切换到待启用或启用时会刷新 `case.spec.ts`
- `web/src/state/project-ui.ts` 保存项目环境选择、项目页状态筛选和运行中心用例选择

## 修改提醒

- 改共享类型时，同步检查前端页面、前端 API、后端存储和测试
- 改用例状态或基础检查规则时，同步检查 `shared/types.ts`、`shared/case-review.ts`、`server/src/services/case-review/index.ts`、`case-store.ts`、`routes/cases.ts`、`runner.ts`、`ProjectDetail.vue`、`CaseEditor.vue`、`RunCenter.vue` 和相关测试
- 改 API 路径或响应结构时，同步检查 `web/src/api/*`、`server/src/routes/*` 和对应 `tests/server/*`
- 改用例步骤类型或定位器草稿结构时，同步检查 `shared/types.ts`、`shared/locator-builder.ts`、`CaseEditor.vue`、`LocatorBuilderDrawer.vue`、`case-editor.ts`、`case-generator.ts`、`practical-review-spec.ts`、`codegen-parser.ts` 和相关测试
- 改用例步骤编辑交互或批量操作时，同步检查 `CaseEditor.vue`、`case-editor.ts` 和 `tests/web/case-editor.test.ts`
- 改步骤默认等待时间配置时，同步检查 `playwright-auto.config.json`、`app-config.ts`、`web/src/api/projects.ts`、`CaseEditor.vue`、`codegen-parser.ts` 和相关测试
- 改 `server.corsOrigins` 或本地服务来源限制时，同步检查 `playwright-auto.config.json`、`app-config.ts`、`app.ts`、`README.md` 和 `tests/server/api-projects.test.ts`
- 改路径参数规则时，同步检查 `guard.ts`、`path.ts`、相关路由和 API 测试
- 改新建项目标识归一化时，同步检查 `ProjectList.vue`、`schema.ts`、`project-store.ts` 和 `tests/server/api-projects.test.ts`
- 改错误状态码时，同步检查 `http-error.ts`、`app.ts`、前端错误提示和相关 API 测试
- 改 Playwright 子进程启动策略时，同步检查 `playwright-cli.ts`、`runner.ts`、`practical-review.ts`、`record-session.ts` 和相关服务测试
- 改运行报告时，同步检查 `runner.ts`、`run-store.ts`、`routes/runs.ts` 和 `tests/server/api-runs.test.ts`
- 改登录态时，同步检查 `auth-session.ts`、`routes/auth.ts`、`RunCenter.vue`、`tests/web/run-center.test.ts` 和 `tests/server/api-auth.test.ts`
- 改开发启动顺序时，同步检查 `package.json`、`scripts/wait-for-server.ts`、`docs/agent-commands.md` 和 `tests/scripts/wait-for-server.test.ts`
