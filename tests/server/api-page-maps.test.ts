import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { createPageMap, readPageMap, readPageMapShot, writePageMapShot } from '../../server/src/lib/page-map-store';
import { PageContextError } from '../../server/src/services/ai/page-context';
import type { PageMap } from '../../shared/types';

let root = '';
const mockState = vi.hoisted(() => ({
  failTargetUrl: ''
}));

vi.mock('../../server/src/services/ai/page-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/ai/page-context')>();

  return {
    ...actual,
    collectInitialPage: vi.fn(async (input) => {
      if (input.targetUrl === mockState.failTargetUrl) {
        throw new PageContextError(`目标页面不可访问：${input.targetUrl}。请检查目标页面URL是否写错，或页面是否存在。`);
      }

      return {
        page: {
          url: input.targetUrl,
          title: '刷新页面',
          headings: ['刷新页面']
        },
        elements: {
          buttons: [{ text: '新增', locator: "getByRole('button', { name: '新增' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      };
    })
  };
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-api-page-maps-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  mockState.failTargetUrl = '';
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('页面地图接口', () => {
  it('可列出、查看、刷新和删除页面地图', async () => {
    const app = createApp();
    const map = createMap({ updatedAt: '2026-05-27T00:00:00.000Z' });

    await createProject(app);
    await createPageMap(map);

    const list = await request(app).get('/api/projects/crm/page-maps');
    const detail = await request(app).get(`/api/projects/crm/page-maps/${map.mapId}`);
    const refreshed = await request(app).post(`/api/projects/crm/page-maps/${map.mapId}/refresh`);
    const removed = await request(app).delete(`/api/projects/crm/page-maps/${map.mapId}`);
    const nextList = await request(app).get('/api/projects/crm/page-maps');

    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({
      mapId: map.mapId,
      targetUrl: '/users',
      status: 'ready',
      stateCount: 1
    });
    expect(detail.status).toBe(200);
    expect(detail.body.states[0].name).toBe('初始页面');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.mapId).toBe(map.mapId);
    expect(refreshed.body.updatedAt).not.toBe(map.updatedAt);
    expect(removed.status).toBe(204);
    expect(nextList.body).toEqual([]);
  });

  it('删除不存在的页面地图时返回中文错误', async () => {
    const app = createApp();

    await createProject(app);

    const removed = await request(app).delete('/api/projects/crm/page-maps/pm-abc123abc123abcd');

    expect(removed.status).toBe(404);
    expect(removed.body.message).toBe('页面地图不存在');
  });

  it('刷新采集失败时返回错误且保留旧页面地图和 snapshot', async () => {
    const app = createApp();
    const map = createMap({ targetUrl: '/missing' });
    mockState.failTargetUrl = map.targetUrl;

    await createProject(app);
    await createPageMap(map);
    await writePageMapShot('crm', map.mapId, 'state-initial', {
      page: { url: map.targetUrl, title: '旧用户列表', headings: ['旧用户列表'] },
      elements: {
        buttons: [],
        inputs: [],
        selects: [],
        links: [],
        navigation: [],
        tables: []
      },
      warnings: ['旧快照']
    });

    const refreshed = await request(app).post(`/api/projects/crm/page-maps/${map.mapId}/refresh`);
    const saved = await readPageMap('crm', map.mapId);
    const shot = await readPageMapShot('crm', map.mapId, 'state-initial');

    expect(refreshed.status).toBe(400);
    expect(refreshed.body.message).toContain('页面地图刷新失败');
    expect(saved.status).toBe('ready');
    expect(saved.states).toHaveLength(1);
    expect(saved.updatedAt).toBe(map.updatedAt);
    expect(shot.page.title).toBe('旧用户列表');
    expect(shot.warnings).toEqual(['旧快照']);
  });
});

/**
 * 创建接口测试所需项目。
 */
async function createProject(app: ReturnType<typeof createApp>) {
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
}

/**
 * 创建页面地图接口测试数据。
 */
function createMap(patch: Partial<PageMap> = {}): PageMap {
  const now = '2026-05-28T00:00:00.000Z';

  return {
    mapId: 'pm-abc123abc123abcd',
    projectKey: 'crm',
    envKey: 'default',
    targetUrl: '/users',
    authHash: 'no-auth',
    viewport: {
      width: 1280,
      height: 720
    },
    status: 'ready',
    states: [
      {
        stateId: 'state-initial',
        name: '初始页面',
        url: '/users',
        title: '用户列表',
        snapshotPath: join(root, 'projects', 'crm', 'page-maps', 'pm-abc123abc123abcd', 'snapshots', 'state-initial.json'),
        warnings: [],
        createdAt: now
      }
    ],
    warnings: [],
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}
