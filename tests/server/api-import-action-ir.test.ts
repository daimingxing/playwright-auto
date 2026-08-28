import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { createFakeAgentRunner } from '../../server/src/services/import/agent-runner';
import type { AgentRunner } from '../../server/src/services/import/agent-runner';
import type { ImportTaskCase } from '../../shared/types';
import { startImportReview } from './import-task-wait';

let root = '';
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-action-ir-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('导入任务 Action IR 高级编辑', () => {
  it('预览编译结果，保存后的定位器会进入正式发布', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    const preview = await request(app).get(`/api/projects/crm/imports/${taskId}/cases/${caseId}/action-ir`);
    expect(preview.status).toBe(200);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.steps.map((step: { type: string }) => step.type)).toEqual(['click']);

    const reviewed = await request(app).get(`/api/projects/crm/imports/${taskId}`);
    const intentStepId = reviewed.body.cases[0].intent.steps[0].id as string;
    const saved = await request(app)
      .put(`/api/projects/crm/imports/${taskId}/cases/${caseId}/action-ir`)
      .send({
        locators: {
          [intentStepId]: {
            selector: "getByRole('button', { name: '确定', exact: true })",
            selectorDraft: { mode: 'role', role: 'button', value: { kind: 'text', text: '确定' }, exact: true }
          }
        }
      });
    expect(saved.status).toBe(200);

    const after = await request(app).get(`/api/projects/crm/imports/${taskId}/cases/${caseId}/action-ir`);
    expect(after.body.steps[0].selector).toContain('确定');

    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.cases[0].status).toBe('published');

    const official = await request(app).get(
      `/api/projects/crm/cases/${published.body.cases[0].publishedCaseKey}`
    );
    expect(official.body.steps[0].selector).toContain('确定');
  });

  it('歧义未解决时仍返回可编辑的定位和填写值', async () => {
    const app = await createProjectApp();
    const created = await createTask(
      app,
      await buildXlsx({
        用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '', '', '歧义']],
        步骤: [STEP_HEADER, ['TC-001', 1, '点击', '提交', '', '']]
      })
    );
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;
    await startImportReview(app, taskId);

    const preview = await request(app).get(`/api/projects/crm/imports/${taskId}/cases/${caseId}/action-ir`);
    expect(preview.status).toBe(200);
    expect(preview.body.ok).toBe(false);
    expect(preview.body.steps).toHaveLength(1);
    expect(preview.body.steps[0].type).toBe('click');
    expect(preview.body.steps[0].selector).toContain('提交');
  });

  it('已发布用例不能再改定位和填写值', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;
    await startImportReview(app, taskId);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);

    const saved = await request(app).put(`/api/projects/crm/imports/${taskId}/cases/${caseId}/action-ir`).send({
      locators: {}
    });
    expect(saved.status).toBe(400);
    expect(saved.body.message).toBe('只有待确认或可发布的用例可以改定位和填写值');
  });
});

describe('Fake Agent 导入闭环', () => {
  it('同一页面只探索一次，失败用例不影响另一条发布和运行', async () => {
    let runs = 0;
    const inner = createFakeAgentRunner();
    const runner: AgentRunner = {
      async run(input) {
        runs += 1;
        return inner.run(input);
      }
    };
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildMixedWorkbook());
    const taskId = created.body.id as string;
    const reviewed = await startImportReview(app, taskId);
    const byNumber = Object.fromEntries(
      reviewed.cases.map((item) => [item.caseNumber, item as ImportTaskCase])
    );

    expect(runs).toBe(2);
    expect(byNumber['TC-001']?.status).toBe('pending-review');
    expect(byNumber['TC-002']?.status).toBe('pending-review');
    expect(byNumber['TC-003']?.status).toBe('failed');

    const firstId = byNumber['TC-001']?.id as string;
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${firstId}/confirm`);
    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${firstId}/publish`);
    expect(published.body.cases.find((item: ImportTaskCase) => item.id === firstId)?.status).toBe('published');
    expect(published.body.cases.find((item: ImportTaskCase) => item.caseNumber === 'TC-003')?.status).toBe('failed');
  });
});

/**
 * 创建带默认项目的应用。
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
 * 上传 Excel。
 */
async function createTask(app: ReturnType<typeof createApp>, buffer: Buffer) {
  const created = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders.xlsx');
  expect(created.status).toBe(201);
  return created;
}

/**
 * 单条可发布用例。
 */
function buildWorkbook() {
  return buildXlsx({
    用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '', '', '']],
    步骤: [STEP_HEADER, ['TC-001', 1, '点击', '提交', '', '']]
  });
}

/**
 * 两条同页成功用例和一条失败用例。
 */
function buildMixedWorkbook() {
  return buildXlsx({
    用例: [
      CASE_HEADER,
      ['TC-001', '创建订单', '/orders', '', '', ''],
      ['TC-002', '查询订单', '/orders', '', '', ''],
      ['TC-003', '删除订单', '/other', '', '', '探索失败']
    ],
    步骤: [
      STEP_HEADER,
      ['TC-001', 1, '点击', '提交', '', ''],
      ['TC-002', 1, '点击', '提交', '', ''],
      ['TC-003', 1, '点击', '删除', '', '']
    ]
  });
}

/**
 * 按工作表创建 xlsx。
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
