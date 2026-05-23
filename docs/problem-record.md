## 模板
---
## YYYY-MM-DD 问题的标题

- 状态：已解决/待解决/不解决只做记录
- 问题：
- 处理：
- 经验：

---

## 2026-05-23 后端结构性边界加固

- 状态：已解决
- 问题：路径参数校验、API 错误状态码、CORS 来源控制和 Playwright 子进程启动策略原本分散，后续扩展容易引入路径边界不清、错误语义混乱、跨站访问本地服务、命令经 shell 解析等风险。
- 处理：新增 `server/src/lib/guard.ts` 统一校验路径参数；新增 `server/src/lib/http-error.ts` 区分 `400/403/404/409/500`；`server.corsOrigins` 配置默认只允许本机前端来源并支持追加来源；新增 `server/src/services/playwright-cli.ts`，运行和实测检查改为 `process.execPath + 本地 Playwright CLI + shell:false`。
- 经验：本地工具也要把浏览器来源视为安全边界；`server.corsOrigins` 是 `playwright-auto.config.json` 中的字段，不是单独文件；路径校验应放在路径函数前作为最后防线，路由层和服务层只做业务语义判断。

---
