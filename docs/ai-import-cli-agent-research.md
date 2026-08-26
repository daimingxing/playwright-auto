# AI 导入 CLI Agent 集成调研

> 调研快照：2026-08-19。OpenCode 源码按 `v1.18.18` 核验；仅使用官方文档、官方 GitHub 仓库、官方 npm 包信息，以及本文已引用的 Codex 官方源码。

## 结论

首版选择 **OpenCode**，不再为 Codex CLI 增加 Chat Completions 到 Responses 的协议转换层。

原因很直接：OpenCode 的自定义 Provider 已明确支持两条路径：

- `/v1/chat/completions` 使用 `@ai-sdk/openai-compatible`；
- `/v1/responses` 使用 `@ai-sdk/openai`。

这正好覆盖公司本地模型可能只提供 Chat Completions 的情况。[OpenCode Provider 文档](https://opencode.ai/docs/providers/#custom-provider)

如果仍调用 Codex CLI，外部路由层就必须向 Codex 呈现它当前接受的 Responses 协议；这相当于自行维护协议桥接，并不会因为使用 OpenAI Agents SDK 而消失。首版直接使用 OpenCode 更短，也避免系统同时维护 Agent 和协议代理。[Codex `WireApi` 源码](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)

首版只集成一个锁定版本的 OpenCode，不设计多 Agent 接口、Provider 工厂或运行时 Agent 切换层。

## 已确认能力

| 能力 | 官方能力 | 本项目结论 |
| --- | --- | --- |
| 无头运行 | `opencode run` 用于脚本和自动化 | 直接作为后台子进程运行 |
| 机器输出 | `--format json` 输出 raw JSON events；源码逐事件写入一行 JSON | 按 JSONL 解析，不解析格式化文本 |
| 会话恢复 | `--session <ID>`、`--continue` | 只使用显式 `--session`，避免串到其他任务 |
| 工作目录 | `--dir <path>` | 指向仓库外的独立任务目录 |
| Chat Completions | `@ai-sdk/openai-compatible` | 支持公司 OpenAI-compatible 服务 |
| Responses | `@ai-sdk/openai` | 同一集成可切换到 Responses-compatible 服务 |
| Windows | 可原生运行，官方仍推荐 WSL | 打包产品采用原生 Windows，锁版本后做 POC |
| 权限 | `allow`、`ask`、`deny`，MCP 工具可按服务名前缀启停 | 禁用 bash，只开放读取任务输入和页面 MCP 工具 |
| 最终结果 Schema | `run` 当前没有 `--output-schema` | 宿主提取最终文本并执行本地 Schema 校验 |

来源：[CLI 文档](https://opencode.ai/docs/cli/#run)、[`run.ts` 源码](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/cli/cmd/run.ts)、[权限文档](https://opencode.ai/docs/permissions/)、[Windows 文档](https://opencode.ai/docs/windows-wsl/)。

## 后台调用契约

首版只封装一个固定调用：

```text
<bundled-opencode> --pure run
  --format json
  --dir <task-dir>
  --model <provider>/<model>
  --title ai-import:<task-id>
```

提示词通过 stdin 传入，进程通过参数数组启动，不拼接 shell 字符串。`--pure` 禁止加载外部插件；该全局参数由 OpenCode CLI 源码定义。[CLI 入口源码](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/index.ts)

`--format json` 实际输出的是逐行事件，而不是单个 JSON 文档。每行包含 `type`、`timestamp`、`sessionID` 和事件数据；当前源码会输出 `tool_use`、`step_start`、`step_finish`、`text`、`reasoning` 与 `error` 等事件。[`run.ts` 事件输出](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/cli/cmd/run.ts)

宿主负责：

1. 持续解析 JSONL，并在首个合法事件出现时保存 `sessionID`。
2. 把页面探索进度和已完成用例独立落盘，不把恢复能力只押在 Agent 会话上。
3. 从最终完成的 assistant `text` 事件提取候选 JSON。
4. 使用本地 Schema 校验候选结果；失败时允许在同一 `sessionID` 中修正一次。
5. 仅当进程 exit code 为 `0`、JSONL 完整且候选结果通过 Schema 校验时接受结果。

当前 `run` 没有等价于 Codex `--output-schema` 的参数，因此不能把“模型按提示返回 JSON”当成可靠边界。最终正式数据必须由宿主校验并写入。[CLI 参数源码](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/cli/cmd/run.ts)

## Provider 配置

Chat Completions-only 服务使用：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["corp"],
  "provider": {
    "corp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Company Model",
      "options": {
        "baseURL": "{env:AI_BASE_URL}",
        "apiKey": "{env:AI_API_KEY}"
      },
      "models": {
        "test-agent": {
          "name": "Test Agent Model"
        }
      }
    }
  }
}
```

Responses-compatible 服务只需把 `npm` 改为 `@ai-sdk/openai`。首版每个部署只配置一个 Provider 和一个模型；协议选择属于项目配置，不需要额外路由服务。[自定义 Provider 文档](https://opencode.ai/docs/providers/#custom-provider)

凭据只通过子进程环境变量传递，不写入提示词、Excel、页面档案、任务日志或 `opencode.json`。OpenCode 也支持自己的凭据文件，但打包应用不依赖用户的全局认证状态。[Provider 文档](https://opencode.ai/docs/providers/)

## 权限与隔离

### 权限配置

建议通过 `OPENCODE_CONFIG_CONTENT` 注入本次任务的完整运行配置，并在仓库外启动。首版不开放 shell；锁定版本的 `@playwright/cli` 由应用自带的本地 MCP 服务封装。任务级配置至少包含：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "snapshot": false,
  "mcp": {
    "ai_page": {
      "type": "local",
      "command": ["<app-resource>/ai-page-mcp.exe"],
      "cwd": "<task-dir>",
      "enabled": true,
      "environment": {
        "AI_TASK_ID": "<task-id>"
      }
    }
  },
  "permission": {
    "*": "deny",
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny"
    },
    "glob": "allow",
    "grep": "allow",
    "edit": "deny",
    "bash": "deny",
    "external_directory": "deny",
    "ai_page_open": "allow",
    "ai_page_act": "allow",
    "ai_page_snapshot": "allow",
    "ai_page_locator": "allow"
  }
}
```

`edit: deny` 同时覆盖 `edit`、`write` 和 `patch`。`external_directory: deny` 阻止 OpenCode 文件工具访问任务目录外路径。`bash: deny` 使模型无法调用通用 shell；`ai_page_*` 工具逐项放行，最终名称以 POC 注册出的 MCP 工具名为准。[权限文档](https://opencode.ai/docs/permissions/)

不要传 `--auto` 或任何跳过权限的参数。所有能力都必须明确配置为 `allow` 或 `deny`，不能留下 `ask`：非交互模式会自动拒绝 `ask`，而且当前实现会向 stdout 写入人类可读提示，污染 JSONL。显式 `deny` 也不会被 `--auto` 覆盖。[权限文档](https://opencode.ai/docs/permissions/#auto-mode)、[`run.ts` 权限处理](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/cli/cmd/run.ts)

### 只开放页面 MCP 工具

OpenCode 官方支持用固定命令数组启动本地 MCP server，并把 MCP 工具按“服务名_工具名”注册。首版服务名为 `ai_page`，只注册页面探索需要的少量工具。[MCP 文档](https://opencode.ai/docs/mcp-servers/#local)、[MCP 工具命名](https://opencode.ai/docs/mcp-servers/#glob-patterns)

应用提供一个随包发布的 `ai-page-mcp`。它内部调用锁定版本的 `@playwright/cli`，并负责：

- 只暴露 `open`、`act`、`snapshot`、`locator` 等固定 JSON Schema 工具；
- 从宿主上下文取得任务目录、项目登录态和目标环境，不接受任意文件路径；
- 只向当前任务的 `evidence/` 写 snapshot、截图和诊断证据；
- 不把 Cookie、Token、密码或完整 `storageState` 返回给 Agent；
- 把页面事实作为 MCP tool result 返回给 Agent。

不要允许 `npx *`、`npm *`、`pwsh *`、`cmd *` 或裸 `playwright-cli *`。即使 OpenCode 支持细粒度 bash 规则，也不能把字符串命令白名单证明为操作系统安全边界。禁用 bash 后，模型不能自行拼 shell、包名或文件路径；本地 MCP 的启动命令由宿主配置，不由模型生成。

### `cwd` 不是安全隔离

`--dir` 只改变 OpenCode 的项目工作目录；`external_directory` 也是 OpenCode 的工具权限规则。官方文档没有把二者定义为操作系统沙箱。允许执行的子进程仍以当前 Windows 用户权限运行，因此 **cwd 和 permission 都不能单独作为安全边界**。[CLI `--dir`](https://opencode.ai/docs/cli/#run)、[外部目录权限](https://opencode.ai/docs/permissions/#external-directories)

首版的实际隔离来自三点：

1. 任务目录位于仓库和正式数据目录之外，Agent 看不到源码，也不持有正式数据路径。
2. 任务输入只放脱敏副本；项目 `storageState` 由 `ai-page-mcp` 在内部复用，不复制给 Agent。
3. Agent 只能调用参数受 Schema 约束的页面 MCP 工具；正式页面档案和测试计划仍由宿主校验后写入。

如果未来要把 Agent 视为不可信代码，而不是受权限约束的工具调用者，再增加独立低权限账户、Windows ACL 或系统级沙箱；首版不提前引入这一层。

## 任务目录

建议放在：

```text
%LOCALAPPDATA%\playwright-auto\ai-import\tasks\<task-id>\
├─ input\
│  ├─ cases.json
│  ├─ page-archives.json
│  ├─ rules.md
│  └─ test-plan.schema.json
├─ evidence\
├─ stdout.jsonl
└─ result\
   └─ candidate.json
```

- `input/` 只保存本任务所需的规范化用例、脱敏页面档案副本、生成规则和 Schema。
- `evidence/` 只由 `ai-page-mcp` 写入。
- `stdout.jsonl` 由宿主捕获，不由 Agent 写入。
- `candidate.json` 仅在宿主完成 JSON 解析和 Schema 校验后写入。
- 项目源码、正式页面档案、正式测试计划和 `storageState` 均不放入该目录。

任务目录不放在仓库中，也避免 OpenCode 向上发现仓库的 `opencode.json` 或 `.opencode` 配置。OpenCode 配置会合并多个来源；`OPENCODE_CONFIG_CONTENT` 属于高优先级的运行时配置，但仍应使用干净的子进程环境，并通过 `--pure` 排除外部插件。[配置优先级](https://opencode.ai/docs/config/#precedence-order)

## 恢复、取消与退出码

### 恢复

每个导入任务保存自己的 `sessionID`，恢复时使用：

```text
opencode --pure run --session <session-id> --format json --dir <same-task-dir> ...
```

不使用 `--continue`，因为它表示继续最近会话，后台存在多个历史任务时可能选错。恢复 Agent 会话也不代表浏览器状态一定仍在，因此页面探索结果必须按页面及时落盘。[CLI 会话参数](https://opencode.ai/docs/cli/#run)

### 取消与超时

官方 `run` 参数没有任务级 timeout 或 cancel 命令。Provider 的 `timeout` 和 `chunkTimeout` 只限制模型请求及流式分块等待，不是整个导入任务的 deadline。[配置超时](https://opencode.ai/docs/config/#models)

宿主必须维护任务总 deadline。用户取消或超时时终止 OpenCode 进程树，任务标记为“已中断”；已经落盘的页面档案和用例不回滚。Windows 上需要在 POC 中验证 OpenCode、`ai-page-mcp` 与浏览器子进程均被清理，不能只验证父进程退出。

### 退出码

当前源码在参数错误、会话错误和请求错误时使用非零退出，但官方没有承诺可依赖的业务 exit code 枚举。因此首版只区分：

- `0`：必要但不充分的成功条件；
- 非 `0`、被终止、超时：Agent 失败或取消。

不能根据某个特定非零数字判断“可恢复”“模型错误”或“权限错误”；具体原因从 JSONL `error` 事件和 stderr 诊断。[`run.ts` 错误处理](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/cli/cmd/run.ts)、[CLI 顶层退出处理](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/index.ts)

## Windows 与版本锁定

OpenCode 官方说明可直接运行于 Windows，但推荐 WSL 以获得更好的文件系统和终端兼容性。打包应用不能要求用户另装 WSL，因此首版目标是原生 Windows；是否可用由锁定版本的完整 POC 决定，而不是只依赖文档结论。[Windows 文档](https://opencode.ai/docs/windows-wsl/)

调研时的稳定候选版本是 [`v1.18.18`](https://github.com/anomalyco/opencode/releases/tag/v1.18.18)。版本策略：

1. POC 通过后，直接随应用分发对应 release 的 Windows binary 与 MIT LICENSE，并记录版本和 SHA-256；不依赖全局安装。
2. 将 `@playwright/cli` 写成精确版本，提交 lockfile，不使用 `latest` 或 `^`。
3. 设置 `autoupdate: false`，不允许 OpenCode 在用户机器上自行升级。
4. 把 OpenCode binary 和 `ai-page-mcp` 放到可执行的应用资源目录，不从 ASAR 内直接运行。
5. 通过绝对路径启动 OpenCode，启动前校验文件 SHA-256 和 `opencode --version`。
6. 升级任一版本时重新执行集成契约测试。

如果构建流程更适合 npm，也可以精确锁定 `opencode-ai@<verified-version>`；其发布物通过 `postinstall` 选择同版本的平台 binary，打包时必须确认对应 Windows 包被保留。直接内置 release binary 的路径更少，作为首选。[官方 launcher](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/bin/opencode)、[官方发布脚本](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/script/publish.ts)、[npm 包](https://www.npmjs.com/package/opencode-ai)

## 开发前 POC

只做一条完整链路，验证锁定版本组合：

```text
OpenCode 原生 Windows
→ 公司 Chat Completions 或 Responses endpoint
→ ai-page-mcp
→ 项目已保存 storageState
→ 页面 snapshot 与 locator
→ JSONL 最终候选
→ 宿主 Schema 校验
```

POC 同时验证：

- `--format json` 的事件顺序和最终文本提取规则；
- 权限拒绝任意文件写入、外部目录访问和所有 bash 调用；
- 只注册 `ai_page_*` MCP 工具，且 `ai-page-mcp` 只能写当前任务的 `evidence/`；
- 显式 `--session` 恢复；
- 用户取消、总超时和进程树清理；
- Chat Completions 模型的工具调用质量足以完成真实页面探索。

这些通过后直接实现 OpenCode 集成。首版不增加 OpenAI Agents SDK 路由层，也不保留 Codex CLI 运行时代码。
