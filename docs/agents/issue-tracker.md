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

## Wayfinding 操作

- 创建地图：`gh issue create --title "..." --body "..." --label wayfinder:map`。
- 创建子 Ticket：`gh issue create --title "..." --body "..." --label wayfinder:<type> --parent <map-number>`。
- 设置依赖：`gh issue edit <number> --add-blocked-by <blocking-number>`；移除时使用 `--remove-blocked-by`。
- 认领 Ticket：`gh issue edit <number> --add-assignee '@me'`。
- 查看地图及子 Ticket：`gh issue view <map-number> --json number,title,body,subIssues,subIssuesSummary,url`。
- 查看 Ticket 的依赖和认领状态：`gh issue view <number> --json state,assignees,blockedBy,blocking`。
- 记录决议并关闭：先运行 `gh issue comment <number> --body "..."`，再运行 `gh issue close <number>`，最后更新地图的 `Decisions so far`。

Frontier 是地图下所有处于打开状态、未分配负责人且 `blockedBy` 中没有未关闭依赖的子 Ticket。地图只索引已关闭 Ticket 的决议，不在正文中重复保存完整决议。
