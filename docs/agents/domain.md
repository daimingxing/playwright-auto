# Domain Docs

工程技能采用单一领域上下文：根目录 `CONTEXT.md` 与 `docs/adr/`。

## 使用规则

- 探索会影响业务术语、领域规则或架构决策的代码前，先读取 `CONTEXT.md`；需要判断历史架构决策时，再读取相关 `docs/adr/`。
- Issue、设计提议、假设和测试名称使用 `CONTEXT.md` 中定义的术语；未定义的概念记录为领域建模待补充项。
- 结论与现有 ADR 冲突时，明确指出冲突，不静默覆盖既有决策。

## 文件结构

```text
CONTEXT.md
docs/
  adr/
    0001-example-decision.md
```
