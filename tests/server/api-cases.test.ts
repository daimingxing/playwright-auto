import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';

let root = '';

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

    const removed = await request(app).delete('/api/projects/crm/cases/case-1');
    expect(removed.status).toBe(204);

    const list = await request(app).get('/api/projects/crm/cases');
    expect(list.body).toHaveLength(0);

    const trash = await request(app).get('/api/projects/crm/trash');
    expect(trash.body).toHaveLength(1);
  });
});
