# OpenCode 嵌入、模型协议与 Playwright MCP 调研

## 结论

首版采用以下拓扑：

```text
桌面应用主进程
  -> 启动应用内固定版本的 OpenCode 可执行文件
  -> OpenCode serve（仅监听 127.0.0.1，随机端口）
  -> @opencode-ai/sdk client
  -> 单个 AI 导入任务目录
  -> OpenCode 启动本地 @playwright/mcp 子进程
  -> 独立无头浏览器上下文，载入项目 storageState
```

不要依赖全局 `opencode`、用户的 `~/.config/opencode`、`npx @playwright/mcp@latest` 或 OpenCode 自动升级。应用应固定并打包 `opencode-ai`、`@opencode-ai/sdk`、`@playwright/mcp` 及浏览器版本，直接使用绝对路径启动。

首版不采用两种看似更短的集成方式：

- 不以 `opencode run --format json` 作为业务接口。它输出的是原始 JSON 事件流，不是最终业务 JSON；进程和事件流仍需额外监督。桌面应用需要任务状态、取消、恢复、结构化输出和 MCP 状态，使用长期 `serve` + SDK 更直接。
- 不采用 V2 进程内 SDK。OpenCode 官方将其标为 beta，并建议非 Effect 应用暂时运行 server、使用 TypeScript client；首版不应建立在未稳定的进程内 API 上。[OpenCode V2 SDK](https://opencode.ai/v2/docs/build/sdk)

这套方案满足“OpenCode 可自行读写任务目录，但不能修改项目源码；没有通用 Shell；浏览器操作只通过官方 Playwright MCP”的产品边界。不过，OpenCode 权限不是操作系统沙箱，Playwright MCP 官方也明确表示它不是安全边界。因此，首版必须把 OpenCode 的工作目录设为专用任务目录，并在应用层校验所有正式产物；不能把配置文件里的 `deny` 当成进程级隔离。

## 1. OpenCode 的进程边界

OpenCode 官方提供三种适合程序化调用的入口：

- `opencode run`：单次非交互运行，`--format json` 输出原始 JSON events；支持 `--dir`、`--agent`、`--model` 和 `--attach`。[CLI: run](https://opencode.ai/docs/cli/#run)
- `opencode serve`：无头 HTTP server，默认只监听 `127.0.0.1`，公开 OpenAPI 3.1、健康检查、会话、事件、MCP 状态和中止接口。[Server](https://opencode.ai/docs/server/)
- `@opencode-ai/sdk`：官方 type-safe client；也有会自行启动 server 的 `createOpencode()`。[SDK](https://opencode.ai/docs/sdk/)

推荐由应用主进程自己启动打包后的 OpenCode 可执行文件，再用 `createOpencodeClient()` 连接。不要调用 `createOpencode()`，因为它隐藏了可执行文件定位和子进程所有权，不利于保证使用应用内版本；Windows 上也曾出现 SDK 从 `PATH` 启动 npm shim 失败的问题。[OpenCode Windows SDK spawn issue](https://github.com/anomalyco/opencode/issues/8160)

### 生命周期

1. 应用启动 AI 导入能力时，选择随机空闲端口并生成仅本进程知道的 `OPENCODE_SERVER_PASSWORD`。
2. 用绝对路径启动 `opencode serve --hostname 127.0.0.1 --port <port>`。
3. 轮询 `/global/health`，并核对返回版本等于应用固定版本。
4. 创建单个 SDK client；首版所有导入任务串行进入同一个 OpenCode 进程。
5. 每个任务创建独立 session，SDK 请求携带任务目录作为 workspace/directory 上下文。
6. 任务取消时先调用 `session.abort()`；超时或 OpenCode 无响应时终止整个进程树，并把任务标记为可恢复。
7. 应用退出时停止接收任务，等待当前任务有限时间，然后关闭 OpenCode 及其 MCP/browser 子进程；下次启动后根据任务阶段文件恢复，而不是依赖旧 session 继续存在。

OpenCode server 提供健康检查、全局事件、`session.abort()`、MCP 状态和 `/instance/dispose`，可以支撑上述监督。[Server APIs](https://opencode.ai/docs/server/#apis) SDK 也明确暴露 `server.close()` 和 AbortSignal。[SDK lifecycle](https://opencode.ai/docs/sdk/#create-client)

必须增加应用侧 watchdog。OpenCode 官方仓库存在非交互调用在 provider 不可达时长期重试、无最终输出的报告，不能只等待子进程自行退出。[OpenCode connection retry issue](https://github.com/anomalyco/opencode/issues/40330)

## 2. 打包与本地隔离

### 非全局分发

`opencode-ai` 是 MIT 许可的 npm 包，并按平台提供原生可执行文件；`@playwright/mcp` 是 Apache-2.0 许可的 npm 包。应用构建时应固定确切版本并将所需平台二进制/JS、Node.js runtime 和 Playwright browser 作为应用资源打包，不在用户机器上执行全局安装或 `npx ...@latest`。[OpenCode repository](https://github.com/anomalyco/opencode) [Playwright MCP repository](https://github.com/microsoft/playwright-mcp)

Windows 首版建议：

- OpenCode：直接执行打包资源中的 `opencode.exe`，不经过 `opencode.ps1`、`opencode.cmd` 或 `PATH`。
- Playwright MCP：OpenCode 的 MCP `command` 使用打包 Node.js 的绝对路径，参数第一个是打包 `@playwright/mcp/cli.js` 的绝对路径。这样绕过 Windows 的 `npx.cmd` stdio 问题，也避免联网下载。[Playwright MCP Windows stdio issue](https://github.com/microsoft/playwright-mcp/issues/1540)
- 浏览器：构建时安装固定 Playwright browser；运行时通过 `PLAYWRIGHT_BROWSERS_PATH` 或 MCP `--executable-path` 指向应用资源。

### 配置和状态隔离

OpenCode 配置会合并 remote、全局、`OPENCODE_CONFIG`、项目配置、`.opencode` 和 inline config，单独设置 `OPENCODE_CONFIG` 并不会屏蔽用户全局配置。[Config precedence](https://opencode.ai/docs/config/#precedence-order)

因此子进程至少设置：

```text
XDG_CONFIG_HOME=<appData>/opencode/config
XDG_DATA_HOME=<appData>/opencode/data
XDG_CACHE_HOME=<appData>/opencode/cache
XDG_STATE_HOME=<appData>/opencode/state
OPENCODE_CONFIG=<appData>/opencode/config/opencode.json
OPENCODE_CONFIG_DIR=<appResources>/opencode-profile
OPENCODE_DISABLE_AUTOUPDATE=true
OPENCODE_DISABLE_DEFAULT_PLUGINS=true
OPENCODE_DISABLE_LSP_DOWNLOAD=true
OPENCODE_DISABLE_CLAUDE_CODE=true
OPENCODE_DISABLE_MODELS_FETCH=true
```

OpenCode 官方 CLI 列出了这些配置入口和禁用开关；官方 E2E workflow 也使用独立的 XDG config/data/cache/state 目录运行 server。[CLI environment variables](https://opencode.ai/docs/cli/#environment-variables) [OpenCode E2E workflow](https://github.com/anomalyco/opencode/blob/dev/.github/workflows/opencode.yml)

不要把 API key 写入任务目录、Prompt 或日志。OpenCode `/connect` 默认把凭据存入 `~/.local/share/opencode/auth.json`；在上述独立 `XDG_DATA_HOME` 下，它会留在应用私有数据目录。也可以在配置中使用 `{env:NAME}`，由主进程只给 OpenCode 子进程注入 API key。[Provider credentials](https://opencode.ai/docs/providers/#credentials)

首版只有一个 Agent 串行运行，因此一个独立 OpenCode data profile 足够。若未来并行，不能共享同一个 SQLite profile；官方仓库已有并发 `opencode run` 使用同一 data dir 死锁的报告。[OpenCode concurrent profile issue](https://github.com/anomalyco/opencode/issues/29395)

## 3. 文件和工具权限

OpenCode 在任务目录中需要：

- 读：`source.json`、相关页面档案副本/引用、项目测试规则。
- 写：`intent.json`、`explore-plan.json`、`actions.json` 和诊断日志。
- 禁止：通用 Shell、subagent、网络搜索、加载外部 skill、项目源码目录和其他任务目录。
- 允许：官方 Playwright MCP 的浏览器工具。

稳定版 OpenCode 权限可对 `edit`、`bash`、`task`、`external_directory` 等设置 `allow/ask/deny`；默认配置实际上较宽松，所以必须显式封闭。[Permissions](https://opencode.ai/docs/permissions/)

建议固定版本后按该版本 schema 生成专用 Agent，而不是复用内置 build Agent。概念配置如下；最终字段必须以被固定版本的 `https://opencode.ai/config.json` 校验：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "permission": {
    "*": "deny",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": "allow",
    "bash": "deny",
    "task": "deny",
    "webfetch": "deny",
    "websearch": "deny",
    "skill": "deny",
    "external_directory": "deny",
    "playwright_*": "allow"
  }
}
```

`edit: allow` 只允许写当前 workspace 是设计成立的关键：OpenCode 必须从单个任务目录启动，页面档案和项目规则以只读副本或任务内输入提供。不要把项目根目录作为 workspace 后再试图用一长串路径规则阻止修改源码。

还需要两层应用侧保护：

1. Agent 完成后，只从任务目录读取白名单文件名；解析 JSON、执行 schema 校验，拒绝 symlink、路径穿越和超出大小限制的产物。
2. 任务期间监视项目工作目录不得产生变更；这属于验收防线，不代替操作系统沙箱。

原因是 OpenCode 官方说明权限用于审批/阻止工具，不是进程沙箱；`bash` 拥有宿主用户的文件、进程和网络权限，所以这里必须完全禁用，而不是命令黑名单。[OpenCode V2 permission security note](https://opencode.ai/v2/docs/permissions)

## 4. Playwright MCP 配置

OpenCode 官方支持在 `opencode.json` 中配置 local MCP command，并通过 stdio 启动它；Microsoft 官方 README 也直接给出了 OpenCode 配置示例。[OpenCode MCP](https://opencode.ai/docs/mcp-servers/) [Playwright MCP for OpenCode](https://github.com/microsoft/playwright-mcp#opencode)

首版运行配置应由应用生成，示意如下：

```jsonc
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": [
        "<absolute-app-node>",
        "<absolute-playwright-mcp-cli.js>",
        "--headless",
        "--isolated",
        "--storage-state=<absolute-project-storage-state.json>",
        "--output-dir=<absolute-task-evidence-dir>",
        "--output-mode=file",
        "--codegen=none",
        "--image-responses=omit"
      ],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

设计理由：

- `--isolated` 为每次探索创建临时 profile，结束后不保留浏览器侧状态；`--storage-state` 复用项目已保存的登录态。[Playwright MCP user profile](https://github.com/microsoft/playwright-mcp#user-profile)
- 输出目录限制在任务证据目录；不要启用 `--allow-unrestricted-file-access`。MCP 默认只允许 workspace root/cwd 下的文件访问，但官方明确说 MCP 本身不是安全边界。[Playwright MCP configuration](https://github.com/microsoft/playwright-mcp#configuration)
- 只启用 core automation；不要启用 `vision`、`pdf`、`devtools`、`network`、`storage` 等额外 capability。首版不需要任意坐标操作、网络 mock 或修改 storageState。
- `--codegen=none` 避免 MCP 自己生成最终测试代码；本系统只保存页面证据和成功操作，最终代码仍由 Action IR 确定性生成。
- `--image-responses=omit` 降低上下文开销；需要截图证据时可显式保存到 output dir，不应把所有截图直接送入模型。

Microsoft 对比说明认为 MCP 更适合持续浏览器状态、丰富页面内省和长时自主探索，这与页面档案探索匹配；CLI + skills 更省 token，但本系统已经禁用通用 Shell，因此首版选择 MCP 是一致的。[Playwright MCP vs CLI](https://github.com/microsoft/playwright-mcp#playwright-mcp-vs-playwright-cli)

### 需要接受的浏览器副作用

探索 Agent 被允许在测试环境中新增、编辑和触发业务操作，因此隔离浏览器 profile 不等于隔离服务端业务数据。页面档案只能合并验证成功的操作证据；导入 UI 必须明确提示探索可能修改测试环境。`allowed-origins` 只能减少误访问，Microsoft 明确声明它不是安全边界且不影响 redirect。[Playwright MCP security](https://github.com/microsoft/playwright-mcp#security)

## 5. Responses 与 Chat Completions

OpenCode 官方已经定义了映射：

- `/v1/chat/completions`：provider 使用 `@ai-sdk/openai-compatible`。
- `/v1/responses`：provider 使用 `@ai-sdk/openai`。

官方还允许同一 provider 下按 model 覆盖 `provider.npm`，因此应用无需开发模型路由 SDK，只需生成标准 `opencode.json`。[OpenCode custom providers](https://opencode.ai/docs/providers/#custom-provider)

### Chat Completions 示例

```jsonc
{
  "model": "company-chat/model-a",
  "provider": {
    "company-chat": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Company Chat Completions",
      "options": {
        "baseURL": "https://llm.company.example/v1",
        "apiKey": "{env:AI_IMPORT_API_KEY}"
      },
      "models": {
        "model-a": {
          "name": "Model A",
          "limit": { "context": 128000, "output": 16384 }
        }
      }
    }
  }
}
```

Vercel AI SDK 的 OpenAI Compatible provider 明确使用 `/chat/completions`，并支持 streaming、tool calling 和可选 structured outputs；实际公司模型是否完整支持工具调用必须单独探测。[AI SDK OpenAI Compatible](https://ai-sdk.dev/providers/openai-compatible-providers)

### Responses 示例

```jsonc
{
  "model": "company-responses/model-b",
  "provider": {
    "company-responses": {
      "npm": "@ai-sdk/openai",
      "name": "Company Responses",
      "options": {
        "baseURL": "https://responses.company.example/v1",
        "apiKey": "{env:AI_IMPORT_API_KEY}"
      },
      "models": {
        "model-b": {
          "name": "Model B",
          "limit": { "context": 200000, "output": 32768 }
        }
      }
    }
  }
}
```

AI SDK 的 OpenAI provider 默认使用 Responses API，并另外提供 `.chat()`；OpenCode 的配置映射已替应用选择正确入口。[AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)

同一个 `baseURL + model name` 不能靠运行时猜测协议。设置中必须让用户明确选择 `chat-completions` 或 `responses`，应用据此生成不同 provider ID/npm。保存前执行能力探测：模型连通、streaming、tool calling、结构化输出和足够上下文；任一关键能力不满足，不能启用 AI 导入。

## 6. 结构化输出与任务文件

`opencode run --format json` 的 `json` 表示事件流：`step_start`、text/tool events、`step_finish` 等，不代表模型最终结果已经符合 `TestIntent` 或 Action IR schema。[CLI JSON format](https://opencode.ai/docs/cli/#run)

SDK session prompt 支持 `json_schema` structured output，并能设置 schema 和 validation retry；这比从自由文本或 CLI event stream 截取 JSON 更适合 `intent.json`、`explore-plan.json` 和 `actions.json`。[SDK structured output](https://opencode.ai/docs/sdk/#structured-output)

推荐做法：

1. 通过 SDK 发起阶段 Prompt，并传入该阶段 JSON Schema。
2. Agent可以使用 `edit` 把中间日志/证据写入任务目录，但业务阶段结果以 SDK structured output 为准。
3. 应用收到结果后再次用本地 schema 校验，再原子写入阶段文件。
4. 所有阶段文件带 schema version、任务 ID 和 source hash；恢复时只信任已校验且 hash 连续的阶段。

这避免同时存在“Agent 手写 JSON”和“SDK 返回 JSON”两个权威来源。页面档案成功操作仍由应用在探索完成后校验、合并，不能让 Agent直接覆盖正式档案。

## 7. 首版风险与验收门槛

### 高风险

1. **OpenCode 版本漂移。** 当前官方站点同时发布稳定 V1 与预览 V2 文档，配置字段也不同。必须固定一个确切版本，保存对应 config schema，禁止自动更新；升级必须运行完整契约测试。
2. **权限不是沙箱。** 禁用 Shell、限制 workspace 是必要但不充分的安全措施。首版如果必须达到对恶意模型输出的强隔离，需增加 Windows Job/AppContainer、低权限专用用户或容器；这不应伪装成 OpenCode 配置即可解决。
3. **Windows 子进程与 stdio。** OpenCode SDK 及 `npx.cmd` 都出现过 Windows spawn/stdio 问题。必须验证打包后的绝对 `exe` 和 `node cli.js` 路径，而不是只在开发环境验证。
4. **本地模型兼容性。** “OpenAI-compatible”不等于完全支持 agent tool loop。必须针对每个配置执行真实 MCP tool call，而不只是普通聊天。
5. **登录态与业务副作用。** `storageState` 可能过期，探索会修改测试环境；需保留“登录已失效”状态，并禁止自动把当前页面结果改成预期断言。

### 发布前自动契约测试

- 安装包在无全局 OpenCode、无全局 Node/npm 的 Windows 机器启动成功。
- 应用内 OpenCode 版本、SDK 版本、Playwright MCP 版本和 browser revision 可查询且与 manifest 一致。
- 用户全局 OpenCode config、plugin、Claude config 和 auth 不会进入应用 Agent。
- Agent能读取并写入单一任务目录；尝试读取/写入项目源码、其他任务目录和用户目录均失败。
- Agent无法调用 Shell、subagent、webfetch/websearch；能调用 Playwright MCP core tools。
- Chat Completions 和 Responses 各用至少一个真实 endpoint 完成“打开页面 -> 操作 -> 生成符合 schema 的 Action IR”。
- `storageState` 可复用；过期时任务进入“登录已失效”，不会无限重试。
- API 连接拒绝、模型超时、MCP 启动失败、浏览器崩溃和 Agent卡死都能在应用 watchdog 时限内收敛到可恢复状态。
- 用户取消与应用退出会终止 OpenCode、MCP 和 browser 整个进程树，不留下监听端口或 profile lock。
- Agent输出路径穿越、symlink、超大文件和非法 JSON 均被拒绝；正式项目文件不会由 Agent直接修改。

### 需要原型验证后才能锁定的参数

- 固定 OpenCode 版本及其准确 `opencode.json` schema。
- OpenCode 进程复用粒度：应用生命周期一个 server，还是每次导入一个 server。首版单 Agent下优先复用一个 server，若 MCP/profile 清理不可靠则退回每任务一进程。
- SDK session 请求中绑定任务 directory 的准确调用形式。
- OpenCode 对 MCP individual tool permission 的固定版本行为。
- 打包 Node.js、`@playwright/mcp/cli.js` 与 Playwright browser 在 Windows 安装目录中的实际路径。
- 两类公司模型 endpoint 的 streaming/tool calling/structured output 能力。

这些项目不改变总体架构，但属于实现前必须通过的小型集成原型，而不是凭文档即可确认的事实。
