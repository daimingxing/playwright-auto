# Playwright 自动化测试平台

这是一个本地 Web 页面 + Node 服务的浏览器自动化测试平台。测试人员可以通过页面创建项目、维护测试用例，并按项目运行 Playwright 测试。

## 安装

项目不再在安装阶段下载 Playwright 浏览器内核、FFmpeg 或 Windows 依赖检查工具。请先把离线依赖放到 `vendor/playwright`，再执行：

```bash
npm install
```

安装脚本只会检查依赖是否存在；如果缺少文件，会列出缺失项并退出。

## Vendor 依赖清单

当前项目锁定 `@playwright/test` 为 `1.60.0`，对应的 Windows 依赖如下：

| 依赖 | 版本 | 用途 | 目标文件 |
|---|---|---|---|
| Chromium | `1223` / Chrome for Testing `148.0.7778.96` | 浏览器自动化 | `vendor/playwright/chrome-win64/chrome.exe` |
| Chromium Headless Shell | `1223` / `148.0.7778.96` | Playwright Chromium 配套依赖 | `vendor/playwright/chrome-headless-shell-win64/chrome-headless-shell.exe` |
| FFmpeg | `1011` | 失败视频录制 | `vendor/playwright/ffmpeg-win64/ffmpeg-win64.exe` |
| Winldd | `1007` | Windows 依赖检查 | `vendor/playwright/winldd-win64/PrintDeps.exe` |

下载地址：

```text
https://cdn.playwright.dev/builds/cft/148.0.7778.96/win64/chrome-win64.zip
https://cdn.playwright.dev/builds/cft/148.0.7778.96/win64/chrome-headless-shell-win64.zip
https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip
https://cdn.playwright.dev/dbazure/download/playwright/builds/winldd/1007/winldd-win64.zip
```

解压后请按下面结构放置：

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

## 启动

```bash
npm run dev
```

默认地址：

- 前端页面：http://localhost:5173
- 本地服务：http://localhost:3001

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

`cases/` 是可用测试用例，`trash/` 是回收站。迁移用例时可以直接复制某个项目下的 `cases/` 目录。

## 用例文件

每条测试用例保存为独立目录：

```text
cases/
  case-1/
    case.json
    case.spec.ts
```

`case.json` 是步骤级可视化编辑的数据源，`case.spec.ts` 是可迁移的 Playwright TypeScript 测试文件。

## 登录态

第一版不要求测试人员填写 CSS 选择器，也不长期保存用户名和密码。用户在运行中心点击“打开浏览器登录”，在有头浏览器中自行完成一次登录，然后回到页面点击“我已完成登录，保存登录态”。

登录态保存到项目目录：

```text
data/projects/<projectKey>/auth/default.storageState.json
```

后续运行测试会自动复用这份登录态，不需要每次重新生成。

## 检查

```bash
npm run lint
npm run test
npm run build
```
