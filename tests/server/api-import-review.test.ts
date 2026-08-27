import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { readJson } from '../../server/src/lib/fs';
import type { AgentRunInput, AgentRunResult, AgentRunner } from '../../server/src/services/import/agent-runner';
import { createFakeAgentRunner, toTestIntent } from '../../server/src/services/import/agent-runner';
import type { ImportTaskCase } from '../../shared/types';
import { startImportReview, startImportRetry, waitForImportReview } from './import-task-wait';

let root = '';
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-review-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入 TestIntent 审阅', () => {
  it('Fake Agent 产出带来源引用的 TestIntent，并推进到待确认', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildValidWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    const reviewed = await startImportReview(app, taskId);
    const item = reviewed.cases[0] as ImportTaskCase;
    expect(item.status).toBe('pending-review');
    expect(item.intent?.caseNumber).toBe('TC-001');
    expect(item.intent?.steps[0]?.action).toBe('点击');
    expect(item.intent?.steps[0]?.sourceRefs[0]).toMatchObject({
      sheet: '步骤',
      caseNumber: 'TC-001'
    });
    expect(item.intent?.steps[0]?.sourceRefs[0]?.cells['动作类型']).toBe('点击');
    expect(item.intent?.source).toMatchObject({ sheet: '用例', caseNumber: 'TC-001' });

    const taskDir = join(root, 'projects', 'crm', 'imports', taskId);
    const diagnostics = await readJson<{ kind: string; stages: string[] }>(
      join(taskDir, 'diagnostics', caseId, 'result.json')
    );
    expect(diagnostics.kind).toBe('success');
    expect(diagnostics.stages).toEqual(['exploring', 'pending-review']);
    expect(existsSync(join(taskDir, 'work', caseId, 'input.json'))).toBe(true);
    expect(existsSync(join(taskDir, 'output', caseId, 'intent.json'))).toBe(true);
    expect(existsSync(join(taskDir, 'input', 'input.xlsx'))).toBe(true);
  });

  it('审阅请求在探索完成前返回，断开连接后探索仍继续', async () => {
    const app = await createProjectApp(createFakeAgentRunner({ delayMs: 400 }));
    const created = await createTask(app, await buildValidWorkbook());
    const taskId = created.body.id as string;
    const startedAt = Date.now();
    const started = await request(app).post(`/api/projects/crm/imports/${taskId}/review`);

    expect(started.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(started.body.cases[0]?.status).toBe('exploring');

    const reviewed = await waitForImportReview(app, taskId);
    expect(reviewed.cases[0]?.status).toBe('pending-review');
    expect(reviewed.cases[0]?.failure).toBeUndefined();
  });

  it('同一任务重复提交审阅不会启动第二次探索', async () => {
    let runs = 0;
    const runner: AgentRunner = {
      async run(input) {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 120));
        await writeFile(join(input.workDir, 'once.json'), '{}');
        return { kind: 'success', intent: toTestIntent(input.item) };
      }
    };
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildValidWorkbook());
    const taskId = created.body.id as string;

    await Promise.all([
      request(app).post(`/api/projects/crm/imports/${taskId}/review`),
      request(app).post(`/api/projects/crm/imports/${taskId}/review`)
    ]);
    const reviewed = await waitForImportReview(app, taskId);

    expect(runs).toBe(1);
    expect(reviewed.cases[0]?.status).toBe('pending-review');
  });

  it('可以注入 AgentRunner，并覆盖成功、歧义与失败结果', async () => {
    const seen: string[] = [];
    const runner = createScriptedRunner((item) => {
      seen.push(item.caseNumber);
      if (item.caseNumber === 'TC-002') {
        return { kind: 'login-blocked', message: '探索被登录态阻塞，请更新项目登录态后重试' };
      }
      if (item.caseNumber === 'TC-003') {
        return { kind: 'ambiguity', intent: toTestIntent(item, true) };
      }
      return { kind: 'success', intent: toTestIntent(item) };
    });
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildThreeCaseWorkbook());

    const reviewed = await startImportReview(app, created.body.id as string);
    const cases = Object.fromEntries(reviewed.cases.map((item) => [item.caseNumber, item]));

    expect(seen).toEqual(['TC-001', 'TC-002', 'TC-003']);
    expect(cases['TC-001']?.status).toBe('pending-review');
    expect(cases['TC-002']?.status).toBe('failed');
    expect(cases['TC-002']?.failure?.kind).toBe('login-blocked');
    expect(cases['TC-003']?.status).toBe('pending-review');
    expect(cases['TC-003']?.intent?.pendingItems.length).toBe(1);
    expect(cases['TC-001']?.status).not.toBe('failed');
  });

  it('确认后变为可发布，且不写正式 case.json / case.spec.ts', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildValidWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    const confirmed = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.cases[0].status).toBe('publishable');
    expect(confirmed.body.cases[0].intent?.steps.length).toBeGreaterThan(0);
    expect(await listPublishedCaseFiles(root)).toEqual([]);
    expect(existsSync(join(root, 'projects', 'crm', 'imports', taskId, 'output', caseId, 'intent.json'))).toBe(true);
  });

  it('单条重试只重跑目标用例，不影响已确认条目', async () => {
    const outcomes = new Map<string, 'success' | 'explore-failed'>([
      ['TC-001', 'success'],
      ['TC-002', 'explore-failed']
    ]);
    const runner = createScriptedRunner((item) => {
      const kind = outcomes.get(item.caseNumber) ?? 'success';
      if (kind === 'explore-failed') {
        return { kind, message: '页面探索失败，无法生成测试意图' };
      }
      return { kind: 'success', intent: toTestIntent(item) };
    });
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildTwoCaseWorkbook());
    const taskId = created.body.id as string;
    const first = created.body.cases.find((item: ImportTaskCase) => item.caseNumber === 'TC-001');
    const second = created.body.cases.find((item: ImportTaskCase) => item.caseNumber === 'TC-002');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const firstId = first?.id as string;
    const secondId = second?.id as string;

    await startImportReview(app, taskId);
    const confirmed = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${firstId}/confirm`);
    expect(confirmed.body.cases.find((item: ImportTaskCase) => item.id === firstId).status).toBe('publishable');

    outcomes.set('TC-002', 'success');
    const after = await startImportRetry(app, taskId, secondId);
    const confirmedCase = after.cases.find((item) => item.id === firstId);
    const retriedCase = after.cases.find((item) => item.id === secondId);

    expect(confirmedCase?.status).toBe('publishable');
    expect(retriedCase?.status).toBe('pending-review');
    expect(retriedCase?.intent?.caseNumber).toBe('TC-002');
  });

  it('单条重试立即返回探索中，不把旧失败当成已完成', async () => {
    let runs = 0;
    const runner: AgentRunner = {
      async run(input) {
        runs += 1;
        if (runs === 1) {
          return { kind: 'explore-failed', message: '页面探索失败，无法生成测试意图' };
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
        return { kind: 'success', intent: toTestIntent(input.item) };
      }
    };
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildValidWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    const startedAt = Date.now();
    const started = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/retry`);

    expect(started.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(started.body.cases[0]?.status).toBe('exploring');

    const retried = await waitForImportReview(app, taskId);
    expect(retried.cases[0]?.status).toBe('pending-review');
  });

  it('审阅、确认和重试在项目或任务不存在时返回 404', async () => {
    const app = await createProjectApp();
    const missingTask = 'imp-20990101-000000-abcd';
    const missingCase = 'item-20990101-000000-abcd';

    const reviewMissingTask = await request(app).post(`/api/projects/crm/imports/${missingTask}/review`);
    expect(reviewMissingTask.status).toBe(404);
    expect(reviewMissingTask.body.message).toBe('导入任务不存在');

    const reviewMissingProject = await request(app).post(`/api/projects/missing/imports/${missingTask}/review`);
    expect(reviewMissingProject.status).toBe(404);
    expect(reviewMissingProject.body.message).toBe('项目不存在');

    const created = await createTask(app, await buildValidWorkbook());
    const confirmMissing = await request(app).post(
      `/api/projects/crm/imports/${created.body.id}/cases/${missingCase}/confirm`
    );
    expect(confirmMissing.status).toBe(404);
    expect(confirmMissing.body.message).toBe('导入用例不存在');

    const retryMissing = await request(app).post(
      `/api/projects/crm/imports/${created.body.id}/cases/${missingCase}/retry`
    );
    expect(retryMissing.status).toBe(404);
    expect(retryMissing.body.message).toBe('导入用例不存在');
  });

  it('解析快照缺失时拒绝审阅且不重新解析 Excel', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildValidWorkbook());
    const taskDir = join(root, 'projects', 'crm', 'imports', created.body.id as string);
    await rm(join(taskDir, 'parse.json'), { force: true });

    const reviewed = await request(app).post(`/api/projects/crm/imports/${created.body.id}/review`);

    expect(reviewed.status).toBe(400);
    expect(reviewed.body.message).toBe('解析快照缺失，无法审阅');
  });

  it('按备注返回探索失败和定位失败，且不影响其他成功用例', async () => {
    const app = await createProjectApp();
    const buffer = await buildXlsx({
      用例: [
        CASE_HEADER,
        ['TC-001', '创建订单', '/orders/create', '', '', ''],
        ['TC-002', '查询订单', '/orders', '', '', '探索失败'],
        ['TC-003', '删除订单', '/orders', '', '', '定位失败']
      ],
      步骤: [
        STEP_HEADER,
        ['TC-001', 1, '点击', '提交', '', ''],
        ['TC-002', 1, '打开页面', '/orders', '', ''],
        ['TC-003', 1, '点击', '删除', '', '']
      ]
    });
    const created = await createTask(app, buffer);
    const reviewed = await startImportReview(app, created.body.id as string);
    const cases = Object.fromEntries(reviewed.cases.map((item) => [item.caseNumber, item]));

    expect(cases['TC-001']?.status).toBe('pending-review');
    expect(cases['TC-002']?.failure?.kind).toBe('explore-failed');
    expect(cases['TC-003']?.failure?.kind).toBe('locator-failed');
  });
});

/**
 * 列出项目正式用例目录中的 case.json / case.spec.ts，用于确认未发布。
 */
async function listPublishedCaseFiles(dataRoot: string) {
  const casesDir = join(dataRoot, 'projects', 'crm', 'cases');

  if (!existsSync(casesDir)) {
    return [];
  }

  const names = await readdir(casesDir, { recursive: true });
  return names.filter((name) => name.endsWith('case.json') || name.endsWith('case.spec.ts'));
}

/**
 * 创建带默认项目的应用，可注入 AgentRunner。
 */
async function createProjectApp(agentRunner?: AgentRunner) {
  const app = createApp({ agentRunner: agentRunner ?? createFakeAgentRunner() });
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  return app;
}

/**
 * 上传 Excel 并断言任务创建成功。
 */
async function createTask(app: ReturnType<typeof createApp>, buffer: Buffer) {
  const created = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders.xlsx');
  expect(created.status).toBe(201);
  return created;
}

/**
 * 按用例编号返回固定 Agent 结果，用于注入测试。
 */
function createScriptedRunner(outcomeFor: (item: ImportTaskCase) => AgentRunResult): AgentRunner {
  return {
    async run(input: AgentRunInput) {
      await writeFile(join(input.workDir, 'scripted.json'), JSON.stringify({ caseNumber: input.item.caseNumber }));
      return outcomeFor(input.item);
    }
  };
}

/**
 * 创建一份可成功解析的双表 Excel。
 */
function buildValidWorkbook() {
  return buildXlsx({
    用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '', '', '']],
    步骤: [STEP_HEADER, ['TC-001', 1, '点击', '提交', '', '']]
  });
}

/**
 * 创建包含两条有效用例的双表 Excel。
 */
function buildTwoCaseWorkbook() {
  return buildXlsx({
    用例: [
      CASE_HEADER,
      ['TC-001', '创建订单', '/orders/create', '', '', ''],
      ['TC-002', '查询订单', '/orders', '', '', '']
    ],
    步骤: [
      STEP_HEADER,
      ['TC-001', 1, '点击', '提交', '', ''],
      ['TC-002', 1, '打开页面', '/orders', '', '']
    ]
  });
}

/**
 * 创建三条用例，覆盖注入 runner 的成功、登录阻塞和歧义。
 */
function buildThreeCaseWorkbook() {
  return buildXlsx({
    用例: [
      CASE_HEADER,
      ['TC-001', '创建订单', '/orders/create', '', '', ''],
      ['TC-002', '查询订单', '/orders', '', '', ''],
      ['TC-003', '编辑订单', '/orders/edit', '', '', '']
    ],
    步骤: [
      STEP_HEADER,
      ['TC-001', 1, '点击', '提交', '', ''],
      ['TC-002', 1, '打开页面', '/orders', '', ''],
      ['TC-003', 1, '填写', '名称', '新订单', '']
    ]
  });
}

/**
 * 按工作表名和行列值现场创建 xlsx 缓冲区。
 */
async function buildXlsx(sheets: Record<string, Array<Array<string | number>>>) {
  const workbook = new ExcelJS.Workbook();

  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);

    for (const row of rows) {
      sheet.addRow(row);
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
