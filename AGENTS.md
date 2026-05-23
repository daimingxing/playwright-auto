## 项目索引
以下文档和图谱仅作按需索引，不要在启动时默认展开:
- 如果需要理解代码结构、符号关系、调用链或跨文件连接：优先使用 `graphify query/path/explain`
- 如果 Graphify 没有命中、结果过散，或需要按业务问题判断影响面：查阅 `docs/agent-code-map.md`
- 如果需要运行、检查命令时：查阅 `docs/agent-commands.md`

## 注意事项
- 项目已由用户启动，不要重复启动，但如果需要重启后端服务器，提醒用户。
- 遇到意外情况、理解障碍、思维卡点或踩坑时，记录到 `docs/problem-record.md`。

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Serena MCP 使用约定：
- 涉及代码结构理解、符号关系、跨文件影响判断、引用追踪、重命名或符号级修改时，推荐优先使用 Serena MCP。
- 查看文件结构时，优先用 `get_symbols_overview`；定位定义时，优先用 `find_symbol`；确认引用时，优先用 `find_referencing_symbols`。
- 文件较大、组件较复杂、或需要降低文本搜索误报时，先用 Serena 缩小范围，再读取具体代码。
- 实际选择工具时，以“能否减少误报、减少上下文读取、提升修改安全性”为准，不机械使用。