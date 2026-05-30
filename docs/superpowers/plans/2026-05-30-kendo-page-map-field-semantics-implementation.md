# Kendo 页面地图字段语义层实施计划

## 背景

设计文档：`docs/superpowers/specs/2026-05-30-kendo-page-map-field-semantics-design.md`

目标是在保留页面地图多状态缓存和 `uiLibrary` 动态策略的基础上，新增 `fields` 字段语义层，优先解决 Kendo 表单字段归属丢失、下拉 selector 不可靠、AI 把当前值当字段名的问题。

## 阶段 1：PageContext fields 与 Kendo 字段采集

风险等级：高风险。

写入范围：

- `server/src/services/ai/page-context.ts`
- `tests/server/ai-case-draft.test.ts`
- 必要时少量调整 `shared/types.ts`

要求：

1. 在 `PageContext` 增加 `fields?: PageField[]`，定义 `PageField/PageLocator/PageOption` 类型。
2. `readPageSnapshot()` 写入 `fields`。
3. `uiLibrary=kendo` 时从 Kendo 控件反向查找字段容器和 label。
4. `uiLibrary=auto` 时检测到 Kendo 特征也采集 Kendo fields。
5. `uiLibrary=native` 不主动采集 Kendo fields。
6. Kendo 下拉字段中 `name` 必须是字段 label，例如 `取样类别`；当前值 `---请选择---` 只能进入 `value`。
7. 首选 locator 不能是 `getByLabel('---请选择---')`。
8. 保留旧 `elements`，不破坏历史快照兼容。

最小验证：

- `rtk npm test -- tests/server/ai-case-draft.test.ts`
- `rtk npm run typecheck`

复审：

- 规格复审：确认字段归属、uiLibrary 策略和兼容要求。
- 质量复审：确认页面 evaluate、locator 字符串、唯一性判断和 disabled/readonly 判断没有真实风险。

提交：

- `feat(page-context): add field semantics for kendo controls`

## 阶段 2：AI 摘要、selector 补全和提示词改造

风险等级：高风险。

写入范围：

- `server/src/services/ai/ai-case-draft.ts`
- `server/src/prompts/ai-case-draft-prompt.ts`
- `tests/server/ai-case-draft.test.ts`

要求：

1. `summarizePageMap()` 把 `fields` 传给 AI，并保留 `elements` 兜底。
2. 单条用例的 `pageContext` 输入也包含 `fields`。
3. `completeDraftSelectorsFromPageMap()` 和单条 selector 补全优先按 `fields[].name` 匹配 `targetName`。
4. `targetType=select/input/date` 时优先使用字段候选。
5. 非初始状态字段被使用时，warnings 说明来源状态。
6. 未匹配 fields 时回退旧 `elements` 逻辑。
7. 动态提示词强调 `field.name` 是字段名、`field.value` 是当前值、Kendo select 不拆多个 click。

最小验证：

- `rtk npm test -- tests/server/ai-case-draft.test.ts`
- `rtk npm run typecheck`

复审：

- 规格复审：确认 AI 输入和补全逻辑优先使用 fields。
- 质量复审：确认 AI 输出归一化、selector 降置信、warnings 合并不被破坏。

提交：

- `feat(ai-import): prefer page fields for draft selectors`

## 阶段 3：页面地图展示、options/诊断收口和全局复审

风险等级：中风险。

写入范围：

- `web/src/pages/ai-import/AiImportList.vue`
- `shared/types.ts`
- `server/src/services/ai/page-context.ts`
- 相关前端或服务端测试
- `docs/agent-code-map.md`
- `docs/problem-record.md`

要求：

1. 页面地图详情展示每个状态的字段语义：字段名、类型、UI、当前值、首选 selector、唯一性、来源。
2. 如实现成本可控，Kendo select 在安全探索时读取 `aria-controls` 对应 popup options；如果风险过高，保留为诊断字段并在文档中说明未实现。
3. 更新项目索引或问题记录，说明 Kendo 字段语义层和已知边界。
4. 补充必要前端类型或测试。
5. 运行最终全局验证。

最小验证：

- `rtk npm test -- tests/server/ai-case-draft.test.ts tests/web/ai-import-api.test.ts`
- `rtk npm run typecheck`
- `rtk npm test`
- `rtk npm run build`

复审：

- 阶段内做一次规格复审。
- 最终全局复审并行检查跨阶段遗漏、真实用户流程、缓存兼容和提示词一致性。

提交：

- `feat(page-map): show field semantics in import map detail`

## 主控约束

- 主控不直接改业务代码，除非是小范围收口或解除阻塞。
- 高冲突文件串行处理，特别是 `page-context.ts`、`ai-case-draft.ts`、`shared/types.ts`。
- 每个阶段验收通过后提交一次。
- 提交前检查 `git status --short`，避免带入无关文件。
- 最终提醒用户：后端服务需要重启后才能使用新的采集和 AI 生成逻辑。
