# AI 自然语言用例导入第一阶段设计

## 目标

第一阶段为现有 Playwright 自动化测试平台增加 AI 辅助导入能力。测试人员通过标准 Excel 模板批量提交自然语言测试用例，平台读取模板、打开目标页面采集页面上下文，并调用可配置的大模型生成可编辑的草稿用例。

本阶段目标不是让 AI 自主测试，也不是让 AI 决定测试结果。AI 只负责把测试人员的自然语言步骤和预期结果转换为平台已有的结构化草稿步骤，后续仍由用户确认、基础检查、实测检查和运行中心完成确定性质量闭环。

## 已确认边界

- 第一阶段只支持 Excel 导入，不做 Word、Markdown 或自由文本导入。
- Excel 每条用例必须填写目标页面 URL，平台不会让 AI 自己从首页探索入口。
- AI 导入只生成草稿，不自动启用用例。
- 导入阶段不执行保存、提交、删除、审批等会修改业务数据的动作。
- 导入阶段不做“实测增强模式”，也不新增实测增强按钮。
- 后续动态反馈捕获、提示校准、实测结果修正草稿，应增强现有实测检查能力，不另建一套相似入口。
- 第一阶段会生成操作步骤和草稿性质的检查步骤，但检查步骤必须标记为 AI 生成草稿，需要用户确认或修改。
- Excel 面向测试人员，不出现 `断言`、`selector`、`locator`、`Playwright` 等实现术语。

## 总体流程

```text
上传 Excel
-> 创建持久化 AI 导入任务
-> 解析 Excel 三表
-> 后台逐条处理导入项
-> 用 Playwright 打开目标页面并采集页面上下文
-> 调用 Vercel AI SDK 生成结构化草稿步骤
-> 用 Zod 校验 AI 输出
-> 执行现有基础检查
-> 持久化导入项结果
-> 用户在导入预览页分批确认
-> 保存选中项为草稿用例
```

## 技术选型

### Excel 解析

使用 `multer` 接收上传文件，使用 `exceljs` 读取 `.xlsx`，使用项目已有 `zod` 校验模板内容。

不在第一阶段引入 Python/openpyxl，避免额外运行时和 Windows 部署复杂度。不优先使用 SheetJS，因为当前需求重点是读取固定模板并做行级对象化校验，`exceljs` 足够。

### AI 接入

使用 Vercel AI SDK，并通过 `@ai-sdk/openai-compatible` 接入 OpenAI 兼容协议。

项目内部必须封装自己的 AI 调用层，例如 `ai-client`，业务代码不直接依赖具体 SDK。未来如需替换为 OpenAI SDK、LiteLLM 网关或原生 `fetch`，只改适配层。

配置沿用根目录 `playwright-auto.config.json` 和环境变量覆盖规则：

```json
{
  "ai": {
    "enabled": true,
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "",
    "model": "deepseek-chat",
    "temperature": 0.1,
    "timeoutMs": 60000,
    "maxRetries": 1,
    "concurrency": 1
  }
}
```

环境变量建议：

```text
PLAYWRIGHT_AUTO_AI_BASE_URL
PLAYWRIGHT_AUTO_AI_API_KEY
PLAYWRIGHT_AUTO_AI_MODEL
PLAYWRIGHT_AUTO_AI_TEMPERATURE
PLAYWRIGHT_AUTO_AI_TIMEOUT_MS
PLAYWRIGHT_AUTO_AI_CONCURRENCY
```

默认每条导入项最多自动重试 1 次。仍失败时标记为生成失败，由用户手动重试。

### 页面上下文采集

平台通过 Playwright 程序化打开目标页面，采集压缩后的页面上下文。AI 不直接操作浏览器，不做自由探索。

页面上下文不传完整 HTML，只传可控摘要：

```ts
interface PageContext {
  page: {
    url: string;
    title: string;
    headings: string[];
  };
  elements: {
    buttons: PageElement[];
    inputs: PageElement[];
    selects: PageElement[];
    links: PageElement[];
    tables: TableElement[];
  };
  aria?: string;
  warnings: string[];
}

interface PageElement {
  text?: string;
  label?: string;
  placeholder?: string;
  locator: string;
  unique: boolean;
}

interface TableElement {
  headers: string[];
  nearbyText: string;
}
```

采集规则：

- 只采集可见元素。
- 文本去空白并限制长度。
- 每类元素设置数量上限。
- 优先保留与当前用例步骤、目标对象、预期结果文本相近的元素。
- 候选定位器需要现场校验唯一性。
- 优先生成语义定位，如按钮、标签、占位符、测试 ID、可见文本。
- CSS 只作为兜底，并降低置信度。
- 动态 UUID、过长层级、脆弱顺序定位应降低优先级并给出风险提示。

## Excel 导入模板要求

第一阶段采用三张工作表：

```text
用例清单
步骤明细
测试数据
```

### 用例清单

一行表示一个用例。

| 列名 | 是否必填 | 说明 |
|---|---|---|
| 用例编号 | 必填 | 同一 Excel 内唯一，例如 `TC001`。 |
| 用例名称 | 必填 | 用例标题，保存草稿时作为用例名称来源。 |
| 目标页面URL | 必填 | 用例起始页面，平台按该地址打开页面并采集上下文。 |
| 前置条件 | 可选 | 用自然语言说明登录态、已有数据、权限等前置要求。 |
| 预期结果 | 必填 | 用自然语言描述最终业务结果。AI 会据此生成草稿检查步骤。 |
| 备注 | 可选 | 额外说明，不参与强校验。 |

示例：

```text
用例编号 | 用例名称 | 目标页面URL | 前置条件 | 预期结果 | 备注
TC001 | 新增用户 | /user/list | 已登录管理员账号 | 信息提示添加成功，用户列表中显示新建用户 | 
```

### 步骤明细

一行表示一个操作步骤。测试人员按自然语言填写，不需要写技术动作类型。

| 列名 | 是否必填 | 说明 |
|---|---|---|
| 用例编号 | 必填 | 关联 `用例清单.用例编号`。 |
| 步骤序号 | 必填 | 同一用例内从 1 递增，用于确定执行顺序。 |
| 操作描述 | 必填 | 自然语言描述要做什么，例如“点击新增按钮，打开新增窗口”。 |
| 目标对象 | 可选 | 页面上的对象名称，例如“新增按钮”“用户名输入框”。 |
| 数据引用 | 可选 | 关联 `测试数据.数据标识`，多个引用用英文逗号分隔。 |
| 备注 | 可选 | 额外说明。 |

示例：

```text
用例编号 | 步骤序号 | 操作描述 | 目标对象 | 数据引用 | 备注
TC001 | 1 | 点击新增按钮，打开新增窗口 | 新增按钮 |  | 
TC001 | 2 | 输入用户名称 | 用户名称输入框 | username | 
TC001 | 3 | 输入手机号 | 手机号输入框 | phone | 
TC001 | 4 | 点击保存按钮 | 保存按钮 |  | 
```

填写规范：

- 如果点击后会打开弹窗、进入新页面或打开新窗口，应直接写在 `操作描述` 中。
- 如果步骤需要使用数据，必须填写 `数据引用`。
- 普通输入步骤不需要额外写“先点击输入框”，平台内部默认可生成输入动作。
- 日期、下拉、弹窗选择、人员选择、组织选择等复杂控件，尽量拆成多步自然语言描述。

### 测试数据

一行表示一个可引用的数据项。

| 列名 | 是否必填 | 说明 |
|---|---|---|
| 用例编号 | 必填 | 关联 `用例清单.用例编号`。 |
| 数据标识 | 必填 | 同一用例内唯一，例如 `username`。 |
| 数据名称 | 必填 | 给测试人员看的名称，例如“用户名称”。 |
| 数据值 | 必填 | 实际输入或校验使用的值。 |
| 说明 | 可选 | 数据用途说明。 |

示例：

```text
用例编号 | 数据标识 | 数据名称 | 数据值 | 说明
TC001 | username | 用户名称 | 测试用户001 | 输入用户名，并用于列表检查
TC001 | phone | 手机号 | 13800000001 | 输入手机号
```

数据引用规则：

```text
步骤明细.数据引用 = 测试数据.数据标识
```

如果步骤引用的数据不存在，该导入项进入不可保存状态，用户需要修正 Excel 或手动调整导入项。

## AI 生成内容

AI 输出结构化草稿，不输出 TypeScript 代码。

输出内容包括：

- 用例名称。
- 操作步骤草稿。
- 检查步骤草稿。
- 每个步骤的自然语言说明。
- 每个步骤的内部结构化类型。
- 选择器或定位草稿。
- 置信度。
- 风险提示。
- 缺失信息。

检查步骤来自 `用例清单.预期结果`，是 AI 生成的草稿，需要用户确认或修改。导入阶段不执行保存动作，因此 toast、alert、message、列表变化等动态结果可能无法验证，相关检查步骤应标记为待确认。

面向测试人员的展示文案使用“检查”，不使用“断言”。内部仍可映射为现有结构化步骤类型，如文本检查、可见检查、输入值检查、URL 检查、标题检查。

## 导入任务持久化

AI 导入必须是持久化异步任务，不能只保存在前端页面状态中。

建议存储结构：

```text
data/projects/<projectKey>/imports/<importId>/
  import.json
  source.xlsx
  items/
    <itemId>.json
```

`import.json` 保存任务摘要：

```ts
interface ImportJob {
  importId: string;
  fileName: string;
  fileHash: string;
  status: 'running' | 'pendingReview' | 'partialSaved' | 'completed' | 'failed';
  totalCount: number;
  generatedCount: number;
  savedCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  updatedAt: string;
}
```

导入项保存单条用例状态：

```ts
interface ImportItem {
  itemId: string;
  caseNo: string;
  caseName: string;
  rowRefs: {
    caseRow: number;
    stepRows: number[];
    dataRows: number[];
  };
  sourceHash: string;
  source: {
    caseInfo: unknown;
    steps: unknown[];
    data: unknown[];
  };
  draft?: unknown;
  review?: unknown;
  status: 'pending' | 'generating' | 'pendingReview' | 'failed' | 'saved' | 'skipped';
  errorMessage?: string;
  savedCaseKey?: string;
  savedAt?: string;
  retryCount: number;
}
```

刷新页面、关闭浏览器或隔天继续时，用户可以通过导入记录重新进入预览页。

## 异步后台执行

上传 Excel 后立即创建导入任务，后台逐条生成导入项。前端通过轮询获取进度。

第一阶段不引入 Redis 或 BullMQ，使用本地进程内队列加文件状态持久化。每条导入项处理完成后立即落盘，避免页面刷新或服务重启造成大量状态丢失。

默认 AI 并发数为 1，允许通过配置调到 2 或更高。并发配置应同时考虑页面采集和模型调用压力。

导入项状态：

```text
pending -> generating -> pendingReview
pending -> generating -> failed
pendingReview -> saved
pendingReview -> skipped
failed -> pending
```

失败处理：

- 每条导入项自动重试最多 1 次。
- 仍失败时标记为失败。
- 用户可以手动重试失败项。
- 失败项不阻断其他导入项继续生成。

## 导入预览页

导入预览页展示持久化任务，不直接保存临时前端状态。

总览表一行一个导入项：

```text
勾选 | 用例编号 | 用例名称 | 步骤数 | 检查步骤 | 置信度 | 状态 | 问题提示 | 操作
```

状态分组：

- 全部。
- 待确认。
- 已保存。
- 生成失败。
- 已跳过。
- 低置信。
- 有风险提示。

详情抽屉展示：

- Excel 原始用例信息。
- 原始步骤。
- 测试数据。
- AI 生成步骤。
- AI 生成检查步骤。
- 基础检查结果。
- 风险提示和缺失信息。
- 保存后的草稿用例链接。

批量操作：

- 保存选中为草稿。
- 跳过选中。
- 重试失败项。
- 导出问题清单。

保存选中为草稿后，对应导入项必须记录：

```text
status = saved
savedCaseKey = <caseKey>
savedAt = <ISO 时间>
```

已保存项再次进入导入预览时显示“已保存”，并提供跳转到草稿用例的入口。

## 重复上传处理

第一阶段做简单去重，不做复杂版本合并。

重复上传同一个文件时，根据文件 hash 识别已有导入任务：

- 如果文件 hash 完全相同，提示用户继续处理原导入任务。
- 如果用户仍要新建导入任务，需要明确选择“重新导入为新任务”。
- 已保存导入项不自动重复保存。

保存为草稿时不覆盖已有同编号或同来源用例。检测到冲突时，将导入项标记为需处理，并提示用户跳转查看已有用例。

后续阶段再考虑：

- 内容变更对比。
- 更新已有草稿。
- 从导入任务生成差异报告。
- 导入项版本管理。

## API 草案

第一阶段建议新增后端路由：

```text
POST /api/projects/:projectKey/imports/ai
GET /api/projects/:projectKey/imports
GET /api/projects/:projectKey/imports/:importId
GET /api/projects/:projectKey/imports/:importId/items
POST /api/projects/:projectKey/imports/:importId/items/:itemId/retry
POST /api/projects/:projectKey/imports/:importId/items/:itemId/skip
POST /api/projects/:projectKey/imports/:importId/save
```

保存接口接收导入项 ID 列表，只保存选中的待确认项。

## 数据安全与副作用

第一阶段导入只打开目标页面采集上下文，不执行保存、提交、删除、审批等业务动作。

平台可以打开目标页面并读取可见元素，但不能为了确认预期结果而点击提交类按钮。若某些页面打开本身就会产生业务副作用，该页面不适合第一阶段 AI 导入，需要用户调整目标页面或跳过该用例。

API Key 不应在前端暴露。前端只展示 AI 是否启用、当前模型名、导入任务状态，不展示密钥。

## 与现有能力关系

- AI 导入生成 `case.json` 草稿，不直接生成或手写 `case.spec.ts`。
- 草稿保存后复用现有用例编辑页、基础检查、保存生成测试文件、实测检查、运行中心。
- 后续动态反馈捕获应增强现有实测检查，不新增功能重复的实测增强入口。
- 选择器质量仍由现有基础检查兜底。

## 第一阶段不做

- 不做 AI 自主探索菜单。
- 不做 AI 自主执行测试。
- 不做 Word、Markdown、自由文本导入。
- 不做导入阶段提交业务数据。
- 不做实测增强按钮。
- 不做复杂导入版本合并。
- 不做覆盖已有草稿。
- 不做多用户权限隔离。
- 不做云端队列或分布式任务。

## 分阶段建议

### 阶段一：最小可用导入闭环

- AI 配置读取。
- Excel 三表解析。
- 持久化导入任务。
- 后台串行生成。
- 页面上下文采集。
- Vercel AI SDK 结构化草稿生成。
- 导入预览页。
- 保存选中项为草稿。

### 阶段二：可用性增强

- 失败项手动重试。
- 问题清单导出。
- 更细的低置信筛选。
- 页面上下文采集调优。
- 导入模板下载。

### 阶段三：实测检查增强

- 执行后动态反馈捕获。
- toast、alert、message、页面跳转、列表变化识别。
- 用实测结果辅助修正草稿。
- 检查步骤置信度回写。

## 验收标准

- 用户可以上传符合模板的 Excel。
- 平台创建持久化导入任务，并可在刷新页面后继续查看。
- 后台按导入项逐条生成草稿，失败不阻断其他项。
- 用户可以查看每条用例的原始内容、AI 生成步骤、检查步骤、风险提示和基础检查结果。
- 用户可以分批保存选中导入项为草稿用例。
- 已保存导入项不会重复保存，并能跳转到对应草稿用例。
- 重复上传相同文件时，平台能提示继续原任务。
- AI 配置可以通过配置文件和环境变量控制。
- 导入阶段不会执行会修改业务数据的动作。
