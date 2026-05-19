# Playwright 自动化测试平台

这是一个本地 Web 界面 + Node 服务的浏览器自动化测试平台。测试人员通过页面创建项目、填写项目 URL、录制或维护测试用例，并按项目运行 Playwright 测试。

## 安装

```bash
npm install
```

安装完成后会自动执行：

```bash
playwright install chromium
```

这会安装 Playwright 所需的 Chromium 浏览器内核，并同时安装录制视频需要的 FFmpeg。浏览器路径由 Playwright 自己管理，代码中不会写死任何人的本地路径。

如果本机已经有可用的 Chromium，可以通过环境变量跳过下载：

```powershell
$env:PLAYWRIGHT_CHROMIUM_DIR='C:\path\to\chrome-win'
npm install
```

也可以直接指定浏览器可执行文件：

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\path\to\chrome-win\chrome.exe'
npm install
```

普通使用者不需要设置这个变量，直接 `npm install` 即可。

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
