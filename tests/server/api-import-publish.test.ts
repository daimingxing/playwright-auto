import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { readJson } from '../../server/src/lib/fs';
import type { AgentRunInput, AgentRunResult, AgentRunner } from '../../server/src/services/import/agent-runner';
import { createFakeAgentRunner, toTestIntent } from '../../server/src/services/import/agent-runner';
import { getProjectRunFiles } from '../../server/src/services/run/runner';
import type { CaseMeta, ImportTaskCase, TestIntent } from '../../shared/types';
import { startImportReview } from './import-task-wait';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

let root = '';
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-publish-'));
  process.env.DATA_ROOT = root;
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入显式发布', () => {
  it('确认后不落正式用例，显式发布才写入 case.json 和 case.spec.ts', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    const confirmed = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.cases[0].status).toBe('publishable');
    expect(await listPublishedCaseFiles(root)).toEqual([]);
    expect(existsSync(join(root, 'projects', 'crm', 'imports', taskId, 'cases', caseId, 'intent.json'))).toBe(true);

    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(published.status).toBe(200);

    const item = published.body.cases[0] as ImportTaskCase;
    expect(item.status).toBe('published');
    expect(item.publishedCaseKey).toMatch(/^case-/);

    const caseDir = join(root, 'projects', 'crm', 'cases', item.publishedCaseKey as string);
    const official = await readJson<CaseMeta>(join(caseDir, 'case.json'));
    const spec = await readFile(join(caseDir, 'case.spec.ts'), 'utf8');

    expect(official.status).toBe('active');
    expect(official.steps.map((step) => step.type)).toEqual(['fill', 'click', 'assertText']);
    expect(official.steps[2]?.value).toBe('创建成功');
    expect(spec).toContain('test("创建订单"');
    expect(spec).toContain('await page.goto("/orders/create");');
    expect(spec).toContain('创建成功');
    expect(spec).not.toContain('OpenCode');
    expect(spec).not.toContain('Agent');
    expect(await listPublishedCaseFiles(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('case.json'),
        expect.stringContaining('case.spec.ts')
      ])
    );
  });

  it('未解决歧义不能发布，未发布不得当作正式用例', async () => {
    const runner = createScriptedRunner((item) => ({
      kind: 'ambiguity',
      intent: toTestIntent(item, true)
    }));
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    const confirmed = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.cases[0].intent?.pendingItems.length).toBe(1);

    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(published.status).toBe(400);
    expect(published.body.message).toBe('Action IR 校验未通过，不能发布');
    expect(published.body.issues).toEqual([
      expect.objectContaining({ code: 'unresolved-ambiguity' })
    ]);
    expect(await listPublishedCaseFiles(root)).toEqual([]);
  });

  it('未验证定位器不能发布', async () => {
    const runner = createScriptedRunner((item) => {
      const intent = toTestIntent(item);
      intent.steps[0] = { ...intent.steps[0], target: '', data: '' } as TestIntent['steps'][number];
      return { kind: 'success', intent };
    });
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);

    expect(published.status).toBe(400);
    expect(published.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unverified-locator' })])
    );
    expect(await listPublishedCaseFiles(root)).toEqual([]);
  });

  it('cleanup 后仍可从已确认意图发布', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cleanup`);

    expect(existsSync(join(root, 'projects', 'crm', 'imports', taskId, 'output', caseId, 'intent.json'))).toBe(false);
    expect(existsSync(join(root, 'projects', 'crm', 'imports', taskId, 'cases', caseId, 'intent.json'))).toBe(true);

    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.cases[0].status).toBe('published');
    expect(existsSync(join(root, 'projects', 'crm', 'cases', published.body.cases[0].publishedCaseKey, 'case.spec.ts'))).toBe(true);
  });

  it('发布后可走现有运行接口', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    await startImportReview(app, taskId);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    const published = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    const caseKey = published.body.cases[0].publishedCaseKey as string;

    const files = await getProjectRunFiles('crm', [caseKey]);
    expect(files).toEqual([`.*crm.*cases.*${caseKey}.*case\\.spec\\.ts`]);

    spawnMock.mockReturnValue({
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(0);
        }
      }
    });

    const run = await request(app).post('/api/projects/crm/runs').send({ caseKeys: [caseKey] });
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('passed');
    expect(spawnMock).toHaveBeenCalled();
  });

  it('未确认、已发布、项目或任务用例缺失时返回对应错误', async () => {
    const app = await createProjectApp();
    const missingTask = 'imp-20990101-000000-abcd';
    const missingCase = 'item-20990101-000000-abcd';

    const missingProject = await request(app).post(
      `/api/projects/missing/imports/${missingTask}/cases/${missingCase}/publish`
    );
    expect(missingProject.status).toBe(404);
    expect(missingProject.body.message).toBe('项目不存在');

    const missingTaskRes = await request(app).post(
      `/api/projects/crm/imports/${missingTask}/cases/${missingCase}/publish`
    );
    expect(missingTaskRes.status).toBe(404);
    expect(missingTaskRes.body.message).toBe('导入任务不存在');

    const created = await createTask(app, await buildPublishWorkbook());
    const taskId = created.body.id as string;
    const caseId = created.body.cases[0].id as string;

    const missingCaseRes = await request(app).post(
      `/api/projects/crm/imports/${taskId}/cases/${missingCase}/publish`
    );
    expect(missingCaseRes.status).toBe(404);
    expect(missingCaseRes.body.message).toBe('导入用例不存在');

    const notConfirmed = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(notConfirmed.status).toBe(400);
    expect(notConfirmed.body.message).toBe('只有已确认的用例可以发布');

    await startImportReview(app, taskId);
    await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/confirm`);
    const first = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/publish`);
    expect(second.status).toBe(400);
    expect(second.body.message).toBe('该用例已发布');
  });
});

/**
 * 列出项目正式用例目录中的 case.json / case.spec.ts。
 */
async function listPublishedCaseFiles(dataRoot: string) {
  const casesDir = join(dataRoot, 'projects', 'crm', 'cases');

  if (!existsSync(casesDir)) {
    return [];
  }

  const names = await readdir(casesDir, { recursive: true });
  return names.filter((name) => String(name).endsWith('case.json') || String(name).endsWith('case.spec.ts'));
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
 * 按用例编号返回固定 Agent 结果。
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
 * 创建含填写、点击和文本断言的可发布用例。
 */
function buildPublishWorkbook() {
  return buildXlsx({
    用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '', '创建成功', '']],
    步骤: [
      STEP_HEADER,
      ['TC-001', 1, '填写', '名称', '测试订单', ''],
      ['TC-001', 2, '点击', '提交', '', ''],
      ['TC-001', 3, '检查文本', '提示', '创建成功', '']
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
