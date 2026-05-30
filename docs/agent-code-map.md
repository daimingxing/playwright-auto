# 代码地图

本文件只在需要定位代码入口时查阅。不要把它当作启动必读上下文。

## 按问题类型查找

- 涉及核心数据结构、步骤类型、运行状态：看 `shared/types.ts`
- 涉及前端页面跳转：看 `web/src/router/index.ts`
- 涉及前端页面逻辑：看 `web/src/pages/<页面目录>/*`
- 涉及前端请求：看 `web/src/api/*`
- 涉及前端跨页面 UI 状态：看 `web/src/state/project-ui.ts`
- 涉及后端 API 挂载：看 `server/src/app.ts`
- 涉及具体后端接口：看 `server/src/routes/*`
- 涉及业务流程：看 `server/src/services/*`，复杂任务优先看对应子目录
- 涉及文件读写、路径、参数校验、HTTP 错误：看 `server/src/lib/*`
- 涉及测试：按领域看 `tests/server/*`、`tests/web/*`、`tests/smoke/*`
- 涉及存储的数据和playwright测试报告：`data/projects/*`

## 功能入口

- 项目管理：`web/src/api/projects.ts`、`server/src/routes/projects.ts`、`server/src/lib/project-store.ts`
- 用例管理、回收站、导出：`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/lib/case-store.ts`、`server/src/services/export.ts`
- 用例状态、批量状态切换：`shared/types.ts`、`web/src/pages/project-detail/ProjectDetail.vue`、`web/src/api/cases.ts`、`server/src/routes/cases.ts`、`server/src/lib/case-store.ts`
- 基础检查和定位质量检查：`shared/case-review.ts`、`server/src/services/case-review/index.ts`、`web/src/pages/case-editor/case-editor.ts`、`web/src/pages/case-editor/CaseEditor.vue`、`web/src/pages/case-editor/case-editor-composables.ts`，规则文档见 `docs/case-review-rules.md`
- 定位器构建器：`shared/locator-builder.ts`、`web/src/pages/locator-builder/locator-builder.ts`、`web/src/components/LocatorBuilderDrawer.vue`、`server/src/services/case/case-step-render.ts`、`server/src/services/case/case-generator.ts`、`server/src/services/practical-review/practical-review-spec.ts`，设计和能力矩阵见 `docs/locator-builder-development.md`
- 用例步骤编辑和批量操作：`web/src/pages/case-editor/CaseEditor.vue`、`web/src/pages/case-editor/case-editor.ts`、`web/src/pages/case-editor/case-editor-composables.ts`、`tests/web/case-editor.test.ts`、`tests/web/case-editor-composables.test.ts`
- 用例步骤生成 Playwright spec：`server/src/services/case/case-generator.ts`、`server/src/services/case/case-step-render.ts`
- Playwright codegen 录制导入：`server/src/routes/record.ts`、`server/src/services/record/record-session.ts`、`server/src/services/record/codegen-parser.ts`
- AI 自然语言用例导入：`shared/types.ts`、`server/src/services/import/import-excel.ts`、`server/src/services/import/import-worker.ts`、`server/src/services/ai/ai-case-draft.ts`、`server/src/services/ai/page-context.ts`、`server/src/services/ai/page-map.ts`、`server/src/lib/page-map-store.ts`、`server/src/routes/page-maps.ts`、`web/src/api/page-maps.ts`、`web/src/pages/ai-import/AiImportList.vue`、`web/src/pages/ai-import/AiImportPreview.vue`、`web/src/pages/ai-import/ai-import.ts`，新版两表模板和说明见 `docs/ai-case-import/`
- AI 导入页面地图缓存与降级生成：`server/src/services/import/import-worker.ts` 负责按目标 URL 分组、复用页面地图 snapshot、分组生成、拆小批降级和单条降级；`server/src/services/ai/page-map.ts` 负责安全探索边界和缓存刷新；`web/src/pages/ai-import/ai-import.ts`、`AiImportPreview.vue` 负责分组状态和降级提示展示
- 页面地图字段语义层：`server/src/services/ai/page-context.ts` 定义并采集 `PageContext.fields`，Kendo 控件优先从同一字段容器内的 `label` 归属字段名；`server/src/services/ai/ai-case-draft.ts` 在 AI 输入摘要和 selector 补全中优先消费 `fields`，找不到字段证据再回退旧 `elements`；`server/src/routes/page-maps.ts` 的详情接口从 snapshot 展开 `fields` 到状态响应；`web/src/pages/ai-import/AiImportList.vue` 的页面地图详情抽屉展示字段名、类型、UI、当前值、首选 selector、唯一性和来源置信度，便于诊断页面地图质量。
- 运行项目与报告：`web/src/api/runs.ts`、`web/src/pages/run-center/RunCenter.vue`、`web/src/pages/run-center/run-center.ts`、`server/src/routes/runs.ts`、`server/src/services/run/runner.ts`、`server/src/lib/run-store.ts`
- 登录态：`web/src/api/auth.ts`、`server/src/routes/auth.ts`、`server/src/services/auth-session.ts`
- 本地应用配置、CORS 来源、浏览器打开业务 URL 等待和步骤默认等待时间：`playwright-auto.config.json`、`shared/types.ts`、`server/src/lib/app-config.ts`、`server/src/app.ts`、`web/src/api/projects.ts`
- 离线浏览器依赖：`server/src/services/playwright/vendor-browser.ts`、`server/src/services/playwright/browser-path.ts`、`scripts/install-browsers.mjs`
- 开发启动健康检查：`scripts/wait-for-server.ts`、`package.json`
- 路径参数校验和 HTTP 错误：`server/src/lib/guard.ts`、`server/src/lib/http-error.ts`、`server/src/lib/path.ts`、`server/src/app.ts`
- Playwright CLI 子进程启动：`playwright.config.ts`、`server/src/services/playwright/playwright-cli.ts`、`server/src/services/run/runner.ts`、`server/src/services/practical-review/practical-review.ts`、`server/src/services/record/record-session.ts`

## 调用关系

- 前端页面通过 `web/src/api/*` 调用 `/api/*`
- Vite 开发代理在 `web/vite.config.ts` 中把 `/api` 转发到本地服务
- `npm run dev` 通过 `scripts/wait-for-server.ts` 等待 `/health` 通过后再启动前端开发服务
- 后端路由由 `server/src/app.ts` 统一挂载到 Express
- `server/src/app.ts` 统一处理 CORS、Zod 参数错误、HTTP 错误状态码和兜底异常
- 路由层只处理 HTTP 入参和响应，主要业务逻辑放在 `server/src/services/*` 或 `server/src/lib/*`
- 路径函数在拼接文件系统路径前会调用 `guard.ts` 做最后校验
- 新建项目会在 `web/src/pages/project-list/ProjectList.vue` 和 `server/src/lib/schema.ts` 将项目标识归一化为小写，路径参数仍由 `guard.ts` 按小写规则校验
- 运行、录制和实测检查都使用当前 Node 进程执行本地 Playwright CLI，避免经过 shell 解析；运行和实测检查通过 `server/src/services/playwright/playwright-cli.ts` 统一收集输出、处理退出码、处理启动错误和取消信号
- 持久化数据写入 `data/projects/<projectKey>/`
- `case.json` 是用例源数据，`case.spec.ts` 是由 `case.json` 生成的运行文件
- `case.json.status` 控制用例生命周期，只有 `active` 且基础检查通过的用例能进入运行中心
- `case.json.review` 是基础检查结果，包含完整性、定位、断言和等待时间问题
- `case.json.steps[].selector` 保存最终定位表达式，`case.json.steps[].selectorDraft` 保存定位器构建器结构化状态；生成正式测试文件和实测检查脚本时优先用 `selectorDraft` 渲染内部 Locator 的页面变量前缀
- 保存草稿只写 `case.json`，保存并生成测试文件、切换到待启用或启用时会刷新 `case.spec.ts`
- `web/src/state/project-ui.ts` 保存项目环境选择、项目页状态筛选和运行中心用例选择
- AI 导入按项目、环境、目标 URL、登录态、视口和控件库命中页面地图缓存；分组生成失败时先拆小批，再降级单条生成，降级过程复用同一页面地图 snapshot，不重新采集页面
- `browser.openTimeoutMs` 是平台打开业务 URL 的统一上限，手动登录初始打开和页面地图初始采集共用；`ai.timeoutMs` 只控制模型请求，`steps.timeouts` 只控制生成、运行和实测步骤等待。
- 页面地图探索会跳过保存、删除、提交等高风险动作，相关提示写入页面地图 warning，预览页只展示提示，不把它当作生成失败
- `PageContext.fields` 是页面地图 snapshot 内的字段语义层，页面地图详情接口会只读 snapshot 并展开到状态字段；如果旧缓存缺少 snapshot，详情仍可返回并在状态 warning 中说明字段语义未展开。Kendo options 展开采集暂未实现，后续如补充下拉选项读取，需要同步检查 `page-context.ts`、`page-map.ts`、AI 摘要和页面地图详情展示。

## 修改提醒

- 改共享类型时，同步检查前端页面、前端 API、后端存储和测试
- 改用例状态或基础检查规则时，同步检查 `shared/types.ts`、`shared/case-review.ts`、`server/src/services/case-review/index.ts`、`case-store.ts`、`routes/cases.ts`、`server/src/services/run/runner.ts`、`ProjectDetail.vue`、`CaseEditor.vue`、`RunCenter.vue` 和相关测试
- 改 API 路径或响应结构时，同步检查 `web/src/api/*`、`server/src/routes/*` 和对应 `tests/server/*`
- 改用例步骤类型或定位器草稿结构时，同步检查 `shared/types.ts`、`shared/locator-builder.ts`、`CaseEditor.vue`、`LocatorBuilderDrawer.vue`、`web/src/pages/case-editor/case-editor.ts`、`server/src/services/case/case-step-render.ts`、`server/src/services/case/case-generator.ts`、`server/src/services/practical-review/practical-review-spec.ts`、`server/src/services/record/codegen-parser.ts` 和相关测试
- 改用例步骤编辑交互、批量操作、登录态、录制或实测检查时，同步检查 `CaseEditor.vue`、`web/src/pages/case-editor/case-editor.ts`、`web/src/pages/case-editor/case-editor-composables.ts`、`tests/web/case-editor.test.ts` 和 `tests/web/case-editor-composables.test.ts`
- 改配置类型、浏览器打开等待、步骤默认等待时间或前端可见配置时，同步检查 `playwright-auto.config.json`、`shared/types.ts`、`app-config.ts`、`app.ts`、`auth-session.ts`、`page-context.ts`、`page-map.ts`、`web/src/api/projects.ts`、`CaseEditor.vue`、`web/src/pages/case-editor/case-editor-composables.ts`、`server/src/services/record/codegen-parser.ts` 和相关测试
- 改 `server.corsOrigins` 或本地服务来源限制时，同步检查 `playwright-auto.config.json`、`app-config.ts`、`app.ts`、`README.md` 和 `tests/server/api-projects.test.ts`
- 改路径参数规则时，同步检查 `guard.ts`、`path.ts`、相关路由和 API 测试
- 改新建项目标识归一化时，同步检查 `web/src/pages/project-list/ProjectList.vue`、`schema.ts`、`project-store.ts` 和 `tests/server/api-projects.test.ts`
- 改错误状态码时，同步检查 `http-error.ts`、`app.ts`、前端错误提示和相关 API 测试
- 改 Playwright 子进程启动、输出收集、退出码、取消或清理策略时，同步检查 `playwright.config.ts`、`server/src/services/playwright/playwright-cli.ts`、`server/src/services/run/runner.ts`、`server/src/services/practical-review/practical-review.ts`、`server/src/services/record/record-session.ts` 和相关服务测试
- 改运行报告时，同步检查 `runner.ts`、`run-store.ts`、`routes/runs.ts` 和 `tests/server/api-runs.test.ts`
- 改登录态时，同步检查 `auth-session.ts`、`routes/auth.ts`、`web/src/pages/run-center/RunCenter.vue`、`tests/web/run-center.test.ts` 和 `tests/server/api-auth.test.ts`
- 改开发启动顺序时，同步检查 `package.json`、`scripts/wait-for-server.ts`、`docs/agent-commands.md` 和 `tests/scripts/wait-for-server.test.ts`
- 改 AI 导入模板、源字段、页面地图、分组降级或预览展示时，同步检查 `shared/types.ts`、`import-excel.ts`、`import-worker.ts`、`ai-case-draft.ts`、`page-map.ts`、`page-map-store.ts`、`routes/imports.ts`、`routes/page-maps.ts`、`AiImportPreview.vue`、`ai-import.ts`、`tests/server/import-worker.test.ts`、`tests/server/api-imports.test.ts`、`tests/server/import-excel.test.ts`、`tests/server/api-page-maps.test.ts`、`tests/web/ai-import.test.ts` 和 `docs/ai-case-import/`
