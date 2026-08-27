# AI 导入：Playwright 页面档案能力调研

## 结论

Playwright 已提供页面探索所需的主要采集能力，但没有可直接使用的“长期页面档案”产品。OpenCode 可以直接把 Microsoft 官方 `@playwright/mcp` 配置为本地 MCP Server，无需本项目再实现一层 MCP 或把 MCP 转发到 Playwright CLI。推荐组合如下：

```text
OpenCode
  -> 官方 @playwright/mcp 独立进程
  -> browser_snapshot 获取当前页面状态
  -> browser_generate_locator 生成 Playwright locator
  -> 系统保存页面状态、进入条件和状态转换

失败或需要诊断时
  -> Trace

登录态
  -> storageState，独立于页面档案保存
```

页面快照适合作为 Agent 的实时观察输入和页面档案的原始证据，不能单独承担页面档案。快照中的元素 `ref` 服务当前页面状态，长期复用的应是经 `browser_generate_locator` 生成并重新验证过的 locator。

## 调研范围与本机环境

本调研仅使用 Playwright 官方文档、Microsoft 官方仓库与 npm 包、OpenCode 官方文档，以及本机 Playwright CLI 帮助和已安装包源码。

本机环境实测：

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| 项目 `@playwright/test` | `1.60.0` | 项目测试运行时 |
| 全局 `@playwright/cli` | `0.1.15` | `playwright-cli` 命令可用 |
| 全局 CLI 内置 Playwright | `1.62.0-alpha-2026-06-29` | 与项目版本不同，且为 alpha 版本 |

核对命令：

```powershell
npm ls @playwright/test playwright --depth=0
playwright-cli --version
npm list -g @playwright/cli --depth=0
playwright-cli --help
```

全局 CLI 不能直接作为生产依赖，也不再是首版主链路。实现时固定 `@playwright/mcp` 的确切版本，并验证其生成的 locator 能由项目使用的 Playwright Test 版本执行。升级 MCP 时重新跑兼容检查。

## 能力矩阵

| 能力 | 能采集和持久化什么 | 页面档案用途 | 主要局限 |
| --- | --- | --- | --- |
| `@playwright/mcp` | 独立 MCP browser automation server；提供 snapshot、页面操作、locator、截图、storage state、Console、网络与可选 Trace 等结构化工具 | 作为 OpenCode 的首版浏览器探索接口 | MCP 本身不定义页面档案；工具 schema 和快照会占用模型上下文；官方明确说明它不是安全边界 |
| `playwright-cli snapshot` | 当前页面的语义快照；包含元素 `ref`；支持指定局部元素、`--depth`、`--boxes` 和 `--filename`；CLI 操作后也会自动生成 `.playwright-cli/page-<time>.yml` | 作为页面状态的原始证据和 Agent 观察输入 | 只描述一个瞬时状态；`ref` 不应作为长期标识；不包含进入条件和状态转换 |
| `playwright-cli generate-locator` | 将当前快照的 `ref` 或唯一 selector 转为 Playwright locator | 直接复用，保存 locator 字符串并在刷新时重验 | 依赖当前活动页面找到目标元素；不会自动建立元素目录和状态关系 |
| `page.ariaSnapshot()` | YAML 形式的可访问性树，包含 role、accessible name、文本、层级和部分状态属性；`mode: "ai"` 会加入元素引用和 iframe 快照；支持 `depth`、`boxes` | 作为 CLI snapshot 的底层语义数据或不使用 CLI 时的直接采集 API | 不是完整 DOM；可访问性较差或没有语义的控件可能缺失；动态文本会造成噪声 |
| `codegen` / Test Generator | 记录点击、填写和导航，生成 Playwright 代码；支持 visibility、text、value 断言；自动优先选择 role、text、test id locator | 复用 locator 选择原则；保留为人工录制入口 | 依赖人工操作；产物是测试代码，不是页面知识模型；只覆盖实际经过的路径 |
| Locator Picker / `page.pickLocator()` | 人工 hover、高亮并点击一个元素，返回 locator | 人工修正或补采 locator | 必须人工选择当前元素；不适合后台 Agent 批量探索 |
| Trace | 每个 action 的 Before、Action、After DOM snapshot，以及 locator、截图、源码位置、日志、错误、Console 和网络信息；保存为 `trace.zip` | 失败探索的诊断附件和可追溯证据 | 体积和采集开销较大；格式服务 Trace Viewer，不是稳定的页面档案接口；可能包含敏感数据 |
| HAR | 请求与响应的 URL、method、headers、body、timing 等；支持 `.har` / `.zip`、URL 过滤、`minimal` 模式和内容 `omit` / `embed` / `attach` | 仅在需要理解接口依赖时作为网络附件 | 没有 DOM、元素语义或 locator；可能包含凭据和业务数据；Service Worker 和严格请求匹配会限制回放 |
| `storageState` | cookies、localStorage；可选 IndexedDB；保存为 JSON | 独立保存和加载探索登录态 | 不是页面档案；可能包含可冒用账号的凭据；会过期；核心 API 不持久化 sessionStorage |
| Playwright Test Agents | planner 探索页面并保存 Markdown plan；generator 实际操作页面后写测试；healer 运行并修改失败测试 | 复用 seed test、实时探索、操作日志等工作流思路 | 官方 generator 直接写任意测试代码，healer 会修改测试使其通过，不符合本项目“结构化 TestPlan 确定性生成代码、AI 不做裁判”的边界 |

官方资料：

- [Playwright CLI 官方仓库](https://github.com/microsoft/playwright-cli)
- [Test Generator / codegen](https://playwright.dev/docs/codegen)
- [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- [`page.ariaSnapshot()` API](https://playwright.dev/docs/api/class-page#page-aria-snapshot)
- [`page.pickLocator()` API](https://playwright.dev/docs/api/class-page#page-pick-locator)
- [Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Tracing API](https://playwright.dev/docs/api/class-tracing)
- [HAR 录制 API](https://playwright.dev/docs/api/class-browser#browser-new-context-option-record-har)
- [HAR 录制与回放](https://playwright.dev/docs/mock#mocking-with-har-files)
- [Authentication / storageState](https://playwright.dev/docs/auth)
- [`browserContext.storageState()` API](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
- [Playwright Test Agents](https://playwright.dev/docs/test-agents)
- [Microsoft Playwright MCP 官方仓库](https://github.com/microsoft/playwright-mcp)
- [OpenCode MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode Permissions](https://opencode.ai/docs/permissions/)
- [v1.60.0 planner 定义](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright/src/agents/playwright-test-planner.agent.md)
- [v1.60.0 generator 定义](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright/src/agents/playwright-test-generator.agent.md)
- [v1.60.0 healer 定义](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright/src/agents/playwright-test-healer.agent.md)

## Playwright MCP 与 CLI 的适用边界

官方说明中，CLI + SKILL 更适合需要同时处理代码库、测试和推理的 coding agent，因为命令调用更节省上下文；MCP 更适合持续浏览器状态、丰富页面结构检查和长时间自主探索。AI 导入的 OpenCode 不接触源码，主要任务正是持续探索页面，因此首版优先使用官方 MCP；CLI 保留为未来上下文成本过高时的替代方案。

官方 MCP 是独立的 browser automation server：`@playwright/mcp` 自带 Playwright 依赖并以 MCP stdio 或 HTTP transport 对外提供工具，不依赖 `@playwright/cli`，也不需要 Shell 才能执行浏览器操作。OpenCode 官方支持 `type: "local"` 和 `command` 数组启动本地 MCP，MCP 工具会直接注册给模型。

可直接复用的 MCP 能力：

- 导航与上下文：navigate、back、tabs、close、resize、wait。
- 页面操作：click、type、批量 fill、select、hover、drag/drop、键盘、对话框和文件上传。
- 页面观察：accessibility snapshot、find、screenshot、Console、网络请求和页面内 evaluate。
- 测试信息：`browser_generate_locator`，以及可见性、文本、列表和值的验证工具。
- 会话信息：cookies、localStorage、sessionStorage、storage state；启动时也可通过 `--storage-state` 复用项目登录态。
- 诊断附件：Trace；video、network、vision、PDF 和 DevTools 中部分能力需要显式 capability 或额外配置。

需要系统自建：

- 哪些快照属于同一个页面，哪些属于不同页面状态。
- 如何进入某个页面状态。
- 操作会把页面从哪个状态带到哪个状态。
- 元素的业务含义和稳定业务标识。
- 页面档案的刷新、失效、失败和版本状态。
- 原始快照、locator 和 TestPlan 之间的引用关系。

不建议把 MCP session 输出目录直接当作页面档案。生产调用应显式指定任务内 `--output-dir`，任务成功后只保留被档案引用的 snapshot、截图和诊断附件，其他临时文件随任务清理。

## OpenCode 直接启动官方 MCP

开发阶段可按官方示例使用 `npx`，但正式版本不能使用 `@latest`，否则安装结果不可复现：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "@playwright/mcp@<PINNED_VERSION>",
        "--headless",
        "--isolated",
        "--storage-state=<PROJECT_STORAGE_STATE>",
        "--output-dir=<TASK_ARTIFACTS>",
        "--allowed-origins=<PROJECT_ORIGINS>"
      ],
      "cwd": "<TASK_DIR>",
      "enabled": true,
      "timeout": 15000
    }
  },
  "permission": {
    "bash": "deny",
    "edit": "allow",
    "external_directory": "deny"
  }
}
```

Windows 打包版本推荐将 Node.js、OpenCode 和确切版本的 `@playwright/mcp` 一起打包，并用绝对路径启动，避免依赖全局 `npx`、全局缓存或运行时下载：

```jsonc
"command": [
  "<APP_RESOURCES>\\node\\node.exe",
  "<APP_RESOURCES>\\node_modules\\@playwright\\mcp\\cli.js",
  "--headless",
  "--isolated",
  "--storage-state=<PROJECT_STORAGE_STATE>",
  "--output-dir=<TASK_ARTIFACTS>"
]
```

版本由应用的精确 dependency 和 lockfile 固定；不要使用 semver 范围或 `@latest`。每次任务把 `cwd` 设为 `%LOCALAPPDATA%\\playwright-auto\\ai-import\\tasks\\<taskId>`，宿主提前创建 `input/`、`work/`、`output/` 和 `artifacts/`。

禁止 `bash` 不影响核心任务：页面探索全部通过 `playwright_*` MCP 工具完成，文件读取和候选 TestPlan 写入通过 OpenCode 内置 `read`、`edit`、`write`、`patch` 完成；OpenCode 的 `edit` permission 同时覆盖这些文件修改工具。由于工作目录就是单个任务目录，`external_directory: deny` 可阻止内置文件工具访问源码和正式数据。代价是 Agent 不能自行运行测试、解析 Excel 或调用任意脚本，这些本来就应由宿主系统确定性完成。

## 安全边界

Playwright 官方明确说明 MCP 不是安全边界，因此应同时使用进程工作目录、OpenCode permission 和 MCP 参数收窄能力：

- 使用本地 stdio MCP，不开放 `--port`。`--allowed-hosts` 主要用于 HTTP Server 的 DNS rebinding 防护，不是目标网站白名单。
- 根据项目环境设置 `--allowed-origins`，并包含业务页面实际需要的 API、静态资源和 SSO origin。官方特别说明 origin allowlist 不构成安全边界且不影响重定向，不能代替网络隔离；`--blocked-origins` 先于 allowlist 判断。
- 不传 `--allow-unrestricted-file-access`。MCP 默认只允许 workspace roots（没有 roots 时为 `cwd`）内的文件，且阻止 `file://` 导航。文件上传虽然接受绝对路径，也只能使用任务目录内由宿主准备的 fixture。
- 固定 `--output-dir=<TASK_ARTIFACTS>`。snapshot、截图、Trace 和其他输出只写任务目录；浏览器触发下载后，由宿主从该目录筛选、登记和清理，Agent 不获得任意外部路径。
- 后台任务使用 `--headless --isolated --storage-state=<PROJECT_STORAGE_STATE>`，不要同时传 `--user-data-dir`：当前 Playwright MCP 在 isolated 模式下会因此立即退出，OpenCode 会话里就没有浏览器工具。项目已保存的登录态由宿主按精确路径传给 MCP，不复制进页面档案；任务结束后隔离上下文丢弃。默认持久化 profile 会跨 session 保留浏览器数据且同一 profile 不能并发使用，不适合作为首版任务默认值。
- 不使用 `--extension`。Extension 会连接用户正在运行的 Edge/Chrome 和现有登录态，适合人工协助，不适合后台隔离任务。
- 禁用 `playwright_browser_run_code_unsafe`；官方将其标注为等同 RCE。默认也应禁用 storage/cookie 读写和完整网络请求正文工具，只有诊断任务按需开放，避免 Agent 把 Cookie、Token 或响应正文写入候选档案。
- `browser_evaluate` 只在结构化工具无法完成页面内观察时使用；它运行于页面上下文，不等同于宿主 Shell，但仍可能读取页面敏感数据。

## 宿主系统仍需完成的能力

官方 MCP 解决的是“操作和观察真实浏览器”，不会替代本项目的业务编排。宿主仍需负责：

1. 解析并校验 Excel 模板，将同一页面的多个用例归并为一次增量探索任务。
2. 创建任务目录、生成 OpenCode/MCP 运行时配置、注入项目 URL 和 storageState 路径，并管理超时、取消、日志和进程退出。
3. 定义页面、路由模式、页面状态、进入条件和状态转换；把 snapshot、locator 和截图整理成版本化页面档案。
4. 校验 Agent 写入的候选页面档案和 TestPlan JSON，原子提升到正式数据目录；Agent 不直接写正式数据。
5. 管理整页刷新、失败保留旧版本、任务恢复、7 天清理和敏感信息过滤。
6. 将 TestPlan 确定性编译为 Playwright 测试代码，执行 TypeScript/Playwright 检查，并保留人工审阅入口。

## 页面状态与跨弹窗断言

页面档案以“页面状态”为最小单位，不会妨碍跨弹窗流程。操作步骤连接状态，断言使用操作后的目标状态。

```text
列表页.default
  --点击新增-->
列表页.createDialog
  --填写并保存-->
列表页.successToast
  --提示消失-->
列表页.default
```

“弹窗保存后关闭，在主页面断言成功提示”应编译为线性测试步骤：

1. 在 `createDialog` 状态完成填写和保存。
2. 等待弹窗关闭或成功提示出现。
3. 使用 `successToast` 状态中的 locator 断言主页面提示。

成功提示属于短暂状态。档案应记录触发它的操作和出现条件，刷新时必须从前置状态重新执行保存操作；不能只打开列表页后等待提示。

## 最小页面档案模型

首版只保存生成测试所需的数据，不保存完整 DOM，也不解析 Trace 内部格式。

```text
PageArchive
  pageId            页面业务标识
  states[]          页面状态

PageState
  stateId           页面内稳定状态标识
  url               采集 URL 或 URL pattern
  title             页面标题
  entrySteps[]      从已知状态进入本状态的操作
  snapshotPath      原始 snapshot 证据
  snapshotHash      判断证据是否变化
  elements[]        生成测试会用到的元素
  transitions[]     操作后的目标状态
  capturedAt        采集时间
  envKey            采集环境
  status            ready / stale / failed

PageElement
  key               页面状态内的业务标识
  meaning           元素语义
  locator           generate-locator 生成并验证的 locator
  evidence          role、accessible name、text 或 test id
```

`entrySteps` 和 `transitions` 只需要覆盖已导入用例涉及的路径。不要首版建立完整站点图，也不要为快照中每个节点创建 `PageElement`；只有测试步骤和断言实际引用的元素才进入结构化档案。

## 刷新与失败处理

用户可以刷新单个页面状态，也可以刷新页面下的全部已知状态：

1. 加载独立保存的 storageState。
2. 执行该状态的 `entrySteps`。
3. 生成指定文件名的 snapshot。
4. 对档案中被使用的元素重新执行 `browser_generate_locator` 和唯一性检查。
5. 成功后原子替换状态档案；失败时保留上一份可用档案并将状态标记为 `failed` 或 `stale`。

页面探索失败时再保存 Trace。正常刷新不默认录制 Trace 或 HAR，避免持续产生大文件和敏感信息。HAR 仅在用例明确依赖接口响应、页面探索需要排查网络问题时按 URL 过滤采集，默认不保存内容正文。

## 对官方 Agent 工作流的取舍

Playwright `1.60.0` 已内置 planner、generator 和 healer：

- planner 使用 seed test 建立页面环境，探索页面后保存 Markdown test plan。
- generator 按 plan 在真实页面逐步操作，读取操作日志并写入 Playwright 测试文件。
- healer 运行失败测试，查看快照和错误后直接修改测试代码，直到通过或将测试标记为跳过。

本项目可以复用 seed test、真实页面探索和操作日志的设计，但不直接采用 generator/healer 作为核心执行链路：

```text
官方参考：Markdown plan -> Agent 写测试代码 -> Agent 修复测试

本项目：Excel 用例 -> Agent 生成结构化 TestPlan
                    -> 系统校验和人工审阅
                    -> 确定性编译器生成测试代码
                    -> Playwright 执行测试
```

Agent 可以使用页面当前行为确认 locator 和操作是否可执行，但不能根据当前行为发明、删除或修改用户提供的预期结果。自然语言用例中的成功断言可以直接进入 TestPlan；探索只负责找到断言对象及稳定 locator。

## 推荐决策

1. 使用 OpenCode 作为任务编排器，直接配置固定版本的 Microsoft 官方 `@playwright/mcp` 执行页面探索；不自建 MCP，不依赖 Playwright CLI 或通用 Shell。
2. 使用 `browser_snapshot` 作为页面档案的原始语义证据，使用 `browser_generate_locator` 生成长期保存的 locator。
3. 自建最小页面状态和状态转换模型，不自建浏览器控制协议，不保存完整 DOM。
4. storageState 继续作为项目环境的独立登录态，不复制进页面档案。
5. Trace 仅在探索失败或用户要求诊断时保留；HAR 首版不作为默认页面档案内容。
6. Playwright CLI、`codegen` 和 Locator Picker 保留给录制、人工修正或未来的上下文优化，不作为首版后台 AI 探索主流程。
7. 借鉴 Playwright Test Agents 的 seed test 和真实页面验证，不采用其直接写代码和自动修改断言的工作流。
