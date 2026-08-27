import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { readJson, writeJson } from '../../server/src/lib/fs';
import type { ImportTaskCase, ImportTaskDetail } from '../../shared/types';

let root = '';
const taskIdPattern = /^imp-\d{8}-\d{6}-[a-f0-9]{4}$/;
const caseIdPattern = /^item-\d{8}-\d{6}-[a-f0-9]{4}$/;
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入接口', () => {
  it('未上传文件时返回参数错误', async () => {
    const app = await createProjectApp();

    const res = await request(app).post('/api/projects/crm/imports');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('请上传 Excel 文件');
  });

  it('拒绝非 xlsx 文件', async () => {
    const app = await createProjectApp();

    const res = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', Buffer.from('not-excel'), 'notes.txt');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('只支持 .xlsx 文件');
  });

  it('结构错误时不创建任务目录', async () => {
    const app = await createProjectApp();
    const buffer = await buildXlsx({
      用例清单: [CASE_HEADER, ['TC-001', '创建订单', '/orders', '', '', '']]
    });

    const res = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', buffer, 'broken.xlsx');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Excel 文件结构错误');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: '用例', reason: '缺少工作表「用例」' })
      ])
    );
    expect(await listImportDirs()).toEqual([]);
  });

  it('成功创建任务后可读取输入快照、解析快照和逐用例初始状态', async () => {
    const app = await createProjectApp();
    const buffer = await buildXlsx({
      用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '已登录', '创建成功', '']],
      步骤: [
        STEP_HEADER,
        ['TC-001', 1, '打开页面', '/orders/create', '', ''],
        ['TC-001', 2, '填写', '订单名称', '测试订单', '']
      ]
    });

    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', buffer, 'orders.xlsx');

    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(taskIdPattern);
    expect(created.body.fileName).toBe('orders.xlsx');
    expect(created.body.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.parsedCount).toBe(1);
    expect(created.body.failedCount).toBe(0);
    expect(created.body.cases[0].id).toMatch(caseIdPattern);
    expect(created.body.cases[0].status).toBe('parsed');

    const taskId = created.body.id as string;
    const got = await request(app).get(`/api/projects/crm/imports/${taskId}`);
    expect(got.status).toBe(200);
    expect(got.body.cases).toHaveLength(1);
    expect(got.body.cases[0].steps).toHaveLength(2);

    const taskDir = join(root, 'projects', 'crm', 'imports', taskId);
    const input = await readFile(join(taskDir, 'input', 'input.xlsx'));
    const inputMeta = await readJson<{ fileName: string; fileHash: string; assetId: string }>(
      join(taskDir, 'input', 'input.json')
    );
    const parseSnapshot = await readJson<{ cases: ImportTaskCase[] }>(join(taskDir, 'parse.json'));
    const caseId = created.body.cases[0].id as string;
    const status = await readJson<{ status: string }>(join(taskDir, 'cases', caseId, 'status.json'));
    const checkpoint = await readJson<{ stage: string }>(join(taskDir, 'checkpoint.json'));

    expect(created.body.status).toBe('completed');
    expect(created.body.assetId).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.assetId).toBe(created.body.fileHash);
    expect(created.body.checkpoint.stage).toBe('completed');
    expect(created.body.input.assetId).toBe(created.body.assetId);
    expect(input.length).toBeGreaterThan(0);
    expect(inputMeta.fileName).toBe('orders.xlsx');
    expect(inputMeta.fileHash).toBe(created.body.fileHash);
    expect(inputMeta.assetId).toBe(created.body.assetId);
    expect(parseSnapshot.cases[0]?.caseNumber).toBe('TC-001');
    expect(status.status).toBe('parsed');
    expect(checkpoint.stage).toBe('completed');
    expect(existsSync(join(taskDir, 'work'))).toBe(true);
    expect(existsSync(join(taskDir, 'output'))).toBe(true);
    expect(existsSync(join(taskDir, 'diagnostics'))).toBe(true);
    expect(existsSync(join(root, 'projects', 'crm', 'assets', created.body.assetId, 'content'))).toBe(true);
  });

  it('保留中文文件名', async () => {
    const app = await createProjectApp();
    const buffer = await buildValidWorkbook();

    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', buffer, '导入用例.xlsx');

    expect(created.status).toBe(201);
    expect(created.body.fileName).toBe('导入用例.xlsx');

    const got = await request(app).get(`/api/projects/crm/imports/${created.body.id}`);
    expect(got.body.fileName).toBe('导入用例.xlsx');
  });

  it('单个用例内容错误时仍创建任务并保留其他有效用例', async () => {
    const app = await createProjectApp();
    const buffer = await buildXlsx({
      用例: [
        CASE_HEADER,
        ['TC-001', '创建订单', '/orders/create', '', '', ''],
        ['TC-002', '查询订单', '/orders', '', '', '']
      ],
      步骤: [
        STEP_HEADER,
        ['TC-001', 1, '打开页面', '/orders/create', '', ''],
        ['TC-002', 1, 'goto', '/orders', '', '']
      ]
    });

    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', buffer, 'mixed.xlsx');

    expect(created.status).toBe(201);
    expect(created.body.parsedCount).toBe(1);
    expect(created.body.failedCount).toBe(1);

    const detail = created.body as ImportTaskDetail;
    const parsed = detail.cases.find((item) => item.caseNumber === 'TC-001');
    const failed = detail.cases.find((item) => item.caseNumber === 'TC-002');
    expect(parsed?.status).toBe('parsed');
    expect(failed?.status).toBe('parse-failed');
    expect(await listImportDirs()).toEqual([created.body.id]);
  });

  it('可以列出任务，不存在的任务返回 404，且不启动后续处理', async () => {
    const app = await createProjectApp();
    const buffer = await buildValidWorkbook();

    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', buffer, 'orders.xlsx');

    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('worker');
    expect(created.body).not.toHaveProperty('queue');

    const listed = await request(app).get('/api/projects/crm/imports');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);
    expect(listed.body[0]).not.toHaveProperty('cases');

    const missing = await request(app).get('/api/projects/crm/imports/imp-20990101-000000-abcd');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('导入任务不存在');
  });

  it('相同内容的两次上传创建两个任务并共用一份资产', async () => {
    const app = await createProjectApp();
    const buffer = await buildValidWorkbook();

    const first = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders.xlsx');
    const second = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders-copy.xlsx');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.assetId).toBe(first.body.assetId);
    expect(await readdir(join(root, 'projects', 'crm', 'assets'))).toEqual([first.body.assetId]);
  });

  it('恢复已完成任务时跳过全部成功项且不重新解析 Excel', async () => {
    const app = await createProjectApp();
    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', await buildTwoCaseWorkbook(), 'orders.xlsx');

    const taskId = created.body.id as string;
    const parseBefore = await readFile(join(root, 'projects', 'crm', 'imports', taskId, 'parse.json'), 'utf8');

    const resumed = await request(app).post(`/api/projects/crm/imports/${taskId}/resume`);

    expect(resumed.status).toBe(200);
    expect(resumed.body.skippedItemIds).toEqual(created.body.cases.map((item: { id: string }) => item.id));
    expect(resumed.body.processedItemIds).toEqual([]);
    expect(resumed.body.status).toBe('completed');
    expect(await readFile(join(root, 'projects', 'crm', 'imports', taskId, 'parse.json'), 'utf8')).toBe(parseBefore);
  });

  it('恢复时跳过已成功项并补写未完成项，半截 JSON 不影响上一份检查点', async () => {
    const app = await createProjectApp();
    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', await buildTwoCaseWorkbook(), 'orders.xlsx');

    const taskId = created.body.id as string;
    const firstId = created.body.cases[0].id as string;
    const secondId = created.body.cases[1].id as string;
    const taskDir = join(root, 'projects', 'crm', 'imports', taskId);
    const firstStatusPath = join(taskDir, 'cases', firstId, 'status.json');
    const firstStatus = await readFile(firstStatusPath, 'utf8');

    await rm(join(taskDir, 'cases', secondId), { recursive: true, force: true });
    await writeJson(join(taskDir, 'checkpoint.json'), {
      stage: 'items',
      updatedAt: new Date().toISOString(),
      items: [{ id: firstId, status: 'parsed' }]
    });
    const taskRecord = await readJson<Record<string, unknown>>(join(taskDir, 'task.json'));
    await writeJson(join(taskDir, 'task.json'), {
      ...taskRecord,
      status: 'interrupted'
    });
    await writeFile(join(taskDir, 'checkpoint.json.tmp'), '{');

    const resumed = await request(app).post(`/api/projects/crm/imports/${taskId}/resume`);

    expect(resumed.status).toBe(200);
    expect(resumed.body.skippedItemIds).toEqual([firstId]);
    expect(resumed.body.processedItemIds).toEqual([secondId]);
    expect(resumed.body.status).toBe('completed');
    expect(resumed.body.checkpoint.stage).toBe('completed');
    expect(await readFile(firstStatusPath, 'utf8')).toBe(firstStatus);
    expect(existsSync(join(taskDir, 'cases', secondId, 'status.json'))).toBe(true);
    expect(resumed.body.input.assetId).toBe(created.body.assetId);
  });

  it('恢复不存在的任务或项目时返回错误', async () => {
    const app = await createProjectApp();

    const missingTask = await request(app).post('/api/projects/crm/imports/imp-20990101-000000-abcd/resume');
    expect(missingTask.status).toBe(404);
    expect(missingTask.body.message).toBe('导入任务不存在');

    const missingProject = await request(app).post('/api/projects/missing/imports/imp-20990101-000000-abcd/resume');
    expect(missingProject.status).toBe(404);
    expect(missingProject.body.message).toBe('项目不存在');
  });

  it('解析快照缺失时拒绝恢复且不重新解析 Excel', async () => {
    const app = await createProjectApp();
    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', await buildValidWorkbook(), 'orders.xlsx');
    const taskDir = join(root, 'projects', 'crm', 'imports', created.body.id as string);
    await rm(join(taskDir, 'parse.json'), { force: true });

    const resumed = await request(app).post(`/api/projects/crm/imports/${created.body.id}/resume`);

    expect(resumed.status).toBe(400);
    expect(resumed.body.message).toBe('解析快照缺失，无法恢复');
  });

  it('清理只删除任务内 work/output/diagnostics，不影响正式用例和资产', async () => {
    const app = await createProjectApp();
    const created = await request(app)
      .post('/api/projects/crm/imports')
      .attach('file', await buildValidWorkbook(), 'orders.xlsx');
    const taskId = created.body.id as string;
    const taskDir = join(root, 'projects', 'crm', 'imports', taskId);
    const caseRes = await request(app).post('/api/projects/crm/cases').send({
      name: '正式用例',
      startPath: '/orders'
    });

    await writeFile(join(taskDir, 'work', 'tmp.txt'), 'work');
    await writeFile(join(taskDir, 'output', 'tmp.txt'), 'output');
    await writeFile(join(taskDir, 'diagnostics', 'tmp.txt'), 'diag');

    const cleaned = await request(app).post(`/api/projects/crm/imports/${taskId}/cleanup`);

    expect(cleaned.status).toBe(200);
    expect(existsSync(join(taskDir, 'work', 'tmp.txt'))).toBe(false);
    expect(existsSync(join(taskDir, 'output', 'tmp.txt'))).toBe(false);
    expect(existsSync(join(taskDir, 'diagnostics', 'tmp.txt'))).toBe(false);
    expect(existsSync(join(taskDir, 'input', 'input.xlsx'))).toBe(true);
    expect(existsSync(join(taskDir, 'parse.json'))).toBe(true);
    expect(existsSync(join(taskDir, 'checkpoint.json'))).toBe(true);
    expect(existsSync(join(root, 'projects', 'crm', 'assets', created.body.assetId, 'content'))).toBe(true);
    expect(existsSync(join(root, 'projects', 'crm', 'cases', caseRes.body.key, 'case.json'))).toBe(true);
  });

  it('清理不存在的任务时返回 404', async () => {
    const app = await createProjectApp();

    const res = await request(app).post('/api/projects/crm/imports/imp-20990101-000000-abcd/cleanup');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('导入任务不存在');
  });

  it('删除导入任务后列表不再出现，已发布用例和资产仍保留', async () => {
    const app = await createProjectApp();
    const buffer = await buildValidWorkbook();
    const first = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders.xlsx');
    const second = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders-copy.xlsx');
    const taskId = first.body.id as string;
    const keptId = second.body.id as string;
    const caseRes = await request(app).post('/api/projects/crm/cases').send({
      name: '正式用例',
      startPath: '/orders'
    });

    const removed = await request(app).delete(`/api/projects/crm/imports/${taskId}`);

    expect(removed.status).toBe(204);
    expect(existsSync(join(root, 'projects', 'crm', 'imports', taskId))).toBe(false);
    expect(existsSync(join(root, 'projects', 'crm', 'imports', keptId, 'task.json'))).toBe(true);
    expect(existsSync(join(root, 'projects', 'crm', 'assets', first.body.assetId, 'content'))).toBe(true);
    expect(existsSync(join(root, 'projects', 'crm', 'cases', caseRes.body.key, 'case.json'))).toBe(true);

    const listed = await request(app).get('/api/projects/crm/imports');
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([keptId]);

    const missing = await request(app).get(`/api/projects/crm/imports/${taskId}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('导入任务不存在');
  });

  it('删除不存在的导入任务时返回 404', async () => {
    const app = await createProjectApp();

    const res = await request(app).delete('/api/projects/crm/imports/imp-20990101-000000-abcd');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('导入任务不存在');
  });
});

/**
 * 创建带默认项目的应用。
 */
async function createProjectApp() {
  const app = createApp();
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  return app;
}

/**
 * 读取已落盘的导入任务目录名。
 */
async function listImportDirs() {
  const importsPath = join(root, 'projects', 'crm', 'imports');

  if (!existsSync(importsPath)) {
    return [];
  }

  return readdir(importsPath);
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
 * 创建一份可成功解析的双表 Excel。
 */
function buildValidWorkbook() {
  return buildXlsx({
    用例: [CASE_HEADER, ['TC-001', '创建订单', '/orders/create', '', '', '']],
    步骤: [STEP_HEADER, ['TC-001', 1, '点击', '提交', '', '']]
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
