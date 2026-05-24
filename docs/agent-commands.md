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
- `npm run dev` 会先启动后端，再通过 `scripts/wait-for-server.ts` 等待健康检查通过后启动前端

## 本地配置

- 配置文件：`playwright-auto.config.json`
- `server.corsOrigins` 是配置文件中 `server` 对象下的字段，不是单独文件
- 完整配置类型定义在 `shared/types.ts`，后端读取完整配置，`/api/app-config` 只返回前端需要的安全子集
- 默认允许来源：`http://localhost:5173`、`http://127.0.0.1:5173`
- 临时追加允许来源：`$env:PLAYWRIGHT_AUTO_CORS_ORIGINS='https://tool.example,http://localhost:5174'`
- 改服务端配置后需要重启已有 Node 服务

## 命令约定

- 默认不启动开发服务；只有用户明确要求时才运行 `npm run dev`
- 如果只启动前端调试，需确认后端健康检查已通过，否则 Vite proxy 可能连接失败
- 发现端口已占用时，不要换端口重复启动服务
- 服务端代码变更后，提醒开发人员重启已有服务
- 摘要类命令优先使用 `rtk`
- Playwright 命令不要用 `rtk` 包裹
- Playwright 运行和实测检查的子进程输出、退出码、启动错误和取消信号由 `server/src/services/playwright-cli.ts` 统一处理
- 需要原样读取中文文档时使用 `pwsh`
