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
    "dataRoot": "data"
  },
  "runner": {
    "headlessWorkers": 4,
    "headedWorkers": 1,
    "maxWorkers": 8
  }
}
```

- `server.port`：后端服务端口。
- `server.dataRoot`：项目、用例、登录态和报告数据目录。
- `runner.headlessWorkers`：无头运行默认并发数。
- `runner.headedWorkers`：可视调试默认并发数。
- `runner.maxWorkers`：运行中心允许选择的最大并发数。

同名环境变量仍可临时覆盖配置文件：`PORT`、`DATA_ROOT`、`PLAYWRIGHT_AUTO_HEADLESS_WORKERS`、`PLAYWRIGHT_AUTO_HEADED_WORKERS`、`PLAYWRIGHT_AUTO_MAX_WORKERS`。

## 功能

- 项目管理：创建项目并维护多个环境地址
- 用例管理：创建、编辑、删除、恢复和永久删除测试用例
- 用例导出：导出单条用例目录，包含结构化数据和 Playwright spec
- 步骤编辑：支持跳转、点击、右键、双击、悬停、输入、选择、等待和断言步骤
- 录制导入：通过 Playwright codegen 录制操作，并导入为步骤数据
- 登录态：通过有头浏览器手动登录，保存 storageState 后复用
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

`case.json` 是步骤级可视化编辑的数据源，`case.spec.ts` 是可迁移的 Playwright TypeScript 测试文件。

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

- `web/src/pages`：前端页面
- `web/src/api`：前端 API 调用
- `server/src/routes`：后端 HTTP 路由
- `server/src/services`：运行、录制、导出、登录态等业务逻辑
- `server/src/lib`：文件存储、路径、schema 等基础逻辑
- `shared/types.ts`：前后端共享类型
- `tests`：单元测试、接口测试和冒烟测试
- `docs/agent-code-map.md`：AI 按需使用的代码定位地图
- `data`：项目数据目录
