import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('按环境分别保存和查询登录态', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://www.cctq.ai'
    });
    await request(app).post('/api/projects/cctq/envs').send({
      name: '预发环境',
      key: 'pre',
      baseUrl: 'https://pre.cctq.ai'
    });

    const defaultSession = await request(app).post('/api/projects/cctq/auth/start').send({ envKey: 'default' });
    const preSession = await request(app).post('/api/projects/cctq/auth/start').send({ envKey: 'pre' });
    const defaultSaved = await request(app).post('/api/projects/cctq/auth/save').send({
      sessionId: defaultSession.body.sessionId
    });
    const preSaved = await request(app).post('/api/projects/cctq/auth/save').send({
      sessionId: preSession.body.sessionId
    });
    const defaultState = await request(app).get('/api/projects/cctq/auth/state').query({ envKey: 'default' });
    const preState = await request(app).get('/api/projects/cctq/auth/state').query({ envKey: 'pre' });

    expect(defaultSaved.body.path).toContain('default.storageState.json');
    expect(preSession.body.url).toBe('https://pre.cctq.ai');
    expect(preSaved.body.path).toContain('pre.storageState.json');
    expect(defaultState.body.exists).toBe(true);
    expect(preState.body.exists).toBe(true);
    expect(defaultState.body.path).toContain('default.storageState.json');
    expect(preState.body.path).toContain('pre.storageState.json');
  });

  it('登录会话过期后不能继续保存', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    try {
      const app = createApp();
      await request(app).post('/api/projects').send({
        name: 'CCTQ',
        key: 'cctq',
        baseUrl: 'https://www.cctq.ai'
      });

      const started = await request(app).post('/api/projects/cctq/auth/start').send({});
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000 + 1);
      const saved = await request(app).post('/api/projects/cctq/auth/save').send({
        sessionId: started.body.sessionId
      });

      expect(saved.status).toBe(400);
      expect(saved.body.message).toBe('登录会话不存在或已过期');
    } finally {
      vi.useRealTimers();
    }
  });
});
