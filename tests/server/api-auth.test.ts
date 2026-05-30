import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';

const browserMocks = vi.hoisted(() => ({
  assertVendorBrowser: vi.fn(),
  getChromePath: vi.fn(() => 'C:/fake/chrome.exe'),
  launch: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  goto: vi.fn(),
  storageState: vi.fn(),
  close: vi.fn()
}));

vi.mock('@playwright/test', () => ({
  chromium: {
    launch: browserMocks.launch
  }
}));

vi.mock('../../server/src/services/playwright/vendor-browser', () => ({
  assertVendorBrowser: browserMocks.assertVendorBrowser,
  getChromePath: browserMocks.getChromePath
}));

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-auth-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  browserMocks.assertVendorBrowser.mockResolvedValue(undefined);
  browserMocks.getChromePath.mockReturnValue('C:/fake/chrome.exe');
  browserMocks.launch.mockReset();
  browserMocks.newContext.mockReset();
  browserMocks.newPage.mockReset();
  browserMocks.goto.mockReset();
  browserMocks.storageState.mockReset();
  browserMocks.close.mockReset();
  browserMocks.close.mockResolvedValue(undefined);
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
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

  it('目标页面打开超时后仍可以保存登录会话', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://slow.cctq.ai'
    });
    browserMocks.storageState.mockResolvedValue(undefined);
    browserMocks.goto.mockRejectedValue(new Error('page.goto: Timeout 30000ms exceeded'));
    browserMocks.newPage.mockResolvedValue({ goto: browserMocks.goto });
    browserMocks.newContext.mockResolvedValue({
      newPage: browserMocks.newPage,
      storageState: browserMocks.storageState
    });
    browserMocks.launch.mockResolvedValue({
      newContext: browserMocks.newContext,
      close: browserMocks.close
    });

    const started = await request(app).post('/api/projects/cctq/auth/start').send({});
    const saved = await request(app).post('/api/projects/cctq/auth/save').send({
      sessionId: started.body.sessionId
    });

    expect(started.status).toBe(201);
    expect(started.body.sessionId).toBeTruthy();
    expect(saved.status).toBe(201);
    expect(browserMocks.storageState).toHaveBeenCalledWith({
      path: expect.stringContaining('default.storageState.json')
    });
    expect(browserMocks.close).toHaveBeenCalledTimes(1);
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
