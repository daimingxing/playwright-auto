# Playwright 自动化测试平台

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

- 前端页面：http://localhost:5173
- 本地服务：http://localhost:3001
- 健康检查：http://localhost:3001/health

## 本地配置

项目根目录的 `playwright-auto.config.json` 用于调整本地运行参数：

```json
{
  "server": {
    "port": 3001,
    "dataRoot": "data",
    "corsOrigins": [
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]
  },
  "web": {
    "origin": "http://localhost:5173",
    "apiBase": ""
  },
  "runner": {
    "headlessWorkers": 8,
    "headedWorkers": 1,
    "maxWorkers": 20
  },
  "steps": {
    "timeouts": {
      "navigation": 20000,
      "action": 2000,
      "wait": 1000
    }
  }
}
```

- `server.port`：后端服务端口。
- `server.dataRoot`：项目、用例、登录态和报告数据目录。
- `server.corsOrigins`：允许访问本地 API 的前端来源列表。这是 `playwright-auto.config.json` 中 `server` 对象下的字段，不是单独文件。默认允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`。
- `web.origin`：前端页面来源，会自动加入本地 API 的 CORS 允许列表。
- `web.apiBase`：前端请求 API 的基础地址。默认空字符串表示使用相对路径 `/api`，开发服务会通过 Vite proxy 转发到后端；需要前端直接跨端口访问后端时可设置为 `http://localhost:3001`。
- `runner.headlessWorkers`：无头运行默认并发数。
- `runner.headedWorkers`：可视调试默认并发数。
- `runner.maxWorkers`：运行中心允许选择的最大并发数。
- `steps.timeouts.navigation`：手动新增打开页面步骤、录制导入打开页面步骤的默认等待毫秒数。
- `steps.timeouts.action`：手动新增点击、输入、选择等操作步骤，和录制导入操作步骤的默认等待毫秒数。
- `steps.timeouts.wait`：手动新增等待步骤的默认等待毫秒数。

同名环境变量仍可临时覆盖或扩展配置文件：`PORT`、`DATA_ROOT`、`VITE_API_BASE`、`PLAYWRIGHT_AUTO_CORS_ORIGINS`、`PLAYWRIGHT_AUTO_HEADLESS_WORKERS`、`PLAYWRIGHT_AUTO_HEADED_WORKERS`、`PLAYWRIGHT_AUTO_MAX_WORKERS`。`PLAYWRIGHT_AUTO_CORS_ORIGINS` 使用英文逗号分隔多个来源，例如 `https://tool.example,http://localhost:5174`。

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
- 草稿保存：编辑页支持只保存 `case.json` 草稿，不生成测试文件；草稿保存也会执行基础检查，但不会因检查不通过而阻断
- 测试文件生成：保存并生成测试文件、切换到待启用或启用时会执行基础检查，检查不通过会返回具体问题并阻断生成
- 用例导出：导出单条用例目录，包含结构化数据和 Playwright spec
- 步骤编辑：支持跳转、点击、右键、双击、悬停、输入、选择、等待和断言步骤；支持选中步骤后插入、单步上移下移、单步复制和批量删除、批量上移下移、批量复制、全选、取消批量
- 录制导入：通过 Playwright codegen 录制操作，并导入为步骤数据
- 登录态：通过有头浏览器手动登录，保存 storageState 后复用；不需要登录的项目可以直接运行
- 运行管理：按项目运行测试，查看运行状态、报告地址并导出报告

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
```

`cases/` 是可用测试用例，`trash/` 是回收站，`runs/` 保存运行记录和报告，`auth/` 保存登录态。

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

基础检查结果保存在 `case.json` 的 `review` 字段中。新建空用例默认是草稿且未审查；保存草稿、保存并生成测试文件会生成基础检查结果。停止录制只会把录制步骤带回当前编辑页，不会落盘保存。基础检查包含完整性问题、定位问题、断言问题和等待时间问题。等待时间必须是 `0` 到 `600000` 毫秒之间的整数。基础检查的共享规则位于 `shared/case-review.ts`，前端编辑预览和后端正式检查共用同一套纯规则。当前规则清单见 `docs/case-review-rules.md`。

用例编辑页的选择器列默认显示可读摘要和原始 selector，点击“编辑定位”可打开定位器构建器。构建器会写入最终 `selector` 字符串，并在 `selectorDraft` 中保存结构化表单状态，便于再次打开时回填复杂定位；应用后会让当前步骤进入待检查，并在停止编辑 400ms 后复用同一套基础检查规则重新预览。定位器构建器设计、当前能力矩阵、未放入 UI 的 Playwright 候选能力和建议迭代优先级见 `docs/locator-builder-development.md`；选择器语法、options 和质量兜底规则见 `docs/case-review-rules.md`。

登录态保存到：

```text
data/projects/<projectKey>/auth/default.storageState.json
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

- `web/src/pages`：前端页面和页面级组合逻辑
- `web/src/components`：前端通用或页面拆出的组件
- `web/src/api`：前端 API 调用
- `server/src/routes`：后端 HTTP 路由
- `server/src/services`：运行、录制、导出、登录态等业务逻辑
- `server/src/lib`：文件存储、路径、schema 等基础逻辑
- `shared/types.ts`：前后端共享类型
- `tests`：单元测试、接口测试和冒烟测试
- `docs/agent-code-map.md`：AI 按需使用的代码定位地图
- `data`：项目数据目录
