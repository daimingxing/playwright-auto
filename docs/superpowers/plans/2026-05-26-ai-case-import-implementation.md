# AI Case Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI 辅助 Excel 自然语言用例导入第一阶段：持久化异步导入任务、页面上下文采集、Vercel AI SDK 草稿生成、导入预览、分批保存草稿和 Excel 模板交付。

**Architecture:** 后端先实现稳定 API 合同和文件持久化导入任务；Excel 模板子任务可并行交付 `docs/ai-case-import/` 下的模板与说明；前端在后端 API 合同可用后实现导入记录和预览页。主智能体负责分发子任务、审核接口一致性、运行测试和集成验收。

**Tech Stack:** TypeScript、Express、Vue 3、Element Plus、Vitest、Supertest、Playwright、Vercel AI SDK、`@ai-sdk/openai-compatible`、`exceljs`、`multer`、Zod。

---

## 执行组织

三个子智能体分工如下：

| 子智能体 | 启动时机 | 范围 |
|---|---|---|
| 后端智能体 | 第一波启动 | 依赖安装、共享类型、AI 配置、Excel 解析、导入任务存储、后台队列、页面上下文、AI 草稿生成、导入 API、后端测试。 |
| Excel 模板智能体 | 第一波并行启动 | 使用 `@spreadsheets` 能力生成 `docs/ai-case-import/` 下的 Excel 模板、示例和填写说明。不得修改业务代码。 |
| 前端智能体 | 后端 API 合同稳定后启动 | 前端 API 封装、导入记录页、导入预览页、上传入口、轮询、详情抽屉、批量保存、前端测试。 |

主智能体验收顺序：

1. 后端 API 合同和测试通过。
2. Excel 模板字段与 spec 一致。
3. 前端基于后端 API 合同实现并通过测试。
4. 全量运行 `rtk npm run test`、`rtk npm run typecheck`、`rtk npm run build`。

## 文件结构

### 后端新增和修改

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `shared/types.ts`
- Modify: `playwright-auto.config.json`
- Modify: `README.md`
- Modify: `server/src/app.ts`
- Modify: `server/src/lib/app-config.ts`
- Modify: `server/src/lib/path.ts`
- Modify: `server/src/lib/guard.ts`
- Modify: `server/src/lib/schema.ts`
- Modify: `server/src/lib/case-store.ts`
- Create: `server/src/lib/import-store.ts`
- Create: `server/src/services/import-excel.ts`
- Create: `server/src/services/page-context.ts`
- Create: `server/src/services/ai-client.ts`
- Create: `server/src/services/ai-case-draft.ts`
- Create: `server/src/services/import-worker.ts`
- Create: `server/src/routes/imports.ts`
- Create: `tests/server/app-config-ai.test.ts`
- Create: `tests/server/import-excel.test.ts`
- Create: `tests/server/import-store.test.ts`
- Create: `tests/server/ai-case-draft.test.ts`
- Create: `tests/server/api-imports.test.ts`

### Excel 模板新增

- Create: `docs/ai-case-import/AI自然语言用例导入模板.xlsx`
- Create: `docs/ai-case-import/AI自然语言用例导入模板说明.md`

### 前端新增和修改

- Modify: `web/src/router/index.ts`
- Modify: `web/src/pages/ProjectDetail.vue`
- Create: `web/src/api/imports.ts`
- Create: `web/src/pages/AiImportList.vue`
- Create: `web/src/pages/AiImportPreview.vue`
- Create: `web/src/pages/ai-import.ts`
- Create: `tests/web/ai-import.test.ts`
- Create: `tests/web/ai-import-api.test.ts`

## 后端 API 合同

前后端以这些接口为稳定合同：

```text
POST /api/projects/:projectKey/imports/ai
GET /api/projects/:projectKey/imports
GET /api/projects/:projectKey/imports/:importId
GET /api/projects/:projectKey/imports/:importId/items
POST /api/projects/:projectKey/imports/:importId/items/:itemId/retry
POST /api/projects/:projectKey/imports/:importId/items/:itemId/skip
POST /api/projects/:projectKey/imports/:importId/save
```

上传接口使用 `multipart/form-data` 字段：

```text
file: Excel 文件
envKey: 可选，项目环境标识
```

保存接口请求体：

```json
{
  "itemIds": ["item-20260526-120000-0001"]
}
```

保存接口响应：

```json
{
  "saved": [
    {
      "itemId": "item-20260526-120000-0001",
      "caseKey": "case-20260526-120010-ab12"
    }
  ],
  "failed": [
    {
      "itemId": "item-20260526-120000-0002",
      "message": "草稿用例已存在"
    }
  ]
}
```

---

### Task 1: 依赖和共享类型

**Owner:** 后端智能体

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `shared/types.ts`
- Test: `tests/server/app-config-ai.test.ts`

- [ ] **Step 1: 安装依赖**

Run:

```powershell
rtk npm install ai @ai-sdk/openai-compatible exceljs multer
rtk npm install -D @types/multer
```

Expected: `package.json` 增加运行依赖和类型依赖，`package-lock.json` 更新。

- [ ] **Step 2: 扩展共享类型**

在 `shared/types.ts` 中增加 AI 配置、导入任务和导入项类型。类型命名使用常见英文，不超过 3 个单词：

```ts
export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
}

export type ImportStatus = 'running' | 'pendingReview' | 'partialSaved' | 'completed' | 'failed';
export type ImportItemStatus = 'pending' | 'generating' | 'pendingReview' | 'failed' | 'saved' | 'skipped';
export type AiLevel = 'high' | 'medium' | 'low';

export interface ImportJob {
  importId: string;
  fileName: string;
  fileHash: string;
  envKey: string;
  status: ImportStatus;
  totalCount: number;
  generatedCount: number;
  savedCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportStepSource {
  caseNo: string;
  stepNo: number;
  actionText: string;
  targetText: string;
  dataKeys: string[];
  note: string;
}

export interface ImportDataSource {
  caseNo: string;
  dataKey: string;
  dataName: string;
  dataValue: string;
  note: string;
}

export interface ImportCaseSource {
  caseNo: string;
  caseName: string;
  targetUrl: string;
  precondition: string;
  expectedResult: string;
  note: string;
}

export interface AiDraftStep {
  id: string;
  type: StepType;
  selector?: string;
  value?: string;
  timeout?: number;
  match?: MatchType;
  text: string;
  confidence: AiLevel;
  warnings: string[];
}

export interface AiCaseDraft {
  name: string;
  startPath: string;
  steps: AiDraftStep[];
  confidence: AiLevel;
  warnings: string[];
  missingInfo: string[];
}

export interface ImportItem {
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
    caseInfo: ImportCaseSource;
    steps: ImportStepSource[];
    data: ImportDataSource[];
  };
  draft?: AiCaseDraft;
  review?: CaseReview;
  status: ImportItemStatus;
  errorMessage?: string;
  savedCaseKey?: string;
  savedAt?: string;
  retryCount: number;
  updatedAt: string;
}

export interface ImportSaveResult {
  saved: Array<{ itemId: string; caseKey: string }>;
  failed: Array<{ itemId: string; message: string }>;
}
```

同时把 `FullAppConfig` 扩展为：

```ts
export interface FullAppConfig {
  server: ServerConfig;
  web: WebConfig;
  runner: RunConfig;
  steps: StepConfig;
  ai: AiConfig;
}
```

`PublicAppConfig` 不返回 `apiKey`：

```ts
export interface PublicAppConfig {
  steps: StepConfig;
  ai: Omit<AiConfig, 'apiKey'> & { configured: boolean };
}
```

- [ ] **Step 3: 写配置测试**

Create `tests/server/app-config-ai.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-ai-config-'));
  process.env.PLAYWRIGHT_AUTO_CONFIG = join(root, 'playwright-auto.config.json');
});

afterEach(async () => {
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  delete process.env.PLAYWRIGHT_AUTO_AI_BASE_URL;
  delete process.env.PLAYWRIGHT_AUTO_AI_API_KEY;
  delete process.env.PLAYWRIGHT_AUTO_AI_MODEL;
  delete process.env.PLAYWRIGHT_AUTO_AI_TEMPERATURE;
  delete process.env.PLAYWRIGHT_AUTO_AI_TIMEOUT_MS;
  delete process.env.PLAYWRIGHT_AUTO_AI_CONCURRENCY;
  await rm(root, { recursive: true, force: true });
});

describe('AI 配置', () => {
  it('默认关闭 AI 导入能力', async () => {
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().ai).toEqual({
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.1,
      timeoutMs: 60000,
      maxRetries: 1,
      concurrency: 1
    });
  });

  it('读取配置文件和环境变量中的 AI 配置', async () => {
    await writeConfig({
      ai: {
        enabled: true,
        baseUrl: 'http://local-model/v1',
        apiKey: 'file-key',
        model: 'file-model',
        temperature: 0.3,
        timeoutMs: 30000,
        maxRetries: 2,
        concurrency: 2
      }
    });
    process.env.PLAYWRIGHT_AUTO_AI_API_KEY = 'env-key';
    process.env.PLAYWRIGHT_AUTO_AI_MODEL = 'env-model';

    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().ai).toMatchObject({
      enabled: true,
      baseUrl: 'http://local-model/v1',
      apiKey: 'env-key',
      model: 'env-model',
      temperature: 0.3,
      timeoutMs: 30000,
      maxRetries: 2,
      concurrency: 2
    });
  });
});

async function writeConfig(value: unknown) {
  await mkdir(root, { recursive: true });
  await writeFile(process.env.PLAYWRIGHT_AUTO_CONFIG!, JSON.stringify(value), 'utf8');
}

async function importFreshConfig() {
  vi.resetModules();
  return import('../../server/src/lib/app-config');
}
```

- [ ] **Step 4: Run failing test**

Run:

```powershell
rtk npm test -- tests/server/app-config-ai.test.ts
```

Expected: FAIL because AI config is not implemented.

- [ ] **Step 5: Commit**

Commit after implementation in Task 2 passes:

```powershell
git add package.json package-lock.json shared/types.ts tests/server/app-config-ai.test.ts
git commit -m "feat: add ai import shared types"
```

---

### Task 2: AI 配置读取和路径守卫

**Owner:** 后端智能体

**Files:**
- Modify: `server/src/lib/app-config.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/lib/path.ts`
- Modify: `server/src/lib/guard.ts`
- Modify: `playwright-auto.config.json`
- Test: `tests/server/app-config-ai.test.ts`

- [ ] **Step 1: 扩展配置文件类型**

在 `server/src/lib/app-config.ts` 的 `FileConfig` 增加：

```ts
  ai?: {
    enabled?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
    temperature?: unknown;
    timeoutMs?: unknown;
    maxRetries?: unknown;
    concurrency?: unknown;
  };
```

`DEFAULT_CONFIG` 增加：

```ts
  ai: {
    enabled: false,
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.1,
    timeoutMs: 60000,
    maxRetries: 1,
    concurrency: 1
  }
```

- [ ] **Step 2: 增加 AI 配置读取函数**

在 `server/src/lib/app-config.ts` 增加函数级注释和实现：

```ts
/**
 * 读取 AI 导入配置。
 */
function readAiConfig(fileConfig: FileConfig) {
  return {
    enabled: readBool(undefined, fileConfig.ai?.enabled, DEFAULT_CONFIG.ai.enabled),
    baseUrl: readText(process.env.PLAYWRIGHT_AUTO_AI_BASE_URL, fileConfig.ai?.baseUrl, DEFAULT_CONFIG.ai.baseUrl),
    apiKey: readText(process.env.PLAYWRIGHT_AUTO_AI_API_KEY, fileConfig.ai?.apiKey, DEFAULT_CONFIG.ai.apiKey),
    model: readText(process.env.PLAYWRIGHT_AUTO_AI_MODEL, fileConfig.ai?.model, DEFAULT_CONFIG.ai.model),
    temperature: readFloat(process.env.PLAYWRIGHT_AUTO_AI_TEMPERATURE, fileConfig.ai?.temperature, DEFAULT_CONFIG.ai.temperature, 0, 2),
    timeoutMs: readInt(process.env.PLAYWRIGHT_AUTO_AI_TIMEOUT_MS, fileConfig.ai?.timeoutMs, DEFAULT_CONFIG.ai.timeoutMs, 1000, 300000),
    maxRetries: readInt(undefined, fileConfig.ai?.maxRetries, DEFAULT_CONFIG.ai.maxRetries, 0, 5),
    concurrency: readInt(process.env.PLAYWRIGHT_AUTO_AI_CONCURRENCY, fileConfig.ai?.concurrency, DEFAULT_CONFIG.ai.concurrency, 1, 5)
  };
}

/**
 * 读取布尔配置。
 */
function readBool(envValue: unknown, fileValue: unknown, defaultValue: boolean) {
  const envBool = parseBoolValue(envValue);

  if (envBool !== undefined) {
    return envBool;
  }

  const fileBool = parseBoolValue(fileValue);

  return fileBool ?? defaultValue;
}

/**
 * 读取小数配置。
 */
function readFloat(envValue: unknown, fileValue: unknown, defaultValue: number, min: number, max: number) {
  const envNumber = parseFloatValue(envValue);

  if (envNumber !== undefined && envNumber >= min && envNumber <= max) {
    return envNumber;
  }

  const fileNumber = parseFloatValue(fileValue);

  if (fileNumber !== undefined && fileNumber >= min && fileNumber <= max) {
    return fileNumber;
  }

  return defaultValue;
}

/**
 * 解析布尔配置值。
 */
function parseBoolValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') {
      return true;
    }
    if (text === 'false') {
      return false;
    }
  }

  return undefined;
}

/**
 * 解析小数配置值。
 */
function parseFloatValue(value: unknown) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isFinite(numberValue) ? numberValue : undefined;
}
```

`getAppConfig()` 返回对象增加：

```ts
    ai: readAiConfig(fileConfig)
```

- [ ] **Step 3: 修改公开配置接口**

在 `server/src/app.ts` 修改 `/api/app-config`：

```ts
  app.get('/api/app-config', (_req, res) => {
    const config = getAppConfig();

    res.json({
      steps: config.steps,
      ai: {
        enabled: config.ai.enabled,
        baseUrl: config.ai.baseUrl,
        model: config.ai.model,
        temperature: config.ai.temperature,
        timeoutMs: config.ai.timeoutMs,
        maxRetries: config.ai.maxRetries,
        concurrency: config.ai.concurrency,
        configured: Boolean(config.ai.baseUrl && config.ai.model)
      }
    });
  });
```

`apiKey` 不允许返回前端。

- [ ] **Step 4: 增加导入路径和守卫**

在 `server/src/lib/guard.ts` 增加：

```ts
/**
 * 校验导入任务标识。
 */
export function assertImportId(value: string) {
  if (!/^import-\d{8}-\d{6}-[a-f0-9]{4}$/.test(value)) {
    throw badRequest('导入任务标识不合法');
  }
}

/**
 * 校验导入项标识。
 */
export function assertImportItemId(value: string) {
  if (!/^item-\d{8}-\d{6}-[a-f0-9]{4}$/.test(value)) {
    throw badRequest('导入项标识不合法');
  }
}
```

在 `server/src/lib/path.ts` 增加：

```ts
import { assertImportId, assertImportItemId } from './guard';

/**
 * 获取项目导入任务根目录。
 */
export function getImportsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'imports');
}

/**
 * 获取单个导入任务目录。
 */
export function getImportPath(projectKey: string, importId: string) {
  assertImportId(importId);
  return resolve(getImportsPath(projectKey), importId);
}

/**
 * 获取单个导入项文件路径。
 */
export function getImportItemPath(projectKey: string, importId: string, itemId: string) {
  assertImportItemId(itemId);
  return resolve(getImportPath(projectKey, importId), 'items', `${itemId}.json`);
}
```

- [ ] **Step 5: 更新配置文件示例**

在 `playwright-auto.config.json` 加入 `ai` 默认配置，保持 `enabled: false`。

- [ ] **Step 6: Run test**

Run:

```powershell
rtk npm test -- tests/server/app-config-ai.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/src/lib/app-config.ts server/src/app.ts server/src/lib/path.ts server/src/lib/guard.ts playwright-auto.config.json tests/server/app-config-ai.test.ts shared/types.ts package.json package-lock.json
git commit -m "feat: add ai import config"
```

---

### Task 3: Excel 三表解析

**Owner:** 后端智能体

**Files:**
- Create: `server/src/services/import-excel.ts`
- Modify: `server/src/lib/schema.ts`
- Test: `tests/server/import-excel.test.ts`

- [ ] **Step 1: 写解析测试**

Create `tests/server/import-excel.test.ts`:

```ts
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImportExcel } from '../../server/src/services/import-excel';

describe('AI 导入 Excel 解析', () => {
  it('解析用例清单、步骤明细和测试数据', async () => {
    const buffer = await createWorkbookBuffer();
    const result = await parseImportExcel(buffer);

    expect(result).toHaveLength(1);
    expect(result[0].caseInfo).toMatchObject({
      caseNo: 'TC001',
      caseName: '新增用户',
      targetUrl: '/user/list',
      expectedResult: '信息提示添加成功'
    });
    expect(result[0].steps.map((step) => step.actionText)).toEqual(['点击新增按钮，打开新增窗口', '输入用户名称']);
    expect(result[0].data[0]).toMatchObject({
      dataKey: 'username',
      dataValue: '测试用户001'
    });
  });

  it('数据引用不存在时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ badDataKey: true });

    await expect(parseImportExcel(buffer)).rejects.toThrow('数据引用不存在');
  });
});

async function createWorkbookBuffer(options: { badDataKey?: boolean } = {}) {
  const workbook = new ExcelJS.Workbook();
  const cases = workbook.addWorksheet('用例清单');
  cases.addRow(['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注']);
  cases.addRow(['TC001', '新增用户', '/user/list', '已登录管理员账号', '信息提示添加成功', '']);

  const steps = workbook.addWorksheet('步骤明细');
  steps.addRow(['用例编号', '步骤序号', '操作描述', '目标对象', '数据引用', '备注']);
  steps.addRow(['TC001', 1, '点击新增按钮，打开新增窗口', '新增按钮', '', '']);
  steps.addRow(['TC001', 2, '输入用户名称', '用户名称输入框', options.badDataKey ? 'missing' : 'username', '']);

  const data = workbook.addWorksheet('测试数据');
  data.addRow(['用例编号', '数据标识', '数据名称', '数据值', '说明']);
  data.addRow(['TC001', 'username', '用户名称', '测试用户001', '输入用户名']);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
rtk npm test -- tests/server/import-excel.test.ts
```

Expected: FAIL because parser does not exist.

- [ ] **Step 3: 实现解析器**

Create `server/src/services/import-excel.ts`:

```ts
import ExcelJS from 'exceljs';
import type { ImportCaseSource, ImportDataSource, ImportStepSource } from '../../../shared/types';
import { badRequest } from '../lib/http-error';

export interface ParsedImportCase {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  rowRefs: {
    caseRow: number;
    stepRows: number[];
    dataRows: number[];
  };
}

/**
 * 解析 AI 用例导入 Excel。
 */
export async function parseImportExcel(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const caseRows = readCaseSheet(workbook);
  const stepRows = readStepSheet(workbook);
  const dataRows = readDataSheet(workbook);

  return joinImportRows(caseRows, stepRows, dataRows);
}

interface RowWithIndex<T> {
  rowIndex: number;
  value: T;
}

/**
 * 读取用例清单。
 */
function readCaseSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '用例清单');
  const rows: Array<RowWithIndex<ImportCaseSource>> = [];

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) {
      return;
    }

    const value = {
      caseNo: readCell(row, 1),
      caseName: readCell(row, 2),
      targetUrl: readCell(row, 3),
      precondition: readCell(row, 4),
      expectedResult: readCell(row, 5),
      note: readCell(row, 6)
    };

    if (!value.caseNo && !value.caseName) {
      return;
    }

    if (!value.caseNo || !value.caseName || !value.targetUrl || !value.expectedResult) {
      throw badRequest(`用例清单第 ${rowIndex} 行缺少必填字段`);
    }

    rows.push({ rowIndex, value });
  });

  return rows;
}

/**
 * 读取步骤明细。
 */
function readStepSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '步骤明细');
  const rows: Array<RowWithIndex<ImportStepSource>> = [];

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) {
      return;
    }

    const value = {
      caseNo: readCell(row, 1),
      stepNo: readIntCell(row, 2),
      actionText: readCell(row, 3),
      targetText: readCell(row, 4),
      dataKeys: readCell(row, 5).split(',').map((item) => item.trim()).filter(Boolean),
      note: readCell(row, 6)
    };

    if (!value.caseNo && !value.actionText) {
      return;
    }

    if (!value.caseNo || !value.stepNo || !value.actionText) {
      throw badRequest(`步骤明细第 ${rowIndex} 行缺少必填字段`);
    }

    rows.push({ rowIndex, value });
  });

  return rows;
}

/**
 * 读取测试数据。
 */
function readDataSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '测试数据');
  const rows: Array<RowWithIndex<ImportDataSource>> = [];

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) {
      return;
    }

    const value = {
      caseNo: readCell(row, 1),
      dataKey: readCell(row, 2),
      dataName: readCell(row, 3),
      dataValue: readCell(row, 4),
      note: readCell(row, 5)
    };

    if (!value.caseNo && !value.dataKey) {
      return;
    }

    if (!value.caseNo || !value.dataKey || !value.dataName || !value.dataValue) {
      throw badRequest(`测试数据第 ${rowIndex} 行缺少必填字段`);
    }

    rows.push({ rowIndex, value });
  });

  return rows;
}

/**
 * 组合三张表的行数据。
 */
function joinImportRows(
  cases: Array<RowWithIndex<ImportCaseSource>>,
  steps: Array<RowWithIndex<ImportStepSource>>,
  data: Array<RowWithIndex<ImportDataSource>>
): ParsedImportCase[] {
  const caseMap = new Map(cases.map((item) => [item.value.caseNo, item]));
  const stepMap = groupByCase(steps);
  const dataMap = groupByCase(data);

  for (const step of steps) {
    if (!caseMap.has(step.value.caseNo)) {
      throw badRequest(`步骤明细第 ${step.rowIndex} 行引用了不存在的用例编号：${step.value.caseNo}`);
    }
  }

  for (const dataRow of data) {
    if (!caseMap.has(dataRow.value.caseNo)) {
      throw badRequest(`测试数据第 ${dataRow.rowIndex} 行引用了不存在的用例编号：${dataRow.value.caseNo}`);
    }
  }

  return cases.map((item) => {
    const caseSteps = [...(stepMap.get(item.value.caseNo) ?? [])].sort((a, b) => a.value.stepNo - b.value.stepNo);
    const caseData = dataMap.get(item.value.caseNo) ?? [];
    const dataKeys = new Set(caseData.map((row) => row.value.dataKey));

    if (caseSteps.length === 0) {
      throw badRequest(`用例 ${item.value.caseNo} 缺少步骤明细`);
    }

    for (const step of caseSteps) {
      for (const dataKey of step.value.dataKeys) {
        if (!dataKeys.has(dataKey)) {
          throw badRequest(`用例 ${item.value.caseNo} 第 ${step.value.stepNo} 步数据引用不存在：${dataKey}`);
        }
      }
    }

    return {
      caseInfo: item.value,
      steps: caseSteps.map((row) => row.value),
      data: caseData.map((row) => row.value),
      rowRefs: {
        caseRow: item.rowIndex,
        stepRows: caseSteps.map((row) => row.rowIndex),
        dataRows: caseData.map((row) => row.rowIndex)
      }
    };
  });
}

/**
 * 按用例编号分组。
 */
function groupByCase<T extends { caseNo: string }>(rows: Array<RowWithIndex<T>>) {
  const map = new Map<string, Array<RowWithIndex<T>>>();

  for (const row of rows) {
    map.set(row.value.caseNo, [...(map.get(row.value.caseNo) ?? []), row]);
  }

  return map;
}

/**
 * 读取指定工作表。
 */
function getSheet(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);

  if (!sheet) {
    throw badRequest(`Excel 缺少工作表：${name}`);
  }

  return sheet;
}

/**
 * 读取文本单元格。
 */
function readCell(row: ExcelJS.Row, index: number) {
  const value = row.getCell(index).value;

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }

  return String(value).trim();
}

/**
 * 读取整数单元格。
 */
function readIntCell(row: ExcelJS.Row, index: number) {
  const text = readCell(row, index);
  const value = Number(text);

  return Number.isInteger(value) ? value : 0;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
rtk npm test -- tests/server/import-excel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/import-excel.ts tests/server/import-excel.test.ts
git commit -m "feat: parse ai import excel"
```

---

### Task 4: 导入任务存储

**Owner:** 后端智能体

**Files:**
- Create: `server/src/lib/import-store.ts`
- Modify: `server/src/lib/case-store.ts`
- Test: `tests/server/import-store.test.ts`

- [ ] **Step 1: 写存储测试**

Create `tests/server/import-store.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImportJob, getImportJob, listImportItems, listImportJobs, updateImportItem } from '../../server/src/lib/import-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-store-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入任务存储', () => {
  it('创建任务并读取导入项', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [
        {
          caseInfo: {
            caseNo: 'TC001',
            caseName: '新增用户',
            targetUrl: '/user/list',
            precondition: '',
            expectedResult: '添加成功',
            note: ''
          },
          steps: [],
          data: [],
          rowRefs: { caseRow: 2, stepRows: [], dataRows: [] }
        }
      ]
    });

    const jobs = await listImportJobs('crm');
    const detail = await getImportJob('crm', job.importId);
    const items = await listImportItems('crm', job.importId);

    expect(jobs).toHaveLength(1);
    expect(detail.totalCount).toBe(1);
    expect(items[0].caseNo).toBe('TC001');
  });

  it('更新导入项状态并同步任务摘要', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [
        {
          caseInfo: {
            caseNo: 'TC001',
            caseName: '新增用户',
            targetUrl: '/user/list',
            precondition: '',
            expectedResult: '添加成功',
            note: ''
          },
          steps: [],
          data: [],
          rowRefs: { caseRow: 2, stepRows: [], dataRows: [] }
        }
      ]
    });
    const item = (await listImportItems('crm', job.importId))[0];

    await updateImportItem('crm', job.importId, item.itemId, { status: 'pendingReview' });

    const detail = await getImportJob('crm', job.importId);
    expect(detail.generatedCount).toBe(1);
    expect(detail.status).toBe('pendingReview');
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
rtk npm test -- tests/server/import-store.test.ts
```

Expected: FAIL because store does not exist.

- [ ] **Step 3: 实现存储**

Create `server/src/lib/import-store.ts` with these exported functions:

```ts
export async function createImportJob(projectKey: string, input: CreateImportJobInput): Promise<ImportJob>
export async function listImportJobs(projectKey: string): Promise<ImportJob[]>
export async function getImportJob(projectKey: string, importId: string): Promise<ImportJob>
export async function listImportItems(projectKey: string, importId: string): Promise<ImportItem[]>
export async function getImportItem(projectKey: string, importId: string, itemId: string): Promise<ImportItem>
export async function updateImportItem(projectKey: string, importId: string, itemId: string, patch: Partial<ImportItem>): Promise<ImportItem>
export async function updateImportJobSummary(projectKey: string, importId: string): Promise<ImportJob>
export async function findImportByHash(projectKey: string, fileHash: string): Promise<ImportJob | undefined>
```

Implementation constraints:

- 使用 `writeJson` 原子写 JSON。
- `importId` 格式：`import-YYYYMMDD-HHMMSS-ffff`。
- `itemId` 格式：`item-YYYYMMDD-HHMMSS-ffff`。
- `sourceHash` 使用 Node `createHash('sha256')` 对单条原始用例 JSON 生成。
- `source.xlsx` 保存由路由传入，store 只负责任务 JSON 和 item JSON。
- `updateImportJobSummary` 根据 item 状态计算 `generatedCount`、`savedCount`、`failedCount`、`skippedCount` 和任务总状态。

Use helper code:

```ts
/**
 * 生成导入标识。
 */
function createImportId(prefix: 'import' | 'item') {
  const now = new Date();
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = randomBytes(2).toString('hex');

  return `${prefix}-${date}-${time}-${suffix}`;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
rtk npm test -- tests/server/import-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/lib/import-store.ts tests/server/import-store.test.ts server/src/lib/path.ts server/src/lib/guard.ts
git commit -m "feat: persist ai import jobs"
```

---

### Task 5: 页面上下文和 AI 草稿生成

**Owner:** 后端智能体

**Files:**
- Create: `server/src/services/page-context.ts`
- Create: `server/src/services/ai-client.ts`
- Create: `server/src/services/ai-case-draft.ts`
- Test: `tests/server/ai-case-draft.test.ts`

- [ ] **Step 1: 写 AI 草稿生成测试**

Create `tests/server/ai-case-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCaseDraftInput, normalizeAiDraft } from '../../server/src/services/ai-case-draft';

describe('AI 草稿生成服务', () => {
  it('构造包含模板、数据和页面上下文的模型输入', () => {
    const input = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC001',
        caseName: '新增用户',
        targetUrl: '/user/list',
        precondition: '已登录管理员账号',
        expectedResult: '添加成功',
        note: ''
      },
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionText: '点击新增按钮，打开新增窗口',
          targetText: '新增按钮',
          dataKeys: [],
          note: ''
        }
      ],
      data: [],
      pageContext: {
        page: { url: '/user/list', title: '用户管理', headings: ['用户管理'] },
        elements: {
          buttons: [{ text: '新增', locator: \"getByRole('button', { name: '新增' })\", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(input.user).toContain('TC001');
    expect(input.user).toContain('点击新增按钮');
    expect(input.user).toContain('用户管理');
  });

  it('归一化 AI 草稿为平台步骤', () => {
    const draft = normalizeAiDraft({
      name: '新增用户',
      startPath: '/user/list',
      confidence: 'high',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'click',
          selector: \"getByRole('button', { name: '新增' })\",
          text: '点击新增按钮',
          confidence: 'high',
          warnings: []
        }
      ]
    });

    expect(draft.steps[0]).toMatchObject({
      type: 'click',
      selector: \"getByRole('button', { name: '新增' })\"
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: 实现 `page-context.ts`**

`server/src/services/page-context.ts` exports:

```ts
export interface PageContextInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
}

export interface PageContext {
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
```

Function:

```ts
/**
 * 采集目标页面的压缩上下文。
 */
export async function collectPageContext(input: PageContextInput): Promise<PageContext>
```

Implementation rules:

- `NODE_ENV === 'test'` 时返回稳定 mock，避免测试打开真实浏览器。
- 非测试环境用 Playwright 打开页面。
- 复用 `getProject`、`buildStartUrl`、`getProjectAuthPath`、`hasProjectAuth`、`assertVendorBrowser`、`getVendorEnv`。
- 只采集可见元素，最大数量先限制为每类 80。
- 候选 locator 优先生成 `getByRole`、`getByLabel`、`getByPlaceholder`、`getByText`。

- [ ] **Step 4: 实现 `ai-client.ts`**

`server/src/services/ai-client.ts` exports:

```ts
export interface GenerateObjectInput<T> {
  schema: z.ZodType<T>;
  system: string;
  user: string;
}

/**
 * 调用配置的大模型生成结构化对象。
 */
export async function generateAiObject<T>(input: GenerateObjectInput<T>): Promise<T>
```

Implementation rules:

- 使用 `createOpenAICompatible` from `@ai-sdk/openai-compatible`。
- 使用 Vercel AI SDK 的结构化生成能力。
- 如果 `getAppConfig().ai.enabled` 为 false，抛出 `badRequest('AI 导入未启用')`。
- 如果缺少 `baseUrl` 或 `model`，抛出 `badRequest('AI 模型配置不完整')`。
- `apiKey` 允许为空，兼容本地模型。

- [ ] **Step 5: 实现 `ai-case-draft.ts`**

Exports:

```ts
export function buildCaseDraftInput(input: BuildDraftInput): { system: string; user: string }
export function normalizeAiDraft(value: AiCaseDraft): AiCaseDraft
export async function generateCaseDraft(input: GenerateDraftInput): Promise<AiCaseDraft>
```

System prompt rules:

```text
你是测试用例草稿生成助手。
你只能根据用户提供的 Excel 用例、测试数据和页面上下文生成平台支持的结构化步骤。
不要生成会绕过用户真实操作路径的步骤。
目标页面 URL 只作为起始打开页面。
点击菜单或链接应生成点击步骤，不要擅自改成 goto。
普通输入默认生成 fill，不需要额外点击输入框。
预期结果需要生成检查步骤，但检查步骤只是草稿，需要用户确认。
不要输出 TypeScript 代码。
```

Output schema:

```ts
const draftSchema = z.object({
  name: z.string().min(1).max(120),
  startPath: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  warnings: z.array(z.string()),
  missingInfo: z.array(z.string()),
  steps: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['goto', 'click', 'rightClick', 'doubleClick', 'hover', 'fill', 'select', 'wait', 'assertText', 'assertVisible', 'assertValue', 'assertUrl', 'assertTitle']),
    selector: z.string().optional(),
    value: z.string().optional(),
    timeout: z.number().int().min(0).max(600000).optional(),
    match: z.enum(['contains', 'equals', 'regex']).optional(),
    text: z.string().min(1),
    confidence: z.enum(['high', 'medium', 'low']),
    warnings: z.array(z.string())
  }))
});
```

- [ ] **Step 6: Run test**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/src/services/page-context.ts server/src/services/ai-client.ts server/src/services/ai-case-draft.ts tests/server/ai-case-draft.test.ts
git commit -m "feat: generate ai case drafts"
```

---

### Task 6: 导入后台任务和 API

**Owner:** 后端智能体

**Files:**
- Create: `server/src/services/import-worker.ts`
- Create: `server/src/routes/imports.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/lib/case-store.ts`
- Test: `tests/server/api-imports.test.ts`

- [ ] **Step 1: 为导入保存草稿补 store 函数**

Add to `server/src/lib/case-store.ts`:

```ts
export interface CreateCaseDraftInput {
  name: string;
  startPath: string;
  steps: CaseStep[];
}

/**
 * 直接创建带步骤的草稿用例。
 */
export async function createCaseDraft(projectKey: string, input: CreateCaseDraftInput) {
  const created = await createCase(projectKey, {
    name: input.name,
    startPath: input.startPath
  });

  return updateCaseDraft(projectKey, created.key, {
    ...created,
    steps: input.steps
  });
}
```

- [ ] **Step 2: 写 API 测试**

Create `tests/server/api-imports.test.ts`:

```ts
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-api-imports-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入接口', () => {
  it('上传 Excel 后创建持久化导入任务并可保存草稿', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');

    expect(created.status).toBe(201);
    expect(created.body.importId).toMatch(/^import-/);

    const items = await waitItems(app, created.body.importId);
    expect(items.body[0].status).toBe('pendingReview');

    const saved = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [items.body[0].itemId] });
    const cases = await request(app).get('/api/projects/crm/cases');

    expect(saved.status).toBe(200);
    expect(saved.body.saved).toHaveLength(1);
    expect(cases.body[0].status).toBe('draft');
  });
});

async function waitItems(app: ReturnType<typeof createApp>, importId: string) {
  for (let index = 0; index < 10; index += 1) {
    const items = await request(app).get(`/api/projects/crm/imports/${importId}/items`);
    if (items.body[0]?.status === 'pendingReview') {
      return items;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return request(app).get(`/api/projects/crm/imports/${importId}/items`);
}

async function createWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('用例清单').addRows([
    ['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注'],
    ['TC001', '新增用户', '/user/list', '已登录管理员账号', '添加成功', '']
  ]);
  workbook.addWorksheet('步骤明细').addRows([
    ['用例编号', '步骤序号', '操作描述', '目标对象', '数据引用', '备注'],
    ['TC001', 1, '点击新增按钮', '新增按钮', '', '']
  ]);
  workbook.addWorksheet('测试数据').addRows([
    ['用例编号', '数据标识', '数据名称', '数据值', '说明']
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 3: 实现后台 worker**

`server/src/services/import-worker.ts` exports:

```ts
export function enqueueImportJob(projectKey: string, importId: string): void
export async function processImportItem(projectKey: string, importId: string, itemId: string): Promise<void>
```

Implementation rules:

- 本地内存队列。
- 按 `getAppConfig().ai.concurrency` 控制并发。
- 测试环境下使用 deterministic draft，不调用真实模型。
- 每项处理流程：`pending -> generating -> pendingReview` 或 `failed`。
- 调用 `collectPageContext`、`generateCaseDraft`、`reviewCase`。
- 每处理完一项调用 `updateImportJobSummary`。

- [ ] **Step 4: 实现导入路由**

`server/src/routes/imports.ts`:

```ts
import multer from 'multer';
import { Router } from 'express';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseImportExcel } from '../services/import-excel';
import { createImportJob, findImportByHash, getImportJob, listImportItems, listImportJobs, updateImportItem } from '../lib/import-store';
import { getImportPath } from '../lib/path';
import { ensureDir } from '../lib/fs';
import { enqueueImportJob } from '../services/import-worker';
import { createCaseDraft } from '../lib/case-store';
import { badRequest } from '../lib/http-error';

export const importsRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
```

Required route behavior:

- `POST /ai`: reject missing file; compute file hash; if identical existing job exists return `200` with existing job and `reused: true`; otherwise create job, save `source.xlsx`, enqueue, return `201`.
- `GET /`: list jobs.
- `GET /:importId`: job detail.
- `GET /:importId/items`: list items.
- `POST /:importId/items/:itemId/retry`: failed item -> pending and enqueue.
- `POST /:importId/items/:itemId/skip`: pendingReview or failed -> skipped.
- `POST /:importId/save`: save selected pendingReview items using `createCaseDraft`; set item saved; do not overwrite existing saved items.

- [ ] **Step 5: Mount router**

In `server/src/app.ts`:

```ts
import { importsRouter } from './routes/imports';
...
  app.use('/api/projects/:projectKey/imports', importsRouter);
```

- [ ] **Step 6: Run tests**

Run:

```powershell
rtk npm test -- tests/server/api-imports.test.ts tests/server/import-store.test.ts tests/server/import-excel.test.ts tests/server/ai-case-draft.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/src/services/import-worker.ts server/src/routes/imports.ts server/src/app.ts server/src/lib/case-store.ts tests/server/api-imports.test.ts
git commit -m "feat: add ai import api"
```

---

### Task 7: Excel 模板交付

**Owner:** Excel 模板智能体，使用 `@spreadsheets`

**Files:**
- Create: `docs/ai-case-import/AI自然语言用例导入模板.xlsx`
- Create: `docs/ai-case-import/AI自然语言用例导入模板说明.md`

- [ ] **Step 1: 创建目录**

Run:

```powershell
rtk pwsh -NoProfile -Command "New-Item -ItemType Directory -Force 'docs/ai-case-import' | Out-Null"
```

- [ ] **Step 2: 生成 Excel 工作簿**

使用 `@spreadsheets` 创建 `docs/ai-case-import/AI自然语言用例导入模板.xlsx`。

Workbook must include exactly these sheets:

```text
用例清单
步骤明细
测试数据
填写说明
```

`用例清单` header:

```text
用例编号 | 用例名称 | 目标页面URL | 前置条件 | 预期结果 | 备注
```

`步骤明细` header:

```text
用例编号 | 步骤序号 | 操作描述 | 目标对象 | 数据引用 | 备注
```

`测试数据` header:

```text
用例编号 | 数据标识 | 数据名称 | 数据值 | 说明
```

Include two sample cases:

```text
TC001 新增用户
TC002 查询用户
```

Example rows must demonstrate:

- `目标页面URL` 必填。
- 点击后打开弹窗写进 `操作描述`。
- `数据引用` 对齐 `测试数据.数据标识`。
- `预期结果` 使用自然语言，不出现“断言”。

- [ ] **Step 3: 写说明文档**

Create `docs/ai-case-import/AI自然语言用例导入模板说明.md` with sections:

```markdown
# AI 自然语言用例导入模板说明

## 使用场景

## 工作表说明

## 用例清单填写规则

## 步骤明细填写规则

## 测试数据填写规则

## 常见示例

## 不推荐写法
```

Must include these rules:

- 每条用例必须有目标页面 URL。
- 操作过程写在步骤明细，不要写成一整段。
- 如果点击后打开弹窗、跳转页面、打开新窗口，要写在操作描述中。
- 预期结果只写业务预期，不写技术术语。
- 数据引用必须和测试数据中的数据标识一致。

- [ ] **Step 4: 验证文件存在**

Run:

```powershell
rtk pwsh -NoProfile -Command "Test-Path 'docs/ai-case-import/AI自然语言用例导入模板.xlsx'; Test-Path 'docs/ai-case-import/AI自然语言用例导入模板说明.md'"
```

Expected:

```text
True
True
```

- [ ] **Step 5: Commit**

```powershell
git add docs/ai-case-import/AI自然语言用例导入模板.xlsx docs/ai-case-import/AI自然语言用例导入模板说明.md
git commit -m "docs: add ai case import template"
```

---

### Task 8: 前端 API 封装和工具函数

**Owner:** 前端智能体

**Depends on:** Task 6 后端 API 合同稳定。

**Files:**
- Create: `web/src/api/imports.ts`
- Create: `web/src/pages/ai-import.ts`
- Test: `tests/web/ai-import.test.ts`
- Test: `tests/web/ai-import-api.test.ts`

- [ ] **Step 1: 写工具测试**

Create `tests/web/ai-import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatImportStatus, getImportProgress, canSaveImportItem } from '../../web/src/pages/ai-import';
import type { ImportItem, ImportJob } from '../../shared/types';

describe('AI 导入页面工具', () => {
  it('格式化导入任务进度', () => {
    expect(getImportProgress(makeJob({ totalCount: 10, generatedCount: 4 }))).toBe(40);
  });

  it('只允许保存待确认导入项', () => {
    expect(canSaveImportItem(makeItem('pendingReview'))).toBe(true);
    expect(canSaveImportItem(makeItem('saved'))).toBe(false);
  });

  it('显示任务状态中文', () => {
    expect(formatImportStatus('partialSaved')).toBe('部分保存');
  });
});

function makeJob(patch: Partial<ImportJob> = {}): ImportJob {
  return {
    importId: 'import-20260526-120000-ab12',
    fileName: 'cases.xlsx',
    fileHash: 'hash',
    envKey: 'default',
    status: 'running',
    totalCount: 1,
    generatedCount: 0,
    savedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...patch
  };
}

function makeItem(status: ImportItem['status']): ImportItem {
  return {
    itemId: 'item-20260526-120000-ab12',
    caseNo: 'TC001',
    caseName: '新增用户',
    rowRefs: { caseRow: 2, stepRows: [2], dataRows: [] },
    sourceHash: 'hash',
    source: {
      caseInfo: {
        caseNo: 'TC001',
        caseName: '新增用户',
        targetUrl: '/user/list',
        precondition: '',
        expectedResult: '添加成功',
        note: ''
      },
      steps: [],
      data: []
    },
    status,
    retryCount: 0,
    updatedAt: '2026-05-26T00:00:00.000Z'
  };
}
```

- [ ] **Step 2: 实现工具函数**

Create `web/src/pages/ai-import.ts`:

```ts
import type { ImportItem, ImportJob, ImportStatus } from '../../../shared/types';

/**
 * 计算导入任务生成进度。
 */
export function getImportProgress(job: ImportJob) {
  if (job.totalCount === 0) {
    return 0;
  }

  return Math.round((job.generatedCount / job.totalCount) * 100);
}

/**
 * 判断导入项是否可以保存为草稿。
 */
export function canSaveImportItem(item: ImportItem) {
  return item.status === 'pendingReview';
}

/**
 * 格式化导入任务状态。
 */
export function formatImportStatus(status: ImportStatus) {
  const map: Record<ImportStatus, string> = {
    running: '生成中',
    pendingReview: '待确认',
    partialSaved: '部分保存',
    completed: '已完成',
    failed: '失败'
  };

  return map[status];
}
```

- [ ] **Step 3: 写 API 封装**

Create `web/src/api/imports.ts`:

```ts
import type { ImportItem, ImportJob, ImportSaveResult } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 上传 Excel 并创建 AI 导入任务。
 */
export async function createAiImport(projectKey: string, file: File, envKey?: string) {
  const form = new FormData();
  form.append('file', file);
  if (envKey) {
    form.append('envKey', envKey);
  }

  return requestJson<ImportJob & { reused?: boolean }>(`/api/projects/${projectKey}/imports/ai`, {
    method: 'POST',
    body: form,
    headers: {}
  });
}

/**
 * 读取项目 AI 导入任务列表。
 */
export function listImports(projectKey: string) {
  return requestJson<ImportJob[]>(`/api/projects/${projectKey}/imports`);
}

/**
 * 读取单个 AI 导入任务。
 */
export function getImport(projectKey: string, importId: string) {
  return requestJson<ImportJob>(`/api/projects/${projectKey}/imports/${importId}`);
}

/**
 * 读取 AI 导入项列表。
 */
export function listImportItems(projectKey: string, importId: string) {
  return requestJson<ImportItem[]>(`/api/projects/${projectKey}/imports/${importId}/items`);
}

/**
 * 保存导入项为草稿。
 */
export function saveImportItems(projectKey: string, importId: string, itemIds: string[]) {
  return requestJson<ImportSaveResult>(`/api/projects/${projectKey}/imports/${importId}/save`, {
    method: 'POST',
    body: JSON.stringify({ itemIds })
  });
}
```

- [ ] **Step 4: 修正 `requestJson` 支持 FormData**

Modify `web/src/api/http.ts`:

```ts
/**
 * 发起 JSON 请求，并兼容文件上传场景。
 */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isFormData
      ? init?.headers
      : {
          'Content-Type': 'application/json',
          ...init?.headers
        }
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: '请求失败' }));
    throw new Error(data.message ?? '请求失败');
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
rtk npm test -- tests/web/ai-import.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/api/imports.ts web/src/api/http.ts web/src/pages/ai-import.ts tests/web/ai-import.test.ts
git commit -m "feat: add ai import web api"
```

---

### Task 9: 前端页面

**Owner:** 前端智能体

**Depends on:** Task 8.

**Files:**
- Modify: `web/src/router/index.ts`
- Modify: `web/src/pages/ProjectDetail.vue`
- Create: `web/src/pages/AiImportList.vue`
- Create: `web/src/pages/AiImportPreview.vue`
- Test: `tests/web/ai-import.test.ts`

- [ ] **Step 1: 增加路由**

Modify `web/src/router/index.ts`:

```ts
{ path: '/projects/:projectKey/imports', component: () => import('../pages/AiImportList.vue') },
{ path: '/projects/:projectKey/imports/:importId', component: () => import('../pages/AiImportPreview.vue') },
```

- [ ] **Step 2: 项目详情页增加入口**

Modify `web/src/pages/ProjectDetail.vue` actions area to add:

```vue
<el-button
  size="large"
  @click="router.push(`/projects/${projectKey}/imports`)"
>
  AI导入
</el-button>
```

- [ ] **Step 3: 实现导入记录页**

Create `web/src/pages/AiImportList.vue`:

Requirements:

- 顶部返回项目用例页。
- 上传 Excel 按钮。
- 表格展示文件名、总数、已保存、待确认、失败、状态、更新时间。
- 点击“继续处理”进入预览页。
- 上传成功后如果 `reused` 为 true，提示“检测到已有导入任务，已打开原任务”。

Use Element Plus components:

```vue
<el-upload :auto-upload="false" accept=".xlsx" />
<el-table />
<el-progress />
```

- [ ] **Step 4: 实现导入预览页**

Create `web/src/pages/AiImportPreview.vue`:

Requirements:

- 每 2 秒轮询任务和导入项，任务不再 running 后停止轮询。
- 表格展示：选择、用例编号、用例名称、步骤数、检查步骤摘要、置信度、状态、问题提示、操作。
- 支持筛选：全部、待确认、已保存、生成失败、已跳过、低置信、有风险。
- 支持批量保存选中为草稿。
- 支持详情抽屉展示原始 Excel 内容、AI 生成步骤、检查步骤、基础检查结果、风险提示。
- 已保存项显示草稿用例链接。

- [ ] **Step 5: Run front tests**

Run:

```powershell
rtk npm test -- tests/web/ai-import.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/router/index.ts web/src/pages/ProjectDetail.vue web/src/pages/AiImportList.vue web/src/pages/AiImportPreview.vue tests/web/ai-import.test.ts
git commit -m "feat: add ai import pages"
```

---

### Task 10: 文档和最终验证

**Owner:** 主智能体

**Files:**
- Modify: `README.md`
- Verify: all changed files

- [ ] **Step 1: 更新 README**

Add sections:

```markdown
## AI 自然语言用例导入

本功能支持从 Excel 模板批量导入自然语言用例，生成可编辑草稿。

模板位置：`docs/ai-case-import/AI自然语言用例导入模板.xlsx`

第一阶段导入只生成草稿，不自动启用用例，不执行保存、提交、删除、审批等会修改业务数据的动作。
```

Add config snippet:

```json
"ai": {
  "enabled": false,
  "baseUrl": "",
  "apiKey": "",
  "model": "",
  "temperature": 0.1,
  "timeoutMs": 60000,
  "maxRetries": 1,
  "concurrency": 1
}
```

- [ ] **Step 2: Run targeted tests**

Run:

```powershell
rtk npm test -- tests/server/app-config-ai.test.ts tests/server/import-excel.test.ts tests/server/import-store.test.ts tests/server/ai-case-draft.test.ts tests/server/api-imports.test.ts tests/web/ai-import.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full checks**

Run:

```powershell
rtk npm run test
rtk npm run typecheck
rtk npm run build
```

Expected: all PASS.

- [ ] **Step 4: Manual smoke test**

If project server is already running, do not start a duplicate server. If not running and user approves execution phase, start:

```powershell
rtk npm run dev
```

Manual flow:

1. Open `http://localhost:5173`.
2. Enter project detail page.
3. Click `AI导入`.
4. Upload `docs/ai-case-import/AI自然语言用例导入模板.xlsx`.
5. Confirm import task appears.
6. Wait until generated items show.
7. Open one detail drawer.
8. Save one pending item as draft.
9. Jump to saved draft case.
10. Confirm case steps appear and status is draft.

- [ ] **Step 5: Commit**

```powershell
git add README.md
git commit -m "docs: document ai case import"
```

---

## Self-Review Checklist

- Spec coverage:
  - Excel 三表模板：Task 3、Task 7。
  - AI 配置和 Vercel AI SDK：Task 1、Task 2、Task 5。
  - 页面上下文采集：Task 5。
  - 持久化导入任务：Task 4。
  - 异步后台执行：Task 6。
  - 导入预览和分批保存：Task 8、Task 9。
  - Excel 模板放在 `docs/`：Task 7。
  - 前端等后端 API：Task 8、Task 9 depend on Task 6。
- Placeholder scan:
  - 已扫描计划失败用语，任务正文未出现未填内容标记。
  - 后续增强被明确放在 spec 的阶段三，不属于本实施计划必须完成项。
- Type consistency:
  - 后端、前端、测试均使用 `ImportJob`、`ImportItem`、`AiCaseDraft`、`AiConfig`。
  - 状态枚举与 spec 保持一致。
