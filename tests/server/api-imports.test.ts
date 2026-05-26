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
