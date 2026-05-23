## 项目索引
以下文档和图谱仅作按需索引，不要在启动时默认展开:
- 如果需要理解代码结构、符号关系、调用链或跨文件连接：优先使用 `graphify query/path/explain`
- 如果 Graphify 没有命中、结果过散，或需要按业务问题判断影响面：查阅 `docs/agent-code-map.md`
- 如果需要运行、检查命令时：查阅 `docs/agent-commands.md`

## 注意事项
- 项目已由用户启动，不要重复启动，但如果需要重启后端服务器，提醒用户。
- 遇到意外情况、理解障碍、思维卡点或踩坑时，记录到 `docs/problem-record.md`。

## Serena MCP 使用约定：
- 涉及代码结构理解、符号关系、跨文件影响判断、引用追踪、重命名或符号级修改时，推荐优先使用 Serena MCP。
- 查看文件结构时，优先用 `get_symbols_overview`；定位定义时，优先用 `find_symbol`；确认引用时，优先用 `find_referencing_symbols`。
- 文件较大、组件较复杂、或需要降低文本搜索误报时，先用 Serena 缩小范围，再读取具体代码。
- 实际选择工具时，以“能否减少误报、减少上下文读取、提升修改安全性”为准，不机械使用。

<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture / trace questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->