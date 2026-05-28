import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageContextError } from '../../server/src/services/ai/page-context';

let root = '';
let failMessage = '';
let collectCount = 0;

vi.mock('../../server/src/services/ai/page-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/ai/page-context')>();

  return {
    ...actual,
    collectInitialPage: vi.fn(async (input) => {
      collectCount += 1;

      if (failMessage) {
        throw new PageContextError(failMessage);
      }

      return {
        page: {
          url: input.targetUrl,
          title: '初始页面',
          headings: ['初始页面']
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
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-map-service-'));
  process.env.DATA_ROOT = root;
  failMessage = '';
  collectCount = 0;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  await rm(root, { recursive: true, force: true });
});

describe('页面地图业务编排', () => {
  it('无缓存时创建页面地图并保存初始页面 snapshot', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30
    });

    expect(map.status).toBe('ready');
    expect(map.states[0]).toMatchObject({ name: '初始页面', title: '初始页面' });
    expect(map.states[0]).not.toHaveProperty('sourceAction');
    expect(existsSync(map.states[0].snapshotPath)).toBe(true);
  });

  it('targetUrl 去掉首尾空白后复用同一份缓存', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const first = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: ' /users ',
      viewport: { width: 1280, height: 720 },
      staleDays: 30
    });
    const second = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30
    });

    expect(second.mapId).toBe(first.mapId);
  });

  it('超过配置天数后标记 stale 且不删除缓存文件', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');
    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 1,
      now: new Date('2026-04-01T00:00:00.000Z')
    });

    const stale = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 1,
      now: new Date('2026-04-03T00:00:01.000Z')
    });

    expect(stale.status).toBe('stale');
    expect(stale.warnings.join('\n')).toContain('建议刷新');
    expect(existsSync(join(root, 'projects', 'crm', 'page-maps', map.mapId, 'map.json'))).toBe(true);
  });

  it('页面不可访问时创建 failed 页面地图并写入可读 warning', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');
    failMessage = '目标页面不可访问：/missing（HTTP 404 Not Found）。请检查目标页面URL是否写错，或页面是否存在。';

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/missing',
      viewport: { width: 1280, height: 720 },
      staleDays: 30
    });

    expect(map.status).toBe('failed');
    expect(map.warnings.join('\n')).toContain('目标页面不可访问');
    expect(map.warnings.join('\n')).toContain('页面是否存在');
  });

  it('关闭自动创建且无缓存时不采集也不写入页面地图', async () => {
    const configPath = join(root, 'playwright-auto.config.json');
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        configPath,
        JSON.stringify({
          ai: {
            pageMap: {
              autoCreate: false
            }
          }
        })
      )
    );
    process.env.PLAYWRIGHT_AUTO_CONFIG = configPath;
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      now: new Date('2026-05-28T00:00:00.000Z')
    });

    expect(map.status).toBe('failed');
    expect(map.warnings.join('\n')).toContain('页面地图缓存不存在，且已关闭自动创建');
    expect(map.states).toEqual([]);
    expect(collectCount).toBe(0);
    expect(existsSync(join(root, 'projects', 'crm', 'page-maps', map.mapId, 'map.json'))).toBe(false);
    expect(existsSync(join(root, 'projects', 'crm', 'page-maps', map.mapId, 'snapshots'))).toBe(false);
  });
});
