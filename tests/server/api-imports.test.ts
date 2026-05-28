import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { updateImportItem } from '../../server/src/lib/import-store';
import { normalizeUploadName } from '../../server/src/routes/imports';

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
    expect(items.body[0].pageMapId).toMatch(/^pm-/);
    expect(items.body[0].groupId).toBe(items.body[0].pageMapId);
    expect(items.body[0].groupIndex).toBe(0);
    expect(items.body[0].pageMap).toMatchObject({
      mapId: items.body[0].pageMapId,
      targetUrl: '/user/list'
    });

    const saved = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [items.body[0].itemId] });
    const cases = await request(app).get('/api/projects/crm/cases');

    expect(saved.status).toBe(200);
    expect(saved.body.saved).toHaveLength(1);
    expect(cases.body[0].status).toBe('draft');
  });

  it('上传时拒绝不存在的环境且不创建导入任务', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .field('envKey', 'missing-env')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');
    const jobs = await request(app).get('/api/projects/crm/imports');

    expect(created.status).toBe(400);
    expect(created.body.message).toContain('导入环境不存在');
    expect(jobs.body).toEqual([]);
  });

  it('同一文件在不同环境下创建不同导入任务', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await request(app).post('/api/projects/crm/envs').send({
      name: '测试环境',
      key: 'test',
      baseUrl: 'https://crm-test.local'
    });
    const buffer = await createWorkbookBuffer();

    const first = await request(app)
      .post('/api/projects/crm/imports/ai')
      .field('envKey', 'default')
      .attach('file', buffer, 'cases.xlsx');
    const second = await request(app)
      .post('/api/projects/crm/imports/ai')
      .field('envKey', 'test')
      .attach('file', buffer, 'cases.xlsx');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.importId).not.toBe(first.body.importId);
  });

  it('还原上传时被 latin1 误读的中文文件名', () => {
    const mojibake = Buffer.from('AI自然语言用例导入模板.xlsx', 'utf8').toString('latin1');

    expect(normalizeUploadName(mojibake)).toBe('AI自然语言用例导入模板.xlsx');
    expect(normalizeUploadName('cases.xlsx')).toBe('cases.xlsx');
  });

  it('手动重试失败导入项时重置重试次数', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');
    const items = await waitItems(app, created.body.importId);

    await updateImportItem('crm', created.body.importId, items.body[0].itemId, {
      status: 'failed',
      errorMessage: '模型超时',
      retryCount: 1
    });

    const retried = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/items/${items.body[0].itemId}/retry`);
    const nextItems = await waitItems(app, created.body.importId);

    expect(retried.status).toBe(200);
    expect(nextItems.body[0]).toMatchObject({
      status: 'pendingReview',
      retryCount: 0
    });
  });

  it('重复保存同一导入项时返回已有草稿且不重复创建用例', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');
    const items = await waitItems(app, created.body.importId);
    const itemId = items.body[0].itemId;

    const first = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [itemId] });
    const second = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [itemId] });
    const cases = await request(app).get('/api/projects/crm/cases');

    expect(first.body.saved).toHaveLength(1);
    expect(second.body.saved).toEqual(first.body.saved);
    expect(second.body.failed).toEqual([]);
    expect(cases.body).toHaveLength(1);
  });

  it('删除导入记录时只移除导入任务且保留已保存草稿', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');
    const items = await waitItems(app, created.body.importId);
    await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [items.body[0].itemId] });

    const removed = await request(app).delete(`/api/projects/crm/imports/${created.body.importId}`);
    const jobs = await request(app).get('/api/projects/crm/imports');
    const cases = await request(app).get('/api/projects/crm/cases');

    expect(removed.status).toBe(204);
    expect(jobs.body).toEqual([]);
    expect(cases.body).toHaveLength(1);
  });

  it('已保存草稿被删除后返回失效状态并允许重新生成', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const created = await request(app)
      .post('/api/projects/crm/imports/ai')
      .attach('file', await createWorkbookBuffer(), 'cases.xlsx');
    const items = await waitItems(app, created.body.importId);
    const itemId = items.body[0].itemId;
    const saved = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/save`)
      .send({ itemIds: [itemId] });
    await request(app).delete(`/api/projects/crm/cases/${saved.body.saved[0].caseKey}`);

    const staleItems = await request(app).get(`/api/projects/crm/imports/${created.body.importId}/items`);
    expect(staleItems.body[0]).toMatchObject({
      status: 'saved',
      savedCaseKey: saved.body.saved[0].caseKey,
      savedCaseState: 'missing'
    });

    const retried = await request(app)
      .post(`/api/projects/crm/imports/${created.body.importId}/items/${itemId}/retry`);
    const nextItems = await waitItems(app, created.body.importId);

    expect(retried.status).toBe(200);
    expect(nextItems.body[0]).toMatchObject({
      status: 'pendingReview'
    });
    expect(nextItems.body[0].savedCaseState).toBeUndefined();
    expect(nextItems.body[0].savedCaseKey).toBeUndefined();
  });
});

/**
 * 等待后台导入任务处理完成。
 */
async function waitItems(app: ReturnType<typeof createApp>, importId: string) {
  for (let index = 0; index < 10; index += 1) {
    const items = await request(app).get(`/api/projects/crm/imports/${importId}/items`);

    if (items.body[0]?.status === 'pendingReview') {
      return items;
    }

    // 测试环境后台队列使用本地进程内异步任务，这里短轮询等待任务落盘。
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return request(app).get(`/api/projects/crm/imports/${importId}/items`);
}

/**
 * 创建可用于上传接口的最小导入工作簿。
 */
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
