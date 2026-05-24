## 模板
---
## YYYY-MM-DD 问题的标题

- 状态：已解决/待解决/不解决只做记录
- 问题：
- 处理：
- 经验：

---

## 2026-05-24 实测检查卡片高度回归

- 状态：已解决
- 问题：实测检查卡片为了让按钮贴到底部，使用 `min-height: 100%` 后没有同步处理盒模型，卡片的 padding 和 border 让实际高度超过父级 `.meta`，导致右侧卡片出现内部滚动，按钮需要滚动才能完整看到。
- 处理：把 `web/src/pages/CaseEditor.vue` 中的 `.practical-panel` 改为 `box-sizing: border-box` 和 `height: 100%`，保留纵向 flex 与按钮栏 `margin-top: auto`，让卡片贴合父级高度但不溢出。
- 经验：在已有 `max-height` 和 `overflow` 的容器内撑满子卡片时，优先确认 `scrollHeight` 与 `clientHeight`，并用边框盒计算高度，避免把内容底部固定变成滚动底部固定。

---

## 2026-05-23 后端结构性边界加固

- 状态：已解决
- 问题：路径参数校验、API 错误状态码、CORS 来源控制和 Playwright 子进程启动策略原本分散，后续扩展容易引入路径边界不清、错误语义混乱、跨站访问本地服务、命令经 shell 解析等风险。
- 处理：新增 `server/src/lib/guard.ts` 统一校验路径参数；新增 `server/src/lib/http-error.ts` 区分 `400/403/404/409/500`；`server.corsOrigins` 配置默认只允许本机前端来源并支持追加来源；新增 `server/src/services/playwright-cli.ts`，运行和实测检查改为 `process.execPath + 本地 Playwright CLI + shell:false`。
- 经验：本地工具也要把浏览器来源视为安全边界；`server.corsOrigins` 是 `playwright-auto.config.json` 中的字段，不是单独文件；路径校验应放在路径函数前作为最后防线，路由层和服务层只做业务语义判断。

---

## 2026-05-24 新建项目标识归一化范围控制

- 状态：已解决
- 问题：新建项目只需要把项目标识输入转为小写，迭代过程中容易顺手扩大到环境标识，导致小改动范围变大。
- 处理：只在新建项目提交和创建项目 schema 中归一化项目标识，环境标识继续沿用原有严格校验。
- 经验：标识类逻辑共用正则时，要先区分本次需求的入口范围；后端 schema 可做兜底归一化，路径 guard 仍保持严格校验作为文件系统边界。

---

## 2026-05-24 CodeGraph 索引滞后影响审查

- 状态：待解决
- 问题：全面审查时，CodeGraph 文件列表仍显示 `scripts/dev.mjs`、`scripts/wait-for-server.mjs` 和多个 `git_stats_*.cjs`，但真实文件系统通过 `rg --files` 和 `Get-Content` 确认这些脚本不存在或已不在当前工作树，说明 `.codegraph/` 索引滞后。
- 处理：本轮审查改以真实文件系统、`package.json`、现有测试和一次性复现脚本作为事实来源，只把 CodeGraph 作为结构入口参考。
- 经验：当 CodeGraph 与文件系统出现冲突时，先用 `rg --files` 或直接读取文件确认当前工作树；审查报告中的文件存在性、脚本接入状态和验证命令必须以当前文件系统为准。

---
