# 自动化测试平台

这是一个本地运行的浏览器自动化测试平台。测试人员可以通过 Web 页面创建项目、维护测试用例、录制操作步骤、保存登录态，并按项目运行 Playwright 测试与查看报告。

## 技术栈

- 前端：Vue 3、Vue Router、Element Plus、Vite
- 后端：Node.js、Express、Zod
- 自动化：Playwright
- 测试：Vitest、Supertest、Playwright Test
- 存储：本地文件系统

## 安装

项目使用离线 Playwright 浏览器依赖。请先把依赖放到 `vendor/playwright`，再安装 npm 包：

```bash
npm install
```

安装脚本只检查离线依赖是否存在，不会联网下载浏览器、FFmpeg 或 Windows 依赖检查工具。

## 离线依赖

当前项目锁定 `@playwright/test` 为 `1.60.0`，Windows 依赖目录如下：

```text
vendor/
  playwright/
    chrome-win64/
      chrome.exe
    chrome-headless-shell-win64/
      chrome-headless-shell.exe
    ffmpeg-win64/
      ffmpeg-win64.exe
    winldd-win64/
      PrintDeps.exe
```

对应下载地址：

```text
https://cdn.playwright.dev/builds/cft/148.0.7778.96/win64/chrome-win64.zip
https://cdn.playwright.dev/builds/cft/148.0.7778.96/win64/chrome-headless-shell-win64.zip
https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip
https://cdn.playwright.dev/dbazure/download/playwright/builds/winldd/1007/winldd-win64.zip
```

## 启动

```bash
npm run dev
```

`npm run dev` 会先启动本地服务，再等待健康检查通过后启动前端开发服务，避免前端代理在后端未就绪时出现连接失败。

默认地址：

- 前端页面：http://localhost:5177
- 本地服务：http://localhost:3001
- 健康检查：http://localhost:3001/health

## 本地配置

项目根目录的 `playwright-auto.config.json` 用于调整本地运行参数。

> **提示**：为防止敏感信息（如 API Key）被意外提交到代码库，项目使用配置模板机制。首次运行前，请复制 `playwright-auto.config.json.example` 并重命名为 `playwright-auto.config.json`，然后在其中填入你自己的配置（它已被 `.gitignore` 忽略，你的修改不会被 Git 追踪）。

```json
{
  "server": {
    "port": 3001,
    "dataRoot": "data",
    "corsOrigins": [
      "http://localhost:5177",
      "http://127.0.0.1:5177"
    ]
  },
  "web": {
    "origin": "http://localhost:5177",
    "apiBase": ""
  },
  "runner": {
    "headlessWorkers": 8,
    "headedWorkers": 1,
    "maxWorkers": 20
  },
  "browser": {
    "openTimeoutMs": 30000
  },
  "steps": {
    "timeouts": {
      "navigation": 20000,
      "action": 2000,
      "wait": 1000
    }
  },
  "agent": {
    "protocol": "chat-completions",
    "provider": "corp",
    "model": "test-agent",
    "baseUrl": "",
    "apiKey": "",
    "opencodePath": "",
    "playwrightMcpPath": "",
    "timeoutMs": 180000,
    "contextLimit": 0,
    "outputLimit": 0,
    "reasoningEffort": ""
  }
}
```

- `server.port`：后端服务端口。
- `server.dataRoot`：项目、用例、登录态和报告数据目录。
- `server.corsOrigins`：允许访问本地 API 的前端来源列表。这是 `playwright-auto.config.json` 中 `server` 对象下的字段，不是单独文件。默认允许 `http://localhost:5177` 和 `http://127.0.0.1:5177`。
- `web.origin`：前端页面来源，会自动加入本地 API 的 CORS 允许列表。
- `web.apiBase`：前端请求 API 的基础地址。默认空字符串表示使用相对路径 `/api`，开发服务会通过 Vite proxy 转发到后端；需要前端直接跨端口访问后端时可设置为 `http://localhost:3001`。
- `runner.headlessWorkers`：无头运行默认并发数。
- `runner.headedWorkers`：可视调试默认并发数。
- `runner.maxWorkers`：运行中心允许选择的最大并发数。
- `browser.openTimeoutMs`：平台打开业务 URL 的等待上限，当前用于手动登录初始打开 URL。
- `steps.timeouts.navigation`：生成、运行和实测步骤中打开页面动作的默认等待毫秒数，不用于平台自身打开业务 URL。
- `steps.timeouts.action`：手动新增点击、输入、选择等操作步骤，和录制导入操作步骤的默认等待毫秒数。
- `steps.timeouts.wait`：手动新增等待步骤的默认等待毫秒数。
- `agent.protocol`：模型协议，`chat-completions` 或 `responses`。
- `agent.provider` / `agent.model`：OpenCode 自定义供应商标识与模型名。`provider` 可自定（示例用 `corp` 表示公司内部模型），会拼进 `--model <provider>/<model>`。
- `agent.baseUrl`：模型服务地址，也可用 `AI_BASE_URL`。
- `agent.apiKey`：模型密钥，写在已被 gitignore 的本地 `playwright-auto.config.json`；也可用 `AI_API_KEY`，环境变量优先。密钥不会返回给前端，也不会写入任务目录。
- `agent.opencodePath` / `agent.playwrightMcpPath`：OpenCode 与官方 Playwright MCP 的本机路径。
- `agent.timeoutMs`：单次页面探索的总超时。
- `agent.contextLimit` / `agent.outputLimit`：写入 OpenCode 自定义模型的 `limit.context` / `limit.output`。`0` 或不填则不写入。Grok 4.6 上下文为 `500000`；官方输出无硬上限，OpenCode 需要两项时可同样填 `500000`。只填 context 时 output 与 context 相同。
- `agent.reasoningEffort`：写入模型 `options.reasoningEffort`，可选 `low` / `medium` / `high` / `xhigh`。空字符串不写入。Grok 4.6 不填时网关默认 `high`，且不能关闭思考。
同名环境变量仍可临时覆盖或扩展配置文件：`PORT`、`DATA_ROOT`、`VITE_API_BASE`、`PLAYWRIGHT_AUTO_CORS_ORIGINS`、`PLAYWRIGHT_AUTO_HEADLESS_WORKERS`、`PLAYWRIGHT_AUTO_HEADED_WORKERS`、`PLAYWRIGHT_AUTO_MAX_WORKERS`、`PLAYWRIGHT_AUTO_AGENT_PROTOCOL`、`OPENCODE_BIN`、`PLAYWRIGHT_MCP_CLI`。`PLAYWRIGHT_AUTO_CORS_ORIGINS` 使用英文逗号分隔多个来源，例如 `https://tool.example,http://localhost:5174`。

## 安全边界

- 本地 API 默认只允许配置中的前端来源访问，未配置的浏览器来源会返回 `403`。
- 项目、用例、运行报告和实测检查等路径参数会在进入文件系统路径前统一校验。
- 新建项目时，项目标识会先去除首尾空白并转为小写；保存后的标识仍必须符合小写字母、数字和连字符规则。
- API 错误会按语义返回状态码：参数错误为 `400`，来源不允许为 `403`，资源不存在为 `404`，标识冲突为 `409`，未预期错误为 `500`。
- Playwright 运行和实测检查通过当前 Node 进程启动本地 Playwright CLI，不经过 shell 包装。

## 功能

- 项目管理：创建项目并维护多个环境地址
- 用例管理：创建、编辑、删除、恢复和永久删除测试用例
- 用例状态：支持草稿、待启用、启用；运行中心只展示启用且基础检查通过的用例
- 基础检查：自动检查用例完整性、必填字段、等待时间范围和定位质量，并在步骤表展示问题原因与建议
- 定位器构建器：在用例编辑页通过角色、文本、标签、占位符、测试 ID、标题、图片文本、CSS（高级）等方式生成 selector，支持全量 role 搜索、正则、description、可见性过滤、包含/排除文本、包含/排除简单子定位器，同时保留手写定位模式；当前能力矩阵和 Playwright 已支持但尚未放入 UI 的候选能力见 `docs/locator-builder-development.md`
- 草稿保存：编辑页支持只保存 `case.json` 草稿，不生成测试文件；草稿保存也会执行基础检查，但不会因检查不通过而阻断；开始实测检查前会自动保存当前草稿
- 测试文件生成：保存并生成测试文件、切换到待启用或启用时会执行基础检查，检查不通过会返回具体问题并阻断生成
- 用例导出：导出单条用例目录，包含结构化数据和 Playwright spec
- 步骤编辑：支持跳转、点击、右键、双击、悬停、输入、选择、等待和断言步骤；支持选中步骤后插入、单步上移下移、单步复制和批量删除、批量上移下移、批量复制、全选、取消批量
- 录制导入：通过 Playwright codegen 录制操作，并把录制步骤插入到当前选中步骤后方；未选中步骤时追加到末尾
- 登录态：在用例管理页或运行中心维护项目环境对应的 storageState，编辑页实测检查和运行测试会复用；不需要登录的项目可以直接运行
- 运行管理：按项目运行测试，查看运行状态、报告地址并导出报告
- AI 导入：在项目中上传「用例」「步骤」双表 Excel，校验后创建导入任务；打开任务详情后由 OpenCode 结合官方 Playwright MCP 做页面探索，生成可审阅的 TestIntent。同一页面的探索结果写入项目级页面档案，其他用例等待并复用；不同页面最多 4 个隔离 worker 并行。探索在后台进行，离开详情页不会取消。探索失败时页面只显示短摘要。测试可注入 Fake AgentRunner。用户可以确认或单条重试；有未解决待确认项时不能确认。确认不会发布正式用例，未发布前可以取消确认。任务详情默认展示业务步骤，并直接展示可编辑的定位和填写值。只有显式发布才会把意图转为 Action IR，写入 `case.json` 并生成 `case.spec.ts`，发布后的用例进入运行中心。服务中断后可在任务详情从检查点恢复，已成功项不会重做。相同内容的上传文件在项目资产库中只保存一份。用例管理页可查看、刷新或删除页面档案；刷新或删除不改变已经生成的测试计划和测试代码。

## 数据目录

所有项目数据保存在：

```text
data/
  projects/
    <projectKey>/
      project.json
      cases/
      trash/
      runs/
      auth/
      assets/
      imports/
      page-archives/
```

`cases/` 是可用测试用例，`trash/` 是回收站，`runs/` 保存运行记录和报告，`auth/` 保存登录态，`assets/` 是按内容去重的测试资产库，`imports/` 保存 AI 导入任务，`page-archives/` 保存项目级页面档案（current/previous 不可变版本）。

每条测试用例保存为独立目录：

```text
cases/
  <caseKey>/
    case.json
    case.spec.ts
```

`case.json` 是步骤级可视化编辑的数据源，`case.spec.ts` 是由 `case.json` 生成的 Playwright TypeScript 测试文件。状态切换不会删除 `case.json`；草稿保存只写 `case.json`，保存并生成测试文件、切换到待启用或启用时会刷新 `case.spec.ts`。

用例状态保存在 `case.json` 的 `status` 字段中：

- `draft`：草稿，不进入运行中心。
- `ready`：待启用，必须基础检查通过。
- `active`：启用，必须基础检查通过，且会进入运行中心。

基础检查结果保存在 `case.json` 的 `review` 字段中。新建空用例默认是草稿且未审查；保存草稿、保存并生成测试文件会生成基础检查结果。停止录制只会把录制步骤插入当前编辑页，不会落盘保存。基础检查包含完整性问题、定位问题、断言问题和等待时间问题。等待时间必须是 `0` 到 `600000` 毫秒之间的整数。基础检查规则位于 `shared/case-review.ts`，Playwright 表达式语法由生成或实测运行验证。当前规则清单见 `docs/case-review-rules.md`。

用例编辑页的选择器列默认显示可读摘要和原始 selector，点击“编辑定位”可打开定位器构建器。构建器会写入最终 `selector` 字符串，并在 `selectorDraft` 中保存结构化表单状态，便于再次打开时回填复杂定位。保存草稿或生成测试文件后，步骤表会展示最新基础检查结果；规则见 `docs/case-review-rules.md`。

登录态保存到：

```text
data/projects/<projectKey>/auth/default.storageState.json
```

## AI 导入 Excel

在项目用例管理页点击「AI 导入」，上传一份 `.xlsx` 文件。文件必须包含名为「用例」和「步骤」的两张工作表，列名固定，不接受「用例清单」「步骤明细」等别名。可先用 `docs/templates/ai-import-template.xlsx`：步骤「动作类型」是下拉选择，只能选打开页面、填写、选择、点击、检查可见、检查文本；把起始路径和步骤目标改成当前项目真实页面后再上传。探索成功后可在用例管理页打开「页面档案」，查看、刷新或删除该页的可复用事实。

「用例」列：

- 用例编号（文件内唯一）
- 用例名称
- 起始路径（相对路径，不要填写环境地址）
- 前置条件
- 预期结果
- 备注

「步骤」列：

- 用例编号
- 步骤序号（同一用例内有序）
- 动作类型
- 目标
- 数据
- 补充说明

动作类型只能使用：打开页面、填写、选择、点击、检查可见、检查文本。

各动作怎么填：

- 打开页面：目标写相对路径，数据留空
- 填写：目标写字段名，数据写要填的值
- 选择：目标写字段名，数据写要选的选项文字。日期写成页面上看到的文字，例如 `2026-08-27`。导入模板的「数据」列是文本格式，解析时也会把日期单元格转成这种日历文字，不会留下序列号或 ISO 时间。
- 点击：目标写按钮上的可见文字，数据留空
- 检查可见：目标写应出现的文字或控件名，数据留空
- 检查文本：目标写提示或字段名，数据写期望文案

某字段本次不用填时，删掉该步骤行，不要留空数据。

文件缺少工作表、缺少列或出现重复列时，整批导入会被阻断，并返回工作表、行号和原因。单个用例内容错误只影响该用例，其他有效用例仍会写入任务。成功后可在任务详情查看解析结果，并对已解析用例生成可审阅的测试意图。打开详情或点击重试会启动后台探索并立即进入「探索中」，页面按任务状态轮询；离开详情页不会取消探索。重试成功提示只在生成待确认意图之后出现，失败显示短摘要。有未解决待确认项时不能确认，应先重试或改 Excel 后重新导入。确认只把该条标为可发布，不会写入正式 `case.json` 或 `case.spec.ts`。未发布前可以取消确认。任务详情展开后默认审阅业务步骤，并直接展示定位和填写值：选择器用「编辑定位」修改，输入值/断言值可直接改；改动立即保存到导入任务，不会自动发布。发布会校验 Action IR，拒绝未解决歧义和未验证定位器，失败时展示具体原因；通过后写入正式用例并生成测试代码。检查点尚未写完时，任务详情可从检查点恢复并继续未完成项。

相同内容的 Excel 会登记到项目资产库并只存一份物理文件，但仍会创建新的导入任务，不会因为文件哈希相同而跳过上传。任务执行过程中逐项写入原子检查点；`POST /api/projects/<projectKey>/imports/<taskId>/resume` 会跳过已成功项、补写未完成项，且不会重新解析 Excel。`POST /api/projects/<projectKey>/imports/<taskId>/review` 启动后台探索并立即返回当前任务，详情页轮询 `GET` 直到探索结束。`POST /api/projects/<projectKey>/imports/<taskId>/cases/<caseId>/confirm` 确认单条意图，有未解决待确认项时拒绝；`POST /api/projects/<projectKey>/imports/<taskId>/cases/<caseId>/unconfirm` 取消确认；`POST /api/projects/<projectKey>/imports/<taskId>/cases/<caseId>/retry` 只重试目标条并同样立即返回；`POST /api/projects/<projectKey>/imports/<taskId>/cases/<caseId>/publish` 显式发布正式用例。`POST /api/projects/<projectKey>/imports/<taskId>/cleanup` 只删除该任务的工作、输出和诊断临时资料，已确认意图和探索定位器保留在 `cases/<itemId>/intent.json` 与 `exploration.json`。`DELETE /api/projects/<projectKey>/imports/<taskId>` 删除整个导入任务，不影响已发布正式用例和项目资产库。

导入任务保存在：

```text
data/projects/<projectKey>/imports/<taskId>/
  task.json
  checkpoint.json
  parse.json
  input/
    input.xlsx
    input.json
  work/
    <itemId>/
  output/
    <itemId>/intent.json
    <itemId>/exploration.json
  diagnostics/
    <itemId>/result.json
  cases/<itemId>/status.json
  cases/<itemId>/intent.json
  cases/<itemId>/exploration.json
```

测试资产保存在：

```text
data/projects/<projectKey>/assets/<sha256>/
  content
  meta.json
```

## 常用命令

```bash
npm run dev
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

`npm run lint` 当前等同于 `npm run typecheck`。

## 目录说明

- `web/src/pages`：前端页面目录；每个页面或页面组按目录存放 Vue 页面和页面级 TypeScript 逻辑
- `web/src/components`：前端通用或页面拆出的组件
- `web/src/api`：前端 API 调用
- `server/src/routes`：后端 HTTP 路由
- `server/src/services`：运行、录制、导出、登录态等业务逻辑；复杂任务按子目录聚合
- `server/src/lib`：文件存储、路径、schema 等基础逻辑
- `shared/types.ts`：前后端共享类型
- `tests`：单元测试、接口测试和冒烟测试
- `docs/agent-code-map.md`：AI 按需使用的代码定位地图
- `data`：项目数据目录
