# 录制操作生成用例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用例编辑页提供“开始录制 / 停止录制”能力，复用 Playwright codegen 有头浏览器录制操作和基础断言，停止后覆盖当前用例步骤并重新生成 `case.spec.ts`。

**Architecture:** 后端新增录制会话服务，负责启动 `npx playwright codegen` 子进程、生成临时 spec、停止进程并解析 spec 为平台 `CaseStep[]`。前端只承担开始、停止、状态展示和覆盖提示，第一阶段不重构成完整低代码断言编辑器。录制导入结果以 `case.json` 为真实数据源，继续由现有 `case-generator.ts` 输出可迁移 Playwright 测试文件。

**Tech Stack:** Vue 3、Element Plus、Express、TypeScript、Playwright codegen、Vitest、Supertest、Node child_process、TypeScript Compiler API。

---

## 文件结构

- Modify: `shared/types.ts`
  - 扩展 `StepType`，补充 `assertValue` 和可选 `match` 字段。
- Modify: `server/src/services/case-generator.ts`
  - 生成 `assertValue`，并让文本断言支持默认 `contains`、可选 `equals`、`regex`。
- Create: `server/src/services/codegen-parser.ts`
  - 解析 Playwright codegen 输出的 `case.spec.ts`，转换为平台步骤。
- Create: `server/src/services/record-session.ts`
  - 管理录制会话生命周期，启动 codegen、停止 codegen、导入并覆盖当前用例。
- Create: `server/src/routes/record.ts`
  - 提供 `/api/projects/:projectKey/cases/:caseKey/record/start` 和 `/stop`。
- Modify: `server/src/app.ts`
  - 注册录制路由。
- Modify: `web/src/api/cases.ts`
  - 增加开始录制、停止录制 API。
- Modify: `web/src/pages/CaseEditor.vue`
  - 增加开始录制、停止录制按钮、录制状态、覆盖提示。
- Create: `tests/server/codegen-parser.test.ts`
  - 验证 codegen 脚本到 `CaseStep[]` 的转换规则。
- Create: `tests/server/record-session.test.ts`
  - 在 `NODE_ENV=test` 下验证录制接口不启动真实浏览器，但能覆盖步骤。
- Modify: `tests/server/case-generator.test.ts`
  - 增加 `assertValue` 和 `match` 生成验证。
- Modify: `tests/server/api-cases.test.ts`
  - 增加录制接口的 API 层验证。

---

### Task 1: 扩展步骤模型和测试生成器

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/src/services/case-generator.ts`
- Modify: `tests/server/case-generator.test.ts`

- [ ] **Step 1: 先写生成器失败测试**

在 `tests/server/case-generator.test.ts` 增加一个用例，覆盖 `assertValue` 和文本精确匹配。

```ts
it('生成输入框值断言和精确文本断言', () => {
  const item: CaseMeta = {
    name: '检查编辑结果',
    key: 'case-assert',
    startPath: '/profile',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    steps: [
      { id: 's1', type: 'assertValue', selector: '#nickname', value: '张三' },
      { id: 's2', type: 'assertText', selector: '.title', value: '个人资料', match: 'equals' }
    ]
  };

  const code = generateSpec(item);

  expect(code).toContain("await expect(page.locator('#nickname')).toHaveValue('张三');");
  expect(code).toContain("await expect(page.locator('.title')).toHaveText('个人资料');");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
rtk npm run test -- tests/server/case-generator.test.ts
```

Expected: FAIL，错误包含 `assertValue` 类型不兼容或生成结果不包含 `toHaveValue`。

- [ ] **Step 3: 扩展共享类型**

在 `shared/types.ts` 中调整类型。

```ts
export type StepType =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'wait'
  | 'assertText'
  | 'assertVisible'
  | 'assertValue'
  | 'assertUrl'
  | 'assertTitle';

export type MatchType = 'contains' | 'equals' | 'regex';

export interface CaseStep {
  id: string;
  type: StepType;
  selector?: string;
  value?: string;
  timeout?: number;
  match?: MatchType;
}
```

- [ ] **Step 4: 扩展测试文件生成逻辑**

在 `server/src/services/case-generator.ts` 的 `renderStep` 中补充分支。

```ts
case 'assertText':
  return renderTextAssert(step);
case 'assertValue':
  return `  await expect(page.locator(${quote(requireText(step.selector, '输入值断言选择器'))})).toHaveValue(${quote(step.value ?? '')});`;
```

新增函数级注释和实现。

```ts
/**
 * 生成文本断言代码。
 */
function renderTextAssert(step: CaseStep) {
  const selector = quote(requireText(step.selector, '文本断言选择器'));
  const value = step.value ?? '';

  if (step.match === 'equals') {
    return `  await expect(page.locator(${selector})).toHaveText(${quote(value)});`;
  }

  if (step.match === 'regex') {
    return `  await expect(page.locator(${selector})).toContainText(new RegExp(${quote(value)}));`;
  }

  return `  await expect(page.locator(${selector})).toContainText(${quote(value)});`;
}
```

- [ ] **Step 5: 运行生成器测试**

Run:

```bash
rtk npm run test -- tests/server/case-generator.test.ts
```

Expected: PASS。

---

### Task 2: 实现 codegen 输出解析器

**Files:**
- Create: `server/src/services/codegen-parser.ts`
- Create: `tests/server/codegen-parser.test.ts`

- [ ] **Step 1: 写解析器失败测试**

创建 `tests/server/codegen-parser.test.ts`，覆盖第一阶段支持的 Playwright 语句。

```ts
import { describe, expect, it } from 'vitest';
import { parseCodegenSpec } from '../../server/src/services/codegen-parser';

describe('codegen 脚本解析器', () => {
  it('把 Playwright codegen 输出转换为平台步骤', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://example.test/orders');
  await page.getByRole('textbox', { name: '名称' }).fill('测试订单');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存成功')).toBeVisible();
  await expect(page.getByLabel('名称')).toHaveValue('测试订单');
  await expect(page).toHaveURL(/.*orders/);
  await expect(page).toHaveTitle(/订单/);
});
`;

    const result = parseCodegenSpec(code);

    expect(result.steps).toMatchObject([
      { type: 'goto', value: 'https://example.test/orders' },
      { type: 'fill', selector: "getByRole('textbox', { name: '名称' })", value: '测试订单' },
      { type: 'click', selector: "getByRole('button', { name: '保存' })" },
      { type: 'assertVisible', selector: "getByText('保存成功')" },
      { type: 'assertValue', selector: "getByLabel('名称')", value: '测试订单' },
      { type: 'assertUrl', value: '/.*orders/' },
      { type: 'assertTitle', value: '/订单/' }
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
rtk npm run test -- tests/server/codegen-parser.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 创建解析器公开接口**

在 `server/src/services/codegen-parser.ts` 中创建接口。使用 TypeScript Compiler API 解析 AST，避免用脆弱的整段正则匹配。

```ts
import ts from 'typescript';
import type { CaseStep } from '../../../shared/types';

export interface ParseResult {
  steps: CaseStep[];
}

/**
 * 解析 Playwright codegen 生成的测试脚本。
 */
export function parseCodegenSpec(code: string): ParseResult {
  const source = ts.createSourceFile('record.spec.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const steps: CaseStep[] = [];

  walk(source, (node) => {
    const step = parseAwaitStep(node);
    if (step) {
      steps.push({
        ...step,
        id: crypto.randomUUID()
      });
    }
  });

  return { steps };
}
```

- [ ] **Step 4: 支持动作语句解析**

实现 `goto`、`click`、`fill`、`selectOption`。选择器保存为 Playwright locator 表达式文本，例如 `getByRole(...)`、`locator(...)`，这样第一阶段不需要把所有 locator 降级成 CSS。

```ts
/**
 * 解析单条 await 语句。
 */
function parseAwaitStep(node: ts.Node): Omit<CaseStep, 'id'> | null {
  if (!ts.isExpressionStatement(node) || !ts.isAwaitExpression(node.expression)) {
    return null;
  }

  const call = unwrapCall(node.expression.expression);
  if (!call || !ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const method = call.expression.name.text;
  const target = call.expression.expression;

  if (method === 'goto') {
    return { type: 'goto', value: readTextArg(call, 0) ?? '/' };
  }

  if (method === 'click') {
    return { type: 'click', selector: readSelector(target) };
  }

  if (method === 'fill') {
    return { type: 'fill', selector: readSelector(target), value: readTextArg(call, 0) ?? '' };
  }

  if (method === 'selectOption') {
    return { type: 'select', selector: readSelector(target), value: readTextArg(call, 0) ?? '' };
  }

  return parseExpectStep(call);
}
```

- [ ] **Step 5: 支持基础断言解析**

实现 `toBeVisible`、`toContainText`、`toHaveText`、`toHaveValue`、`toHaveURL`、`toHaveTitle`。

```ts
/**
 * 解析 expect 断言语句。
 */
function parseExpectStep(call: ts.CallExpression): Omit<CaseStep, 'id'> | null {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const matcher = call.expression.name.text;
  const expectCall = unwrapCall(call.expression.expression);

  if (!expectCall || !isExpectCall(expectCall)) {
    return null;
  }

  const target = expectCall.arguments[0];

  if (matcher === 'toBeVisible') {
    return { type: 'assertVisible', selector: readSelector(target) };
  }

  if (matcher === 'toContainText') {
    return { type: 'assertText', selector: readSelector(target), value: readTextArg(call, 0) ?? '', match: 'contains' };
  }

  if (matcher === 'toHaveText') {
    return { type: 'assertText', selector: readSelector(target), value: readTextArg(call, 0) ?? '', match: 'equals' };
  }

  if (matcher === 'toHaveValue') {
    return { type: 'assertValue', selector: readSelector(target), value: readTextArg(call, 0) ?? '' };
  }

  if (matcher === 'toHaveURL') {
    return { type: 'assertUrl', value: readExpectValue(call) };
  }

  if (matcher === 'toHaveTitle') {
    return { type: 'assertTitle', value: readExpectValue(call) };
  }

  return null;
}
```

- [ ] **Step 6: 运行解析器测试**

Run:

```bash
rtk npm run test -- tests/server/codegen-parser.test.ts
```

Expected: PASS。

---

### Task 3: 让生成器支持 Playwright locator 表达式

**Files:**
- Modify: `server/src/services/case-generator.ts`
- Modify: `tests/server/case-generator.test.ts`

- [ ] **Step 1: 写 locator 表达式生成测试**

codegen 常生成 `page.getByRole(...)` 这类语句，平台步骤里保存的是去掉 `page.` 的表达式。生成器需要识别表达式和普通 CSS。

```ts
it('生成 codegen locator 表达式步骤', () => {
  const item: CaseMeta = {
    name: '保存订单',
    key: 'case-locator',
    startPath: '/orders',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    steps: [
      { id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" },
      { id: 's2', type: 'assertVisible', selector: "getByText('保存成功')" }
    ]
  };

  const code = generateSpec(item);

  expect(code).toContain("await page.getByRole('button', { name: '保存' }).click();");
  expect(code).toContain("await expect(page.getByText('保存成功')).toBeVisible();");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
rtk npm run test -- tests/server/case-generator.test.ts
```

Expected: FAIL，当前会生成 `page.locator('getByRole(...)')`。

- [ ] **Step 3: 增加 locator 渲染函数**

在 `server/src/services/case-generator.ts` 中新增函数级注释和实现。

```ts
/**
 * 生成 Playwright locator 表达式。
 */
function renderLocator(selector: string | undefined, name: string) {
  const value = requireText(selector, name);

  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `page.${value}`;
  }

  return `page.locator(${quote(value)})`;
}
```

然后把点击、输入、选择和 DOM 断言中的 `page.locator(...)` 改为 `renderLocator(...)`。

- [ ] **Step 4: 运行生成器测试**

Run:

```bash
rtk npm run test -- tests/server/case-generator.test.ts
```

Expected: PASS。

---

### Task 4: 实现录制会话服务

**Files:**
- Create: `server/src/services/record-session.ts`
- Create: `tests/server/record-session.test.ts`

- [ ] **Step 1: 写服务层失败测试**

在 `tests/server/record-session.test.ts` 中测试 `NODE_ENV=test` 的假录制流程。假录制不启动真实 codegen，只写一份模拟 spec，然后停止导入。

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCase, getCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { startRecordSession, stopRecordSession } from '../../server/src/services/record-session';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-record-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('录制会话服务', () => {
  it('停止录制后覆盖当前用例步骤', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders' });

    const session = await startRecordSession('crm', item.key);
    const updated = await stopRecordSession('crm', item.key, session.sessionId);
    const saved = await getCase('crm', item.key);

    expect(updated.steps.length).toBeGreaterThan(0);
    expect(saved.steps).toEqual(updated.steps);
    expect(saved.steps.some((step) => step.type === 'assertVisible')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
rtk npm run test -- tests/server/record-session.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现会话数据结构**

`record-session.ts` 使用内存 `Map` 管理会话。第一阶段服务重启后会话丢失是可接受限制。

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseMeta } from '../../../shared/types';
import { getCase, updateCase } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { getBrowserPath } from './browser-path';
import { parseCodegenSpec } from './codegen-parser';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';

interface RecordSession {
  projectKey: string;
  caseKey: string;
  outputPath: string;
  child?: ChildProcess;
  createdAt: string;
}

const sessions = new Map<string, RecordSession>();
```

- [ ] **Step 4: 实现开始录制**

非测试环境启动 `npx playwright codegen`，参数固定使用 `--target playwright-test` 和 `--output <临时文件>`。如果项目已有登录态，通过 `--load-storage` 复用。

```ts
/**
 * 启动 Playwright codegen 录制会话。
 */
export async function startRecordSession(projectKey: string, caseKey: string) {
  const project = await getProject(projectKey);
  const item = await getCase(projectKey, caseKey);
  const envMeta = project.envs.find((env) => env.key === project.defaultEnv);

  if (!envMeta) {
    throw new Error('录制环境不存在');
  }

  const sessionId = crypto.randomUUID();
  const dir = await mkdtemp(join(tmpdir(), 'playwright-auto-codegen-'));
  const outputPath = join(dir, 'record.spec.ts');
  const startUrl = new URL(item.startPath, envMeta.baseUrl).toString();

  if (process.env.NODE_ENV === 'test') {
    await writeFile(outputPath, createTestSpec(startUrl), 'utf8');
    sessions.set(sessionId, { projectKey, caseKey, outputPath, createdAt: new Date().toISOString() });
    return { sessionId, url: startUrl };
  }

  await assertVendorBrowser();

  const args = [
    'playwright',
    'codegen',
    '--target',
    'playwright-test',
    '--output',
    outputPath,
    '--browser',
    'chromium',
    startUrl
  ];

  if (await hasProjectAuth(projectKey)) {
    args.splice(args.length - 1, 0, '--load-storage', getProjectAuthPath(projectKey));
  }

  const child = spawn('npx', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...getVendorEnv(),
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: getBrowserPath()
    },
    shell: true,
    stdio: 'ignore'
  });

  sessions.set(sessionId, {
    projectKey,
    caseKey,
    outputPath,
    child,
    createdAt: new Date().toISOString()
  });

  return { sessionId, url: startUrl };
}
```

- [ ] **Step 5: 实现停止录制并覆盖用例**

停止时先结束 codegen 子进程，再读取输出文件，解析为步骤，覆盖当前用例。

```ts
/**
 * 停止录制并把录制步骤覆盖到当前用例。
 */
export async function stopRecordSession(projectKey: string, caseKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey || session.caseKey !== caseKey) {
    throw new Error('录制会话不存在或已结束');
  }

  if (session.child && !session.child.killed) {
    session.child.kill();
  }

  const item = await getCase(projectKey, caseKey);
  const code = await readFile(session.outputPath, 'utf8');
  const result = parseCodegenSpec(code);
  const nextItem: CaseMeta = {
    ...item,
    steps: result.steps
  };

  sessions.delete(sessionId);

  return updateCase(projectKey, caseKey, nextItem);
}
```

- [ ] **Step 6: 运行服务层测试**

Run:

```bash
rtk npm run test -- tests/server/record-session.test.ts
```

Expected: PASS。

---

### Task 5: 增加录制 API

**Files:**
- Create: `server/src/routes/record.ts`
- Modify: `server/src/app.ts`
- Modify: `tests/server/api-cases.test.ts`

- [ ] **Step 1: 写 API 失败测试**

在 `tests/server/api-cases.test.ts` 增加用例，验证开始录制返回 `sessionId`，停止录制返回被覆盖的用例。

```ts
it('通过接口开始和停止录制并覆盖用例步骤', async () => {
  process.env.NODE_ENV = 'test';
  const app = createApp();
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  const created = await request(app).post('/api/projects/crm/cases').send({
    name: '创建订单',
    startPath: '/orders/create'
  });

  const started = await request(app).post(`/api/projects/crm/cases/${created.body.key}/record/start`).send();
  expect(started.status).toBe(201);
  expect(started.body.sessionId).toEqual(expect.any(String));

  const stopped = await request(app)
    .post(`/api/projects/crm/cases/${created.body.key}/record/stop`)
    .send({ sessionId: started.body.sessionId });

  expect(stopped.status).toBe(200);
  expect(stopped.body.steps.length).toBeGreaterThan(0);
  delete process.env.NODE_ENV;
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
rtk npm run test -- tests/server/api-cases.test.ts
```

Expected: FAIL，路由不存在。

- [ ] **Step 3: 创建录制路由**

在 `server/src/routes/record.ts` 新增路由。

```ts
import { Router } from 'express';
import { startRecordSession, stopRecordSession } from '../services/record-session';

interface RecordParams {
  projectKey: string;
  caseKey: string;
}

export const recordRouter = Router({ mergeParams: true });

recordRouter.post<RecordParams>('/start', async (req, res, next) => {
  try {
    res.status(201).json(await startRecordSession(req.params.projectKey, req.params.caseKey));
  } catch (error) {
    next(error);
  }
});

recordRouter.post<RecordParams>('/stop', async (req, res, next) => {
  try {
    res.json(await stopRecordSession(req.params.projectKey, req.params.caseKey, req.body.sessionId));
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: 注册录制路由**

在 `server/src/app.ts` 中引入并注册。

```ts
import { recordRouter } from './routes/record';
```

```ts
app.use('/api/projects/:projectKey/cases/:caseKey/record', recordRouter);
```

- [ ] **Step 5: 运行 API 测试**

Run:

```bash
rtk npm run test -- tests/server/api-cases.test.ts
```

Expected: PASS。

---

### Task 6: 前端接入录制按钮和状态

**Files:**
- Modify: `web/src/api/cases.ts`
- Modify: `web/src/pages/CaseEditor.vue`

- [ ] **Step 1: 增加前端 API 方法**

在 `web/src/api/cases.ts` 中增加类型和方法。

```ts
export interface RecordSessionResult {
  sessionId: string;
  url: string;
}

/**
 * 开始录制当前测试用例。
 */
export function startRecord(projectKey: string, caseKey: string) {
  return requestJson<RecordSessionResult>(`/api/projects/${projectKey}/cases/${caseKey}/record/start`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

/**
 * 停止录制并导入当前测试用例。
 */
export function stopRecord(projectKey: string, caseKey: string, sessionId: string) {
  return requestJson<CaseMeta>(`/api/projects/${projectKey}/cases/${caseKey}/record/stop`, {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}
```

- [ ] **Step 2: 增加编辑页状态**

在 `web/src/pages/CaseEditor.vue` 中引入 `ElMessage`、`ElMessageBox`、`getErrorMessage`，并增加录制状态。

```ts
import { ElMessage, ElMessageBox } from 'element-plus';
import { getErrorMessage } from '../utils/error';
import { getCase, startRecord, stopRecord, updateCase } from '../api/cases';

const recordId = ref('');
const isRecording = ref(false);
```

- [ ] **Step 3: 实现开始录制函数**

开始前提示用户：录制完成后会覆盖当前步骤。

```ts
/**
 * 启动有头浏览器录制当前用例。
 */
async function startRecordCase() {
  try {
    await ElMessageBox.confirm(
      '录制完成后会用录制结果覆盖当前步骤，请确认当前改动已保存。',
      '开始录制',
      { type: 'warning' }
    );

    const result = await startRecord(projectKey, caseKey);
    recordId.value = result.sessionId;
    isRecording.value = true;
    ElMessage.success('录制窗口已打开，请在浏览器中完成操作和断言');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error));
    }
  }
}
```

- [ ] **Step 4: 实现停止录制函数**

停止后将返回的用例写回页面状态。

```ts
/**
 * 停止录制并导入录制步骤。
 */
async function stopRecordCase() {
  if (!recordId.value) {
    return;
  }

  try {
    item.value = await stopRecord(projectKey, caseKey, recordId.value);
    recordId.value = '';
    isRecording.value = false;
    ElMessage.success('录制结果已导入当前用例');
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}
```

- [ ] **Step 5: 增加工具栏按钮**

在保存按钮旁边增加录制按钮。录制中禁用保存，避免用户在录制未导入时保存旧步骤。

```vue
<div class="toolbar-actions">
  <el-button v-if="!isRecording" @click="startRecordCase">开始录制</el-button>
  <el-button v-else type="warning" @click="stopRecordCase">停止录制</el-button>
  <el-button type="primary" :disabled="isRecording" @click="saveCase">保存并生成测试文件</el-button>
</div>
```

增加样式。

```css
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 6: 运行类型检查**

Run:

```bash
rtk npm run typecheck
```

Expected: PASS。

---

### Task 7: 做回归验证和文档补充

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 增加录制说明**

在 `README.md` 的“用例文件”或“启动”后增加一段短说明。

```md
## 录制用例

在用例编辑页点击“开始录制”后，平台会打开 Playwright codegen 有头浏览器。测试人员可以在浏览器中完成操作，并使用 Playwright Inspector 的断言工具添加可见性、文本和值断言。

点击“停止录制”后，平台会把录制结果导入当前用例，并覆盖原有步骤。导入后仍可在编辑页调整步骤，再点击“保存并生成测试文件”。

第一阶段录制主要支持点击、输入、选择、跳转、文本断言、可见性断言、输入值断言、URL 断言和标题断言；原生 `alert`、文件上传、下载、多标签页等复杂流程后续补充。
```

- [ ] **Step 2: 运行后端相关测试**

Run:

```bash
rtk npm run test -- tests/server/codegen-parser.test.ts tests/server/record-session.test.ts tests/server/case-generator.test.ts tests/server/api-cases.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行完整自动检查**

Run:

```bash
rtk npm run lint
rtk npm run test
rtk npm run build
```

Expected: 三个命令全部 PASS。

- [ ] **Step 4: 手动验收录制流程**

Run:

```bash
rtk npm run dev
```

手动验证：

1. 打开 `http://localhost:5173`。
2. 进入已有项目或创建项目。
3. 创建或打开一个用例。
4. 点击“开始录制”。
5. 在弹出的有头浏览器里完成点击、输入，并用 Playwright Inspector 添加一个可见性或文本断言。
6. 回到平台点击“停止录制”。
7. 确认步骤列表被录制结果覆盖。
8. 点击“保存并生成测试文件”。
9. 查看 `data/projects/<projectKey>/cases/<caseKey>/case.spec.ts`，确认文件包含录制动作和断言。

Expected: 录制、停止、覆盖、保存、生成测试文件全链路成功。

---

## 第一阶段明确不做

- 不做完整低代码断言编辑器重构。
- 不解析原生 `alert`、`confirm`、`prompt`。
- 不支持多页面、多标签页、下载、上传文件的完整录制导入。
- 不做录制过程实时步骤预览。
- 不在服务重启后恢复未停止的录制会话。

---

## 自检结果

- Spec coverage: 已覆盖录制启动、停止、codegen 导入、断言导入、覆盖当前步骤、生成测试文件、前端入口和验证。
- Placeholder scan: 未保留 TBD、TODO 或未定义任务。
- Type consistency: 计划中新增的 `assertValue`、`match`、`startRecord`、`stopRecord`、`parseCodegenSpec`、`startRecordSession`、`stopRecordSession` 在对应任务中均有定义。
