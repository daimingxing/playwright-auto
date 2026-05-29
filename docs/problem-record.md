## 模板
---
## YYYY-MM-DD 问题的标题

- 状态：已解决/待解决/不解决只做记录
- 问题：
- 处理：
- 经验：

---

## 2026-05-27 PowerShell 批量替换误伤源码标点

- 状态：已解决
- 问题：目录迁移时用 PowerShell 数组保存替换对，嵌套数组被展开后，替换循环把 `.` 当成待替换文本，导致少数 TypeScript 文件里的属性访问和正则被替换成 `/`，例如 `summary.status` 变成 `summary/status`。
- 处理：先用 `npm run typecheck` 和 Serena 诊断定位语法错误，再从 Git 原始路径恢复被误伤文件，只重新应用明确的 import 路径修改；后续路径迁移改用 `apply_patch` 或带命名字段的对象数组，避免字符串数组被 PowerShell 展开。
- 经验：Windows 下批量改源码路径时，不要用易被展开的嵌套数组承载替换对；每轮替换后先跑 `typecheck` 和异常标点搜索，再继续扩大改动范围。

---

## 2026-05-27 Playwright 配置遗漏服务路径迁移

- 状态：已解决
- 问题：服务目录迁移后，`playwright.config.ts` 仍导入旧的 `server/src/services/browser-path` 和 `server/src/services/vendor-browser`。普通类型检查、接口测试和前端构建没有加载这份 Playwright 配置，点击“开始实测检查”时子进程才加载配置并返回 500。
- 处理：把 `playwright.config.ts` 的导入改为 `server/src/services/playwright/browser-path` 和 `server/src/services/playwright/vendor-browser`；在 `tests/smoke/startup.test.ts` 增加 Playwright 配置加载冒烟测试，先确认旧路径会失败，再确认修复后通过。
- 经验：迁移 Playwright 子进程相关文件时，必须把 `playwright.config.ts` 当作运行时入口一起检查；只跑 `typecheck` 和普通 Vitest 不足以覆盖 Playwright 配置加载。

---

## 2026-05-24 实测检查卡片高度回归

- 状态：已解决
- 问题：实测检查卡片为了让按钮贴到底部，使用 `min-height: 100%` 后没有同步处理盒模型，卡片的 padding 和 border 让实际高度超过父级 `.meta`，导致右侧卡片出现内部滚动，按钮需要滚动才能完整看到。
- 处理：把 `web/src/pages/CaseEditor.vue` 中的 `.practical-panel` 改为 `box-sizing: border-box` 和 `height: 100%`，保留纵向 flex 与按钮栏 `margin-top: auto`，让卡片贴合父级高度但不溢出。
- 经验：在已有 `max-height` 和 `overflow` 的容器内撑满子卡片时，优先确认 `scrollHeight` 与 `clientHeight`，并用边框盒计算高度，避免把内容底部固定变成滚动底部固定。

---

## 2026-05-23 后端结构性边界加固

- 状态：已解决
- 问题：路径参数校验、API 错误状态码、CORS 来源控制和 Playwright 子进程启动策略原本分散，后续扩展容易引入路径边界不清、错误语义混乱、跨站访问本地服务、命令经 shell 解析等风险。
- 处理：新增 `server/src/lib/guard.ts` 统一校验路径参数；新增 `server/src/lib/http-error.ts` 区分 `400/403/404/409/500`；`server.corsOrigins` 配置默认只允许本机前端来源并支持追加来源；新增 `server/src/services/playwright-cli.ts`，运行和实测检查改为 `process.execPath + 本地 Playwright CLI + shell:false`。
- 经验：本地工具也要把浏览器来源视为安全边界；`server.corsOrigins` 是 `playwright-auto.config.json` 中的字段，不是单独文件；路径校验应放在路径函数前作为最后防线，路由层和服务层只做业务语义判断。

---

## 2026-05-24 新建项目标识归一化范围控制

- 状态：已解决
- 问题：新建项目只需要把项目标识输入转为小写，迭代过程中容易顺手扩大到环境标识，导致小改动范围变大。
- 处理：只在新建项目提交和创建项目 schema 中归一化项目标识，环境标识继续沿用原有严格校验。
- 经验：标识类逻辑共用正则时，要先区分本次需求的入口范围；后端 schema 可做兜底归一化，路径 guard 仍保持严格校验作为文件系统边界。

---

## 2026-05-24 CodeGraph 索引滞后影响审查

- 状态：待解决
- 问题：全面审查时，CodeGraph 文件列表仍显示 `scripts/dev.mjs`、`scripts/wait-for-server.mjs` 和多个 `git_stats_*.cjs`，但真实文件系统通过 `rg --files` 和 `Get-Content` 确认这些脚本不存在或已不在当前工作树，说明 `.codegraph/` 索引滞后。
- 处理：本轮审查改以真实文件系统、`package.json`、现有测试和一次性复现脚本作为事实来源，只把 CodeGraph 作为结构入口参考。
- 经验：当 CodeGraph 与文件系统出现冲突时，先用 `rg --files` 或直接读取文件确认当前工作树；审查报告中的文件存在性、脚本接入状态和验证命令必须以当前文件系统为准。

---

## 2026-05-24 会话 TTL 资源清理补全

- 状态：已解决
- 问题：登录和录制会话增加 TTL 后，定时器到期如果只从 `Map` 删除会话，会丢失浏览器或 codegen 子进程引用，导致资源无法被后续保存/停止流程清理。
- 处理：TTL 定时器到期时先读取会话并调用统一清理函数，再删除会话记录；录制服务补充真实 codegen 子进程过期后触发 `SIGTERM` 的回归测试。
- 经验：会话过期不能只清理索引结构，必须同时释放索引指向的外部资源；测试应覆盖资源释放动作，而不是只验证后续接口返回过期错误。

---

## 2026-05-24 运行请求中断清理

- 状态：已解决
- 问题：为运行接口增加请求中断清理时，直接监听 `req.close` 会把正常请求体读取完成误判为客户端断开，导致正常运行被取消并返回 500。
- 处理：改为监听 `res.close`，并且只有响应尚未结束时才触发 `AbortController`；运行服务收到取消信号后统一结束 Playwright 子进程。
- 经验：Express 请求生命周期里，`req.close` 不等于“响应前客户端断开”；需要以响应对象是否写完作为取消判断边界，相关改动必须跑 API 级回归测试。

---

## 2026-05-26 AI 导入后端实现类型差异

- 状态：已解决
- 问题：AI 导入后端实现时同时遇到三类集成差异：PowerShell 外层双引号会吞掉 `$lines` 变量导致计划片段读取命令报错；Express 5 类型下 `multer` 中间件和路由泛型参数不完全兼容；AI SDK v5 的 `generateObject` 需要用 `zodSchema` 包装 Zod schema 并显式声明 `output: 'object'`。
- 处理：后续 PowerShell 复杂脚本改用单引号脚本块；导入路由参数类型增加索引签名并把 `upload.single('file')` 明确收窄为当前路由的 `RequestHandler`；AI 客户端通过项目自有 `ai-client` 封装 `generateObject`、`createOpenAICompatible` 和 `zodSchema`，业务服务不直接依赖 SDK 细节。
- 经验：Windows 仓库中读取计划或批量处理文本时要优先避开外层 `$` 展开；新增后端依赖后必须跑 `typecheck`，仅靠 Vitest 通过不足以发现 Express 和 SDK 的类型合同差异。

---

## 2026-05-26 DeepSeek 结构化输出兼容差异

- 状态：已解决
- 问题：使用 DeepSeek OpenAI 兼容接口真实验证 AI 导入时，普通 `/chat/completions` 连通成功，但 Vercel AI SDK `generateObject` 会发送 `response_format: json_schema`，DeepSeek 当前返回 `This response_format type is unavailable now`，导致项目封装层无法直接生成结构化对象。
- 处理：保留 Vercel AI SDK 和 OpenAI 兼容 provider，但把 `server/src/services/ai-client.ts` 改为 `generateText`，通过提示词要求只返回 JSON，再由项目侧解析 JSON 文本并交给 Zod schema 校验；同时支持纯 JSON、Markdown JSON 代码块和前后带说明的 JSON 文本。
- 经验：OpenAI 兼容不等于完全支持 OpenAI 的所有结构化输出参数。供应商中立的 AI 接入层应避免把业务逻辑绑定到某个 provider 的高级响应格式，真实模型接入必须做一次端到端烟测。

---

## 2026-05-26 AI 导入模型输出结构不稳定

- 状态：已解决
- 问题：真实模型可能把步骤内容包在 `source`、`draft`、`step` 等子对象里，或漏掉平台内部字段 `id`、`confidence`、`warnings`，导致 `steps[0].id/type/text` 等 Zod 校验错误直接展示到导入预览页，用户无法判断模型实际输入输出。
- 处理：`server/src/services/ai-case-draft.ts` 增加模型输出归一化，兼容常见包裹结构并为草稿字段补默认值；`server/src/services/ai-client.ts` 和导入 worker 保留模型原始输出、解析 JSON 和结构错误；预览详情页增加“AI 调试信息”折叠面板。
- 经验：对非强约束模型输出，schema 校验前需要一层业务归一化；校验失败不能只返回 Zod 文本，还要把 prompt、response、parsed 和 error 一起持久化，方便复现和调提示词。

---

## 2026-05-27 AI 导入目标页面不可访问

- 状态：已解决
- 问题：AI 导入采集页面上下文时，如果目标页面返回 404、500 等错误状态，原流程仍会继续读取错误页 DOM，并把空或错误页面上下文交给模型生成草稿。
- 处理：`server/src/services/page-context.ts` 在 `page.goto` 后检查 HTTP 响应状态，400 及以上直接抛出 `PageContextError`；导入 worker 捕获该错误后立即把当前导入项标记为生成失败，不再进入 AI 草稿生成，也不做自动重试。
- 经验：页面上下文是 AI 生成草稿的事实基础，采集阶段必须先确认目标页面真实可访问；错误页、登录拦截页、空 DOM 都不能当成业务页面上下文继续向下游传递。

---

## 2026-05-27 AI 导入记录与草稿引用生命周期

- 状态：已解决
- 问题：导入预览只保存 `savedCaseKey`，当已保存草稿被删除或移入回收站后，导入项仍显示“已保存”和“草稿”按钮，点击会进入空页面；同时导入记录缺少放弃入口，导错文件后只能长期保留历史任务。
- 处理：增加删除导入任务接口和前端“放弃导入”入口，删除导入记录不删除已保存草稿；导入项列表返回时根据 `savedCaseKey` 补充 `savedCaseState`，草稿不存在时禁用打开按钮并允许重新生成。
- 经验：导入任务是过程资产，草稿用例是业务资产，两者生命周期不能互相隐式删除；跨资源引用需要在响应层补充当前状态，避免旧引用驱动前端跳转到不存在的页面。

---

## 2026-05-27 AI 导入页面上下文为空

- 状态：已解决
- 问题：真实导入 `/dashboard` 时，AI 输入中的页面标题仍是 `Vite App`，按钮、输入框、链接、表格等元素全为空。现场诊断确认目标页面 HTTP 200 且登录态有效，但 `domcontentloaded` 阶段 `body.innerText` 长度为 0，等待 SPA 渲染稳定后标题变为“主页”且可以读取到“物流管控”等菜单文本；同时原采集规则没有把 Element Plus 菜单项作为导航上下文读取。
- 处理：`server/src/services/page-context.ts` 在 `domcontentloaded` 后增加 SPA 可见内容等待，再读取页面快照；页面上下文增加 `elements.navigation`，采集 `[role="menuitem"]`、`.el-menu-item`、`.el-sub-menu__title` 等导航菜单候选；修复读取快照时未 `await` 导致浏览器提前关闭的问题。
- 经验：Vite/Vue 单页应用的 `domcontentloaded` 只能说明 HTML 壳加载完成，不能代表业务 DOM 已可用；页面上下文采集要等待可见业务内容，并把导航菜单作为独立上下文提供给 AI。

---

## 2026-05-27 AI 导入模型遗漏 selector

- 状态：已解决
- 问题：页面上下文已经采集到“物流管控”的导航候选和 locator，但 DeepSeek 可能返回缺少 `selector` 的步骤，也可能把 `id` 输出为数字、把 `confidence` 输出为 `0.7/0.6/0` 这类数字，导致 Zod 校验失败并显示“AI 返回结构不符合平台草稿要求”。后续“基础管理”“车辆管理”属于点击父菜单后才出现的懒加载子菜单，第一阶段静态页面上下文不一定能确定。
- 处理：`server/src/services/ai-case-draft.ts` 收紧提示词，补充 JSON 输出模板，要求 `confidence` 只能是 `high/medium/low`；同时在模型归一化层兼容数字 `id` 和数字置信度，把 `0-1` 或 `0-100` 分数映射为三档枚举。模型缺少 selector 时不阻断草稿生成；有真实 locator 候选时平台侧保守补全，没有候选时允许模型基于自然语言推理低置信 selector，但必须写明 warning。
- 经验：模型看见上下文不代表一定会遵守结构字段；AI 草稿链路需要“提示词模板 + 宽容归一化 + 平台确定性补全 + 基础检查兜底”配合。第一阶段的草稿目标是可审核，不是证明 selector 已经可执行；低置信推理 selector 可以保留，但必须显式暴露风险。

---

## 2026-05-27 实测检查手写 CSS 定位器生成非法脚本

- 状态：已解决
- 问题：AI 草稿保存后，部分步骤同时带有 `selector` 和 `selectorDraft`。当 `selectorDraft.mode=advanced` 且 `advancedSelector` 是 `button:has-text('新增')` 这类裸 Playwright CSS 时，实测检查优先使用 `selectorDraft`，原渲染逻辑直接拼成 `page.button:has-text('新增')`，生成非法 TypeScript 脚本，接口返回 500。
- 处理：`shared/locator-builder.ts` 的 `renderLocatorExpression` 对高级模式做分支：如果手写内容是 `locator(...)`、`getByText(...)` 等 Playwright 定位方法，则渲染为 `page.xxx`；否则按 CSS 文本包成 `page.locator(...)`。补充实测检查脚本生成测试和定位器构建器测试。
- 经验：高级手写定位器不是都能当作 Playwright 方法链，裸 CSS 和 Playwright CSS 伪类必须进入 `locator()`。实测检查生成脚本前要保证 selector 表达式语法合法，否则会把本应是步骤失败的问题升级成接口 500。

---

## 2026-05-27 录制入口 goto 重复保存为测试步骤

- 状态：已解决
- 问题：Playwright codegen 录制脚本开头会自动生成 `page.goto(...)`，但平台用例已经通过 `startPath` 打开起始页面。停止录制后再把首个 `goto` 保存为步骤，会导致正式执行和实测检查重复刷新起始页面，增加等待时间，也可能影响页面初始化状态。
- 处理：`server/src/services/codegen-parser.ts` 在解析录制脚本时跳过主页面的首个 `goto` 步骤；中途真正需要跳转的 `goto` 仍然保留。同步调整 codegen 解析器测试，覆盖“入口 goto 过滤、中途 goto 保留”的行为。
- 经验：录制脚本是可执行代码，用例数据是平台结构化步骤，两者不能逐行等价保存。codegen 入口导航应作为 `startPath` 的来源或校验信息，而不是测试动作本身。

---
## 2026-05-29 PowerShell 不支持 Unix `head`

- 现象：在 Windows PowerShell 中执行 `rtk rg ... | head -80` 报 `head` 不是可识别命令。
- 原因：项目当前 shell 是 PowerShell，不能默认使用 Unix 工具链命令。
- 处理：后续截断输出使用 `Select-Object -First`，或让 `rtk` 自身压缩输出。
