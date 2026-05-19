import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-auth-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('登录接口', () => {
  it('可以查询项目级登录态状态', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://www.cctq.ai'
    });

    const res = await request(app).get('/api/projects/cctq/auth/state');

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  it('可以启动手动登录会话', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://www.cctq.ai'
    });

    const res = await request(app).post('/api/projects/cctq/auth/start').send({});

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeTruthy();
  });

  it('可以保存手动登录会话为项目级登录态', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://www.cctq.ai'
    });

    const started = await request(app).post('/api/projects/cctq/auth/start').send({});
    const saved = await request(app).post('/api/projects/cctq/auth/save').send({
      sessionId: started.body.sessionId
    });

    expect(saved.status).toBe(201);
    expect(saved.body.path).toContain('default.storageState.json');
  });
});
