import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../../server/src/lib/http-error';
import type { PageMap } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-map-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('页面地图缓存键与路径', () => {
  it('相同缓存键生成相同页面地图标识', async () => {
    const { createPageMapKey, createPageMapId } = await import('../../server/src/lib/path');
    const input = {
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: 'https://example.com/users',
      authHash: 'no-auth',
      viewport: { width: 1280, height: 720 }
    };

    expect(createPageMapId(createPageMapKey(input))).toBe(createPageMapId(createPageMapKey(input)));
  });

  it('登录态、视口和环境变化会生成不同页面地图标识', async () => {
    const { createPageMapKey, createPageMapId } = await import('../../server/src/lib/path');
    const base = {
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: 'https://example.com/users',
      authHash: 'no-auth',
      viewport: { width: 1280, height: 720 }
    };
    const baseId = createPageMapId(createPageMapKey(base));

    expect(createPageMapId(createPageMapKey({ ...base, authHash: 'auth-1' }))).not.toBe(baseId);
    expect(createPageMapId(createPageMapKey({ ...base, envKey: 'pre' }))).not.toBe(baseId);
    expect(createPageMapId(createPageMapKey({ ...base, viewport: { width: 390, height: 844 } }))).not.toBe(baseId);
  });

  it('没有登录态时使用明确的 no-auth 值', async () => {
    const { getAuthHash } = await import('../../server/src/lib/path');

    await mkdir(join(root, 'projects', 'crm'), { recursive: true });

    await expect(getAuthHash('crm', 'default')).resolves.toBe('no-auth');
  });

  it('登录态文件变化会生成不同登录态摘要', async () => {
    const { getAuthHash } = await import('../../server/src/lib/path');
    const authPath = join(root, 'projects', 'crm', 'auth', 'default.storageState.json');

    await mkdir(join(root, 'projects', 'crm', 'auth'), { recursive: true });
    await writeFile(authPath, '{"cookies":[]}', 'utf8');
    const firstHash = await getAuthHash('crm', 'default');
    await writeFile(authPath, '{"cookies":[{"name":"sid","value":"1"}]}', 'utf8');
    const secondHash = await getAuthHash('crm', 'default');

    expect(secondHash).not.toBe(firstHash);
  });

  it('生成页面地图文件和快照文件路径', async () => {
    const { getPageMapFile, getPageMapShotFile } = await import('../../server/src/lib/path');
    const mapId = 'pm-abc123abc123abcd';

    expect(getPageMapFile('crm', mapId)).toBe(join(root, 'projects', 'crm', 'page-maps', mapId, 'map.json'));
    expect(getPageMapShotFile('crm', mapId, 'state-001')).toBe(
      join(root, 'projects', 'crm', 'page-maps', mapId, 'snapshots', 'state-001.json')
    );
  });

  it('非法页面地图标识会被拒绝', async () => {
    const { getPageMapFile } = await import('../../server/src/lib/path');

    expect(() => getPageMapFile('crm', 'https://example.com')).toThrow(HttpError);
  });

  it('非法页面状态标识会被拒绝', async () => {
    const { getPageMapShotFile } = await import('../../server/src/lib/path');

    expect(() => getPageMapShotFile('crm', 'pm-abc123abc123abcd', '../state')).toThrow(HttpError);
  });

  it('目标 URL 去掉首尾空白后生成相同页面地图标识', async () => {
    const { createPageMapKey, createPageMapId } = await import('../../server/src/lib/path');
    const base = {
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: 'https://example.com/users',
      authHash: 'no-auth',
      viewport: { width: 1280, height: 720 }
    };

    expect(createPageMapId(createPageMapKey({ ...base, targetUrl: '  https://example.com/users  ' }))).toBe(
      createPageMapId(createPageMapKey(base))
    );
  });
});

describe('页面地图文件持久化', () => {
  it('创建页面地图后能读取摘要和初始 snapshot', async () => {
    const { createPageMap, readPageMap, readPageMapShot, writePageMapShot } = await import('../../server/src/lib/page-map-store');
    const map = createMap();

    await createPageMap(map);
    await writePageMapShot('crm', map.mapId, 'state-initial', {
      page: { url: map.targetUrl, title: '用户列表', headings: ['用户列表'] },
      elements: {
        buttons: [],
        inputs: [],
        selects: [],
        links: [],
        navigation: [],
        tables: []
      },
      warnings: []
    });

    const saved = await readPageMap('crm', map.mapId);
    const shot = await readPageMapShot('crm', map.mapId, 'state-initial');

    expect(saved.states[0]).toMatchObject({
      stateId: 'state-initial',
      name: '初始页面'
    });
    expect(shot.page.title).toBe('用户列表');
  });

  it('超过配置天数后只标记 stale，不删除页面地图文件', async () => {
    const { createPageMap, markPageMapStale, readPageMap } = await import('../../server/src/lib/page-map-store');
    const map = createMap({
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z'
    });

    await createPageMap(map);
    await markPageMapStale('crm', map.mapId, '页面地图已超过 1 天，建议刷新后再使用。');

    const saved = await readPageMap('crm', map.mapId);

    expect(saved.status).toBe('stale');
    expect(saved.warnings).toContain('页面地图已超过 1 天，建议刷新后再使用。');
    await expect(stat(join(root, 'projects', 'crm', 'page-maps', map.mapId, 'map.json'))).resolves.toBeTruthy();
  });
});

/**
 * 创建页面地图测试数据。
 */
function createMap(patch: Partial<PageMap> = {}): PageMap {
  const now = '2026-05-28T00:00:00.000Z';

  return {
    mapId: 'pm-abc123abc123abcd',
    projectKey: 'crm',
    envKey: 'default',
    targetUrl: 'https://example.com/users',
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
        url: 'https://example.com/users',
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
