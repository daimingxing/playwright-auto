# AI 命令参考

本文件只在需要运行项目或执行检查时查阅。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

`npm run lint` 当前等同于 `npm run typecheck`。

## 运行地址

- 前端页面：http://localhost:5173
- 本地服务：http://localhost:3001
- 健康检查：http://localhost:3001/health

## 命令约定

- 默认不启动开发服务；只有用户明确要求时才运行 `npm run dev`
- 发现端口已占用时，不要换端口重复启动服务
- 服务端代码变更后，提醒开发人员重启已有服务
- 摘要类命令优先使用 `rtk`
- Playwright 命令不要用 `rtk` 包裹
- 需要原样读取中文文档时使用 `pwsh`
