import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { writeJson } from '../../server/src/lib/fs';
import { getTrashPath } from '../../server/src/lib/path';

let root = '';
const caseKeyPattern = /^case-\d{8}-\d{6}-[a-f0-9]{4}$/;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-api-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('用例接口', () => {
  it('通过接口创建用例并删除到回收站', async () => {
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

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('创建订单');
    expect(created.body.key).toMatch(caseKeyPattern);

    const removed = await request(app).delete(`/api/projects/crm/cases/${created.body.key}`);
    expect(removed.status).toBe(204);

    const list = await request(app).get('/api/projects/crm/cases');
    expect(list.body).toHaveLength(0);

    const trash = await request(app).get('/api/projects/crm/trash');
    expect(trash.body).toHaveLength(1);
  });

  it('拒绝非法用例路径参数', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const res = await request(app).get('/api/projects/crm/cases/CASE');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('用例标识不合法');
  });

  it('可以下载单条测试用例压缩包', async () => {
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

    const res = await request(app).get(`/api/projects/crm/cases/${created.body.key}/export`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(`${created.body.key}.zip`);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  it('通过接口恢复和彻底删除回收站用例', async () => {
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
    const second = await request(app).post('/api/projects/crm/cases').send({
      name: '查询订单',
      startPath: '/orders'
    });

    await request(app).delete(`/api/projects/crm/cases/${created.body.key}`);
    await request(app).delete(`/api/projects/crm/cases/${second.body.key}`);

    const restored = await request(app).post(`/api/projects/crm/trash/${created.body.key}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.key).toBe(created.body.key);

    const removed = await request(app).delete(`/api/projects/crm/trash/${second.body.key}`);
    expect(removed.status).toBe(204);

    const list = await request(app).get('/api/projects/crm/cases');
    expect(list.body.map((item: { key: string }) => item.key)).toEqual([created.body.key]);

    const trash = await request(app).get('/api/projects/crm/trash');
    expect(trash.body).toHaveLength(0);
  });

  it('通过接口恢复回收站用例时会避开现有用例编号', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await writeJson(join(getTrashPath('crm', 'case-1'), 'case.json'), {
      name: '回收站旧用例',
      key: 'case-1',
      startPath: '/orders/create',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const restored = await request(app).post('/api/projects/crm/trash/case-1/restore');

    expect(restored.status).toBe(200);
    expect(restored.body.key).toBe('case-1');
  });

  it('通过接口删除用例到回收站时会同步冲突后的用例编号', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const oldCase = {
      name: '回收站旧用例',
      key: 'case-1',
      startPath: '/orders/create',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeJson(join(root, 'projects', 'crm', 'cases', 'case-1', 'case.json'), oldCase);
    await writeJson(join(getTrashPath('crm', 'case-1'), 'case.json'), oldCase);

    const removed = await request(app).delete('/api/projects/crm/cases/case-1');
    const trash = await request(app).get('/api/projects/crm/trash');
    const restored = await request(app).post('/api/projects/crm/trash/case-1-1/restore');

    expect(removed.status).toBe(204);
    expect(trash.body.map((item: { key: string }) => item.key)).toEqual(['case-1', 'case-1-1']);
    expect(restored.status).toBe(200);
    expect(restored.body.key).toBe('case-1-1');
  });

  it('读取历史用例时自动补充审查结果', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await writeJson(join(root, 'projects', 'crm', 'cases', 'case-old', 'case.json'), {
      name: '历史用例',
      key: 'case-old',
      startPath: '/orders',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')"
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const list = await request(app).get('/api/projects/crm/cases');
    expect(list.body[0].review.summary.error).toBe(1);

    const detail = await request(app).get('/api/projects/crm/cases/case-old');
    expect(detail.body.review.items[0].ruleCode).toBe('dynamic-id');
  });

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
    expect(stopped.body.review.summary.level).toBe('pass');
  });

  it('保存用例时生成静态审查结果', async () => {
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

    const saved = await request(app)
      .put(`/api/projects/crm/cases/${created.body.key}`)
      .send({
        ...created.body,
        steps: [
          {
            id: 's1',
            type: 'click',
            selector: "locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')"
          },
          {
            id: 's2',
            type: 'click',
            selector: "locator('.k-picker.k-dropdownlist > .k-input-button')"
          }
        ]
      });

    expect(saved.status).toBe(200);
    expect(saved.body.review.summary).toMatchObject({
      level: 'error',
      error: 1,
      danger: 1
    });
    expect(saved.body.review.items).toHaveLength(2);

    const list = await request(app).get('/api/projects/crm/cases');
    expect(list.body[0].review.summary.error).toBe(1);
  });

  it('可以触发用例实测检查并读取历史记录和详情', async () => {
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

    const started = await request(app)
      .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
      .send({ envKey: 'default' });
    const list = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);
    const detail = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews/${started.body.id}`);

    expect(started.status).toBe(201);
    expect(started.body.status).toBe('passed');
    expect(list.body).toHaveLength(1);
    expect(detail.body.id).toBe(started.body.id);
  });

  it('触发实测检查时会校验请求参数', async () => {
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

    const invalidEnv = await request(app)
      .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
      .send({ envKey: '../default' });
    const invalidFailure = await request(app)
      .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
      .send({
        envKey: 'default',
        testFailure: {
          stepId: '',
          code: 'bad-code',
          message: '',
          suggestion: ''
        }
      });

    expect(invalidEnv.status).toBe(400);
    expect(invalidFailure.status).toBe(400);
    expect(invalidEnv.body.message).toContain('请求参数不合法');
    expect(invalidFailure.body.message).toContain('请求参数不合法');
  });

  it('可以清理用例实测检查历史', async () => {
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
    await request(app)
      .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
      .send({ envKey: 'default' });

    const removed = await request(app).delete(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);
    const list = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);

    expect(removed.status).toBe(204);
    expect(list.body).toEqual([]);
  });
});
