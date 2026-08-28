import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { readJson } from '../../server/src/lib/fs';
import { createCase } from '../../server/src/lib/case-store';
import { createFakeAgentRunner, toTestIntent } from '../../server/src/services/import/agent-runner';
import type { AgentRunner } from '../../server/src/services/import/agent-runner';
import type { PageArchive, PageArchiveDetail } from '../../shared/types';
import { startImportReview } from './import-task-wait';

let root = '';
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-archive-api-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('页面档案 API', () => {
  it('刷新成功替换 current 并保留 previous', async () => {
    const app = await createProjectApp();
    const created = await createTask(app, await buildValidWorkbook());
    await startImportReview(app, created.body.id as string);
    const listed = await request(app).get('/api/projects/crm/page-archives');
    expect(listed.body).toHaveLength(1);
    const archiveId = listed.body[0].id as string;
    const before = (await request(app).get(`/api/projects/crm/page-archives/${archiveId}`)).body as PageArchiveDetail;

    const started = await request(app).post(`/api/projects/crm/page-archives/${archiveId}/refresh`);
    expect(started.status).toBe(200);
    const refreshed = await waitForArchiveRefresh(app, archiveId);

    expect(refreshed.status).toBe('ready');
    expect(refreshed.currentRevisionId).not.toBe(before.currentRevisionId);
    expect(refreshed.previousRevisionId).toBe(before.currentRevisionId);
  });

  it('刷新失败保留旧档案并记录诊断', async () => {
    let runs = 0;
    const inner = createFakeAgentRunner();
    const runner: AgentRunner = {
      async run(input) {
        runs += 1;
        if (runs === 1) {
          return inner.run(input);
        }

        return { kind: 'explore-failed', message: '页面探索失败，无法生成测试意图' };
      }
    };
    const app = await createProjectApp(runner);
    const created = await createTask(app, await buildValidWorkbook());
    await startImportReview(app, created.body.id as string);
    const archiveId = ((await request(app).get('/api/projects/crm/page-archives')).body as PageArchive[])[0].id;
    const before = (await request(app).get(`/api/projects/crm/page-archives/${archiveId}`)).body as PageArchiveDetail;

    const started = await request(app).post(`/api/projects/crm/page-archives/${archiveId}/refresh`);
    expect(started.status).toBe(200);
    const failed = await waitForArchiveRefresh(app, archiveId);

    expect(failed.status).toBe('failed');
    expect(failed.refreshFailure?.message).toContain('页面探索失败');
    expect(failed.currentRevisionId).toBe(before.currentRevisionId);
  });

  it('删除页面档案不修改已有测试计划', async () => {
    const app = await createProjectApp();
    const createdCase = await createCase('crm', { name: '手工用例', startPath: '/orders' });
    const created = await createTask(app, await buildValidWorkbook());
    await startImportReview(app, created.body.id as string);
    const archiveId = ((await request(app).get('/api/projects/crm/page-archives')).body as PageArchive[])[0].id;
    const casePath = join(root, 'projects', 'crm', 'cases', createdCase.key, 'case.json');
    const before = await readJson<unknown>(casePath);

    const deleted = await request(app).delete(`/api/projects/crm/page-archives/${archiveId}`);
    expect(deleted.status).toBe(204);
    expect(existsSync(join(root, 'projects', 'crm', 'page-archives', archiveId))).toBe(false);
    expect(await readJson<unknown>(casePath)).toEqual(before);
  });
});

/**
 * 等待页面档案刷新结束。
 */
async function waitForArchiveRefresh(app: ReturnType<typeof createApp>, archiveId: string, timeoutMs = 4000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const res = await request(app).get(`/api/projects/crm/page-archives/${archiveId}`);
    expect(res.status).toBe(200);
    const archive = res.body as PageArchiveDetail;

    if (archive.status !== 'refreshing') {
      return archive;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`等待页面档案 ${archiveId} 刷新结束超时`);
}

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
 * 上传 Excel 并断言任务创建成功。
 */
async function createTask(app: ReturnType<typeof createApp>, buffer: Buffer) {
  const created = await request(app).post('/api/projects/crm/imports').attach('file', buffer, 'orders.xlsx');
  expect(created.status).toBe(201);
  return created;
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
