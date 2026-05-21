
以下文档仅作按需索引，不要在启动时默认展开:
- 如果需要定位代码入口时：查阅 `docs/agent-code-map.md`
- 如果需要运行、检查命令时：查阅 `docs/agent-commands.md`

项目已由用户启动，不要重复启动，但如果需要重启后端服务器，提醒用户。

Serena MCP 使用约定：
- 涉及代码入口定位、函数/类/组件结构理解、调用关系、引用关系、重命名或符号级修改时，优先使用 Serena MCP。
- 需要全仓文本搜索、查看非代码文件、运行命令、检查进程、读取日志时，再使用 `rg` / shell。
- 如果 Serena 已激活当前项目，应先用 `get_symbols_overview`、`find_symbol`、`find_referencing_symbols` 等符号工具缩小范围，避免一开始读取大文件。

遇到意外情况、理解障碍、思维卡点或踩坑时，记录到 `docs/problem-record.md`。