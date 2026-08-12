# Issue Tracker

本仓库的任务与规格使用 GitHub Issues 管理，所有操作使用 `gh` CLI。

## 约定

- 任务和规格发布到 Issue 时，创建 GitHub Issue。
- 读取任务时，运行 `gh issue view <number> --comments`。
- PR 不作为 triage 请求来源。
- Issue 与 PR 共用编号；只给出编号时，先用 `gh issue view <number>` 确认其类型。

## 常用操作

- 列出待处理 Issue：`gh issue list --state open --json number,title,body,labels,author,comments`。
- 创建 Issue：`gh issue create --title "..." --body "..."`。
- 更新标签：`gh issue edit <number> --add-label <label>` 或 `--remove-label <label>`。
