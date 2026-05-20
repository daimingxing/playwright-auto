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
});
