## 项目索引
以下文档仅作按需索引，不要在启动时默认展开:
- 需要按业务问题判断模块位置或改动影响面时：查阅 `docs/agent-code-map.md`
- 运行、健康检查、浏览器测试或执行检查命令时：查阅 `docs/agent-commands.md`。

## 注意事项
- 优先复用用户已启动的服务，不重复在后台启动。浏览器测试需要当前代码生效时，可重启相关服务后再测试。
- 遇到可复现、与现有文档不符或需要规避方案的问题时，在 `docs/problem-record.md` 记录现象、原因和处理方式。

## 交付
- 完成功能或修复后，说明改动内容和手动测试方法。
- 变更影响用户行为、配置、运行或测试方式时，更新对应 `docs/` 或 `README.md`；未影响时明确说明无需更新。

## Agent skills

### Issue tracker

任务与规格使用 GitHub Issues 管理。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认五类 triage 标签。见 `docs/agents/triage-labels.md`。

### Domain docs

使用单一上下文布局：根目录 `CONTEXT.md` 与 `docs/adr/`。见 `docs/agents/domain.md`。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
