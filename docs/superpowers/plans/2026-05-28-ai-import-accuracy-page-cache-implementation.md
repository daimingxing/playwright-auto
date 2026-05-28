# AI 导入正确率与页面地图缓存实施计划

> **给后续智能体：**按任务执行时请使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。任务使用复选框跟踪；同一阶段内标注“不可并行”的任务必须串行，避免多个 worker 同时写同一文件。

**目标：**在现有 AI 导入链路上落地新版两表模板、页面地图缓存、受控动态探索和同 URL 分组生成，提升草稿用例正确率，并保留现有单条生成作为降级路径。

**架构：**先把 Excel 输入收敛为结构化两表模型，再把现有单次 `PageContext` 扩展为可持久化、多状态的 `PageMap`。导入 worker 按环境和目标 URL 分组处理，同组共用页面地图并优先批量调用 AI；失败时按小批次、单条用例逐级降级。

**技术栈：**TypeScript、Express、Vue 3、Element Plus、Vitest、Supertest、Playwright、ExcelJS、Zod、现有 AI SDK 封装。

---

## 执行约束

- 所有回复、文档、注释必须使用中文。
- 新增或修改代码时必须保留函数级注释；魔法数值、业务状态码、边界兼容处理和易歧义判断必须写行间注释。
- 命名使用常见英文，单个标识符不超过 3 个单词，避免生僻或堆叠修饰词。
- 优先编辑现有文件；只有职责清晰、避免大文件膨胀时才新增文件。
- 本计划不要求后续 worker 提交 commit；是否提交由主控流程决定。
- 任何阶段完成后都要检查 `README.md`、`docs/agent-code-map.md`、`docs/agent-commands.md`、`docs/ai-case-import/AI自然语言用例导入模板说明.md` 是否需要同步。
- 用户已启动项目时不要重复启动开发服务；服务端代码变更后需要提醒用户重启已有后端服务。

## 当前事实

- 当前 Excel 解析入口：`server/src/services/import/import-excel.ts`，现状为三表模板：`用例清单`、`步骤明细`、`测试数据`。
- 当前页面上下文采集入口：`server/src/services/ai/page-context.ts`，现状为单次静态 `PageContext`。
- 当前导入队列入口：`server/src/services/import/import-worker.ts`，现状为按导入项逐条生成。
- 当前 AI 草稿入口：`server/src/services/ai/ai-case-draft.ts`，现状为单条 `generateCaseDraft`。
- 当前导入 API：`server/src/routes/imports.ts`，现状支持上传、列表、预览项、重试、跳过、保存和删除导入任务。
- 当前前端页面：`web/src/pages/ai-import/AiImportList.vue`、`web/src/pages/ai-import/AiImportPreview.vue`。

## 阶段与并行策略

| 阶段 | 可并行性 | 说明 |
|---|---|---|
| 阶段一：模板简化 | 可拆 3 个 worker，但共享类型和解析必须先完成 | 模板和说明文档可与后端解析并行，前端预览等待共享类型稳定后再做。 |
| 阶段二：页面地图缓存 | 后端缓存模型先行，前端管理入口后置 | 共享类型、路径、store、路由不可并行写入同一文件。 |
| 阶段三：受控动态探索 | 在阶段二通过后串行实施核心采集，再并行补 UI 展示 | 动态探索会改 `page-context.ts` 和页面地图 store，避免多 worker 同写。 |
| 阶段四：同 URL 分组生成 | 串行实施 worker 与 AI 批量入口，最后统一验收 | `import-worker.ts`、`ai-case-draft.ts`、`api-imports.test.ts` 是高冲突文件。 |

---

## 阶段一：模板简化

### Task 1.1 新版两表导入模型与解析

**写入范围：**
- 修改：`shared/types.ts`
- 修改：`server/src/services/import/import-excel.ts`
- 修改：`tests/server/import-excel.test.ts`

**实现要点：**
- 在 `ImportStepSource` 中新增结构化字段：`actionType`、`targetType`、`targetName`、`inputValue`、`matchType`，保留 `actionText`、`targetText` 作为兼容展示字段。
- `ImportDataSource` 可短期保留，但新版两表解析时 `data` 返回空数组；`rowRefs.dataRows` 返回空数组。
- `parseImportExcel` 优先识别新版两表：`用例清单`、`步骤明细`；若存在旧版 `测试数据`，短期保留旧模板解析，错误信息明确区分“新版两表”和“旧版三表”。
- 解析 `中文(英文)` 值时只保存括号内英文枚举；无法识别时返回中文错误，例如 `步骤明细第 2 行动作类型不支持：提交(submit)`。
- `预期结果` 按设计改为可选；为空时传空字符串，不阻断导入。
- 校验步骤序号同一用例内必须从 1 连续递增。

**测试范围：**
- 新版两表模板成功解析。
- 动作类型、目标类型、匹配方式支持 `中文(英文)` 和纯英文兼容输入。
- 缺少必填列、缺少必填值、步骤序号不连续、未知枚举均返回中文错误。
- 旧版三表模板仍可解析，避免一次性破坏存量模板。

**验收命令：**

```powershell
npm test -- tests/server/import-excel.test.ts
npm run typecheck
```

### Task 1.2 AI prompt 和单条草稿生成适配结构化步骤

**写入范围：**
- 修改：`server/src/prompts/ai-case-draft-prompt.ts`
- 修改：`server/src/services/ai/ai-case-draft.ts`
- 修改：`tests/server/ai-case-draft.test.ts`

**实现要点：**
- prompt 中明确说明动作类型、目标类型、匹配方式已经由平台解析为英文枚举，AI 不需要猜测动作。
- AI 输入展示测试人员填写的中文对象名和输入/期望值，避免只给自由文本。
- `createTestDraft` 和 selector 补全逻辑优先使用 `actionType`、`targetType`、`targetName`、`inputValue`、`matchType`；旧字段只作为兼容兜底。
- 检查类动作优先生成 `assertText`、`assertVisible`、`assertValue`、`assertUrl`、`assertTitle`，普通动作不误用 `matchType`。

**测试范围：**
- prompt 包含结构化字段说明，不再要求模型从大段自然语言中猜动作。
- 结构化 `fill` 步骤能把 `输入/期望值` 映射到草稿步骤 `value`。
- 结构化检查步骤能把匹配方式映射到草稿步骤 `match`。
- 旧字段输入仍能生成测试环境固定草稿。

**验收命令：**

```powershell
npm test -- tests/server/ai-case-draft.test.ts
npm run typecheck
```

### Task 1.3 模板文件、导入预览展示与文档同步

**写入范围：**
- 修改：`docs/ai-case-import/AI自然语言用例导入模板.xlsx`
- 修改：`docs/ai-case-import/AI自然语言用例导入模板说明.md`
- 修改：`web/src/pages/ai-import/AiImportPreview.vue`
- 修改：`web/src/pages/ai-import/ai-import.ts`
- 修改：`tests/web/ai-import.test.ts`
- 检查：`README.md`、`docs/agent-code-map.md`；如不修改，必须在任务总结说明两表模板字段和预览入口无需更新的原因。

**实现要点：**
- Excel 模板改为两张业务工作表：`用例清单`、`步骤明细`；可保留 `填写说明` 工作表，但不得再要求 `测试数据`。
- `步骤明细` 列固定为：`用例编号`、`步骤序号`、`动作类型`、`目标类型`、`目标名称`、`输入/期望值`、`匹配方式`、`备注`。
- 动作类型、目标类型、匹配方式使用中文展示，例如 `点击(click)`，前端预览展示中文，不裸露内部英文枚举。
- 预览详情中展示新版源数据：动作、目标类型、目标名称、输入/期望值、匹配方式。
- 文档明确旧三表模板为兼容输入，新用户默认使用两表模板。

**测试范围：**
- `formatDraftStepType` 等前端格式化函数不显示裸英文枚举。
- 预览工具函数能从新版 `ImportStepSource` 生成步骤摘要。
- 模板说明包含两表字段、示例和不推荐写法。

**验收命令：**

```powershell
npm test -- tests/web/ai-import.test.ts
npm run typecheck
```

---

## 阶段二：页面地图缓存

### Task 2.1 页面地图类型、配置、缓存键与路径

**写入范围：**
- 修改：`shared/types.ts`
- 修改：`playwright-auto.config.json`
- 修改：`server/src/lib/app-config.ts`
- 修改：`server/src/lib/path.ts`
- 修改：`server/src/lib/guard.ts`
- 新增：`tests/server/page-map-store.test.ts`
- 检查：`tests/server/app-config-ai.test.ts`；如不修改，必须在任务总结说明现有 AI 配置测试无需覆盖 `pageMap` 默认值的原因。

**实现要点：**
- 在 `AiConfig` 下新增 `pageMap` 配置：`staleDays`、`maxActions`、`maxDepth`、`timeoutMs`、`autoCreate`。
- 新增共享类型：`PageMap`、`PageState`、`PageAction`、`PageMapStatus`、`PageMapSummary`。
- 缓存键至少包含：`projectKey`、`envKey`、`targetUrl`、`authHash`、`viewport`。
- `authHash` 由登录态文件更新时间或内容摘要生成；没有登录态时使用明确值，例如 `no-auth`。
- 页面地图路径：`data/projects/<projectKey>/page-maps/<mapId>/map.json` 和 `snapshots/<stateId>.json`。
- 路径和 ID 校验走 `guard.ts`，避免把 URL 或 mapId 直接带入文件系统。

**测试范围：**
- 配置默认值正确，公开配置不泄露 `apiKey`。
- 相同缓存键生成相同 `mapId`；登录态变化、视口变化、环境变化会生成不同缓存键。
- 非法 `mapId` 被拒绝。

**验收命令：**

```powershell
npm test -- tests/server/page-map-store.test.ts tests/server/app-config-ai.test.ts
npm run typecheck
```

### Task 2.2 页面地图 store 与初始静态采集

**写入范围：**
- 新增：`server/src/lib/page-map-store.ts`
- 修改：`server/src/services/ai/page-context.ts`
- 新增：`server/src/services/ai/page-map.ts`
- 修改：`tests/server/page-map-store.test.ts`
- 新增：`tests/server/page-map.test.ts`

**实现要点：**
- `page-map-store.ts` 只负责文件持久化：创建、读取、列表、删除、写入 snapshot、标记 stale。
- `page-map.ts` 负责业务编排：计算缓存键、查找可用缓存、无缓存时调用初始采集、把 `PageContext` 包成 `PageState`。
- 初始状态命名为 `初始页面`，`sourceAction` 为空。
- `map.json` 保存摘要、状态列表和 warning；snapshot 保存具体 `PageContext`，避免摘要文件过大。
- 缓存默认长期有效；超过 `staleDays` 只标记建议刷新，不自动删除。

**测试范围：**
- 创建页面地图后能读取 `map.json` 和初始 snapshot。
- 超过配置天数后状态变为建议刷新或带 `stale` 标记，但文件不删除。
- 页面不可访问时页面地图状态为 `failed`，warning 和错误信息可读。

**验收命令：**

```powershell
npm test -- tests/server/page-map-store.test.ts tests/server/page-map.test.ts
npm run typecheck
```

### Task 2.3 页面地图 API 与前端管理入口

**写入范围：**
- 新增：`server/src/routes/page-maps.ts`
- 修改：`server/src/app.ts`
- 修改：`web/src/api/imports.ts` 或新增 `web/src/api/page-maps.ts`
- 修改：`web/src/pages/ai-import/AiImportList.vue`
- 修改：`web/src/pages/ai-import/AiImportPreview.vue`
- 修改：`web/src/pages/ai-import/ai-import.ts`
- 修改：`tests/server/api-imports.test.ts` 或新增 `tests/server/api-page-maps.test.ts`
- 修改：`tests/web/ai-import.test.ts`
- 检查：`README.md`、`docs/agent-code-map.md`；如不修改，必须在任务总结说明页面地图 API 和管理入口无需更新文档索引的原因。

**实现要点：**
- API 最小集合：列表、查看、刷新、删除。
- 建议路径：`GET /api/projects/:projectKey/page-maps`、`GET /api/projects/:projectKey/page-maps/:mapId`、`POST /api/projects/:projectKey/page-maps/:mapId/refresh`、`DELETE /api/projects/:projectKey/page-maps/:mapId`。
- AI 导入预览页显示每条导入项使用的页面地图摘要：目标页面、环境、状态数量、更新时间、缓存状态。
- 列表页或预览页增加“页面地图”区域，支持查看、刷新、删除。
- 刷新操作只重新采集页面地图，不自动覆盖已有草稿。

**测试范围：**
- API 可列出、查看、刷新、删除页面地图。
- 删除不存在的页面地图返回中文错误。
- 前端格式化页面地图状态、缓存年龄和状态数量。

**验收命令：**

```powershell
npm test -- tests/server/api-page-maps.test.ts tests/web/ai-import.test.ts
npm run typecheck
```

---

## 阶段三：受控动态探索

### Task 3.1 安全动作识别

**写入范围：**
- 新增：`server/src/services/ai/page-action.ts`
- 新增：`tests/server/page-action.test.ts`
- 修改：`shared/types.ts`

**实现要点：**
- 从结构化步骤生成候选 `PageAction`，只允许菜单、页签、弹窗、下拉、日期控件、折叠面板、树节点、悬停浮层等探索动作。
- 默认禁止关键词：保存、提交、删除、移除、审批、确认、支付、发送、导入、导出、批量操作、启用、禁用。
- 禁止动作不执行，只在页面地图 warning 中记录“已跳过危险动作”。
- 安全判断必须同时看 `actionType`、`targetType`、`targetName`、`note`，不能只靠一个字段。

**测试范围：**
- 菜单展开、页签切换、打开下拉、打开弹窗被识别为安全。
- 保存、删除、提交、支付等关键词命中后被禁止。
- 同一动作路径超过 `maxDepth` 时被截断并记录 warning。

**验收命令：**

```powershell
npm test -- tests/server/page-action.test.ts
npm run typecheck
```

### Task 3.2 多状态页面地图采集

**写入范围：**
- 修改：`server/src/services/ai/page-context.ts`
- 修改：`server/src/services/ai/page-map.ts`
- 修改：`server/src/lib/page-map-store.ts`
- 修改：`tests/server/page-map.test.ts`
- 检查：`tests/server/ai-case-draft.test.ts`；如不修改，必须在任务总结说明多状态页面地图不会影响草稿 selector 补全测试的原因。

**实现要点：**
- 在初始页面上按安全动作路径执行探索，每个动作后调用 `readPageSnapshot` 生成 `PageState`。
- 支持菜单、弹窗、页签、下拉、悬停的最小可用探索；每次动作后等待页面稳定。
- 探索上限使用配置：`maxActions`、`maxDepth`、`timeoutMs`；这些值旁边必须有行间注释说明风险和性能边界。
- 每个状态保留 `sourceAction`，用于后续解释“这个元素来自哪个探索动作后”。
- 遇到探索失败时不让整张页面地图失败，记录状态 warning 并继续处理其他安全动作。

**测试范围：**
- 测试环境能生成包含初始状态和至少一个安全动作状态的页面地图。
- 危险动作只记录 warning，不产生探索状态。
- 探索失败保留已有状态，页面地图仍可用于 AI 输入。

**验收命令：**

```powershell
npm test -- tests/server/page-map.test.ts tests/server/page-action.test.ts
npm run typecheck
```

### Task 3.3 多状态页面地图展示与调试信息

**写入范围：**
- 修改：`web/src/pages/ai-import/AiImportPreview.vue`
- 修改：`web/src/pages/ai-import/ai-import.ts`
- 修改：`tests/web/ai-import.test.ts`
- 修改：`docs/ai-case-import/AI自然语言用例导入模板说明.md`

**实现要点：**
- 预览详情展示页面地图状态列表：初始页面、菜单展开、弹窗打开、页签切换等。
- warning 使用中文解释，例如“已跳过危险动作：保存”。
- 不在页面写“功能说明式大段文案”，只在对应状态和详情区域展示必要信息。
- 模板说明补充：保存、提交、删除等步骤可以写入模板生成草稿，但页面地图采集阶段不会执行。

**测试范围：**
- 页面地图状态格式化函数能显示状态名、来源动作和 warning。
- 危险动作 warning 不被误归类为生成失败。

**验收命令：**

```powershell
npm test -- tests/web/ai-import.test.ts
npm run typecheck
```

---

## 阶段四：同 URL 分组生成

### Task 4.1 导入队列按页面分组并复用页面地图

**写入范围：**
- 修改：`server/src/services/import/import-worker.ts`
- 修改：`server/src/lib/import-store.ts`
- 修改：`shared/types.ts`
- 修改：`tests/server/api-imports.test.ts`
- 新增或修改：`tests/server/import-worker.test.ts`

**实现要点：**
- 分组键：`projectKey`、`envKey`、`targetUrl`、`authHash`、`viewport`。
- `ImportItem` 增加 `pageMapId`、`groupId`、`groupIndex` 等必要字段，便于前端解释同组生成结果。
- `enqueueImportJob` 先加载导入项，按分组键聚合，再为每组查找或生成页面地图。
- 同组多条用例只生成或读取一次页面地图。
- 页面地图生成失败时，本组导入项进入 `failed`，错误信息一致且保留中文说明。

**测试范围：**
- 同 URL 多条用例只调用一次页面地图获取逻辑。
- 不同环境、不同登录态或不同 URL 不会误共用缓存。
- 页面地图失败时同组项失败，其他组不受影响。

**验收命令：**

```powershell
npm test -- tests/server/import-worker.test.ts tests/server/api-imports.test.ts
npm run typecheck
```

### Task 4.2 分组 AI 输入输出与结构校验

**写入范围：**
- 修改：`server/src/services/ai/ai-case-draft.ts`
- 修改：`server/src/prompts/ai-case-draft-prompt.ts`
- 修改：`tests/server/ai-case-draft.test.ts`

**实现要点：**
- 新增 `generateCaseDraftGroup`，输入包含 `pageMap` 和同组 `cases`。
- AI 输出必须按 `caseNo` 返回 `items`；某条失败时返回该用例失败原因，不影响同组其他用例。
- 保留 `generateCaseDraft` 作为单条降级入口。
- 归一化函数校验：缺少 `caseNo`、重复 `caseNo`、返回未知用例编号、草稿结构不合法都要转成中文错误。
- selector 补全从多状态页面地图中选择候选，warning 说明候选来自哪个状态。

**测试范围：**
- 分组 prompt 包含页面地图摘要和多条用例。
- 模型返回部分失败时，成功项进入待确认，失败项保留错误信息。
- 未返回某个 `caseNo` 时该用例失败，不影响其他用例。
- 单条降级入口行为保持不变。

**验收命令：**

```powershell
npm test -- tests/server/ai-case-draft.test.ts
npm run typecheck
```

### Task 4.3 降级策略、前端分组状态与最终验收

**写入范围：**
- 修改：`server/src/services/import/import-worker.ts`
- 修改：`server/src/lib/import-store.ts`
- 修改：`server/src/routes/imports.ts`
- 修改：`web/src/pages/ai-import/AiImportPreview.vue`
- 修改：`web/src/pages/ai-import/ai-import.ts`
- 修改：`tests/server/api-imports.test.ts`
- 修改：`tests/web/ai-import.test.ts`
- 修改：`README.md`
- 修改：`docs/agent-code-map.md`
- 修改：`docs/agent-commands.md`

**实现要点：**
- 分组输入过大或 AI 返回不可用时，先按用例数量拆小批次，再降级到单条生成。
- 降级过程继续复用同一页面地图，不重复采集页面。
- 导入项记录降级原因，用于预览页展示。
- 前端预览展示分组信息：同组 URL、页面地图、分组生成状态、降级提示。
- README 和代码地图补充页面地图缓存、分组生成和安全探索边界。

**测试范围：**
- 分组生成失败后会拆批；拆批失败后能单条生成。
- 单条失败不影响同组其他用例保存。
- 前端工具函数能展示分组、页面地图和降级提示。
- 导入保存逻辑不覆盖已有草稿。

**验收命令：**

```powershell
npm test -- tests/server/api-imports.test.ts tests/server/import-worker.test.ts tests/server/ai-case-draft.test.ts tests/web/ai-import.test.ts
npm run typecheck
npm run test
```

如当前分支存在与本功能无关的已知失败，最终 worker 必须记录失败测试名、失败原因和是否与本次改动相关；不能用“全量不方便跑”替代验证结论。

---

## 总体验收清单

- 测试人员可以使用新版两表模板导入用例。
- 动作类型、目标类型、匹配方式支持 `中文(英文)` 下拉值，保存到后端时使用英文枚举。
- 输入值和检查期望值直接来自步骤明细，不再依赖 `测试数据` 工作表。
- 同一环境、登录态、视口和目标 URL 的多条用例共用页面地图缓存。
- 页面地图支持查看、刷新、删除。
- 页面地图包含初始页面和受控探索后的多个状态。
- 导入采集阶段不会点击保存、提交、删除、审批、支付、发送等危险动作。
- AI 草稿生成能使用页面地图候选定位器，并能说明候选来自哪个状态。
- 同 URL 分组生成失败时有拆批和单条降级路径。
- 现有单条导入能力保留为兼容或降级能力。

## 推荐下发顺序

1. 先下发 Task 1.1，因为它稳定共享类型和 Excel 解析，是后续 prompt、页面地图分组和前端展示的输入基础。
2. Task 1.3 的模板文档可以在 Task 1.1 确认字段名后下发给独立文档 worker。
3. 阶段二开始前，主控 worker 先检查阶段一所有测试和类型检查是否通过。
4. 阶段三必须等待阶段二页面地图 API 和 store 稳定后再做。
5. 阶段四必须等待页面地图多状态结构稳定后再做，避免返工分组 AI 输入格式。
