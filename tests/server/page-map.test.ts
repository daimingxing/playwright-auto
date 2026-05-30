import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageMapShot } from '../../server/src/lib/page-map-store';
import { PageContextError, setPageMapRunner } from '../../server/src/services/ai/page-context';

let root = '';
let failMessage = '';
let collectCount = 0;
let failActionName = '';
let openedTimeouts: number[] = [];
let defaultTimeouts: number[] = [];
let stableTimeouts: number[] = [];

function createContext(title: string, url = '/users') {
  return {
    page: {
      url,
      title,
      headings: [title]
    },
    elements: {
      buttons: [{ text: '新增', locator: "getByRole('button', { name: '新增' })", unique: true }],
      inputs: [],
      selects: [],
      links: [],
      navigation: [{ text: '系统管理', locator: "getByText('系统管理', { exact: true })", unique: true }],
      tables: []
    },
    warnings: []
  };
}

vi.mock('../../server/src/services/ai/page-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/ai/page-context')>();

  return {
    ...actual,
    collectInitialPage: vi.fn(async (input) => {
      collectCount += 1;

      if (failMessage) {
        throw new PageContextError(failMessage);
      }

      return createContext('初始页面', input.targetUrl);
    })
  };
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-map-service-'));
  process.env.DATA_ROOT = root;
  failMessage = '';
  collectCount = 0;
  failActionName = '';
  openedTimeouts = [];
  defaultTimeouts = [];
  stableTimeouts = [];
  setPageMapRunner(async (input) => {
    let title = '初始页面';
    let url = input.targetUrl;

    return {
      async open(_targetUrl, timeoutMs, warnings) {
        collectCount += 1;
        openedTimeouts.push(timeoutMs);

        if (failMessage) {
          throw new PageContextError(failMessage);
        }
      },
      async snapshot(warnings) {
        return {
          ...createContext(title, url),
          warnings
        };
      },
      async action(action) {
        if (action.targetName === failActionName) {
          throw new Error('模拟失败');
        }

        title = `${action.targetName}后页面`;
        url = `${input.targetUrl}#${action.id}`;
      },
      async stable() {
        stableTimeouts.push(5000);
      },
      async close() {}
    };
  });
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  setPageMapRunner(undefined);
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

  it('生成页面地图时把 Kendo 字段语义写入状态 snapshot', async () => {
    setPageMapRunner(async (input) => ({
      async open() {
        collectCount += 1;
      },
      async snapshot(warnings) {
        return {
          ...createContext('取样规则管理', input.targetUrl),
          fields: [createKendoField('取样类别')],
          warnings
        };
      },
      async action() {},
      async stable() {},
      async close() {}
    }));
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/web/IMQM07',
      viewport: { width: 1280, height: 720 },
      uiLibrary: 'kendo',
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });
    const snapshot = await readPageMapShot('crm', map.mapId, map.states[0].stateId);

    expect(map.status).toBe('ready');
    expect(snapshot.fields?.[0]).toMatchObject({
      name: '取样类别',
      type: 'select',
      ui: 'kendo-dropdownlist',
      value: '---请选择---',
      source: 'label-container',
      confidence: 'high'
    });
    expect(snapshot.fields?.[0].locators[0]).toMatchObject({
      selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
      unique: true,
      confidence: 'high'
    });
  });

  it('页面地图初始打开超时时保留快照并记录 warning', async () => {
    setPageMapRunner(async (input) => ({
      async open(_targetUrl, _timeoutMs, warnings) {
        collectCount += 1;
        warnings.push('domcontentloaded 等待超时，已继续尝试读取当前页面快照：模拟超时');
      },
      async snapshot(warnings) {
        return {
          ...createContext('用户列表', input.targetUrl),
          warnings
        };
      },
      async action() {},
      async stable() {},
      async close() {}
    }));
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.status).toBe('ready');
    expect(map.warnings.join('\n')).toContain('domcontentloaded 等待超时');
    expect(map.states[0].warnings.join('\n')).toContain('domcontentloaded 等待超时');
  });

  it('页面地图初始打开超时且快照为空时生成 failed 地图', async () => {
    setPageMapRunner(async (input) => ({
      async open(_targetUrl, _timeoutMs, warnings) {
        collectCount += 1;
        warnings.push('domcontentloaded 等待超时，已继续尝试读取当前页面快照：模拟超时');
      },
      async snapshot(warnings) {
        return {
          page: {
            url: input.targetUrl,
            title: 'Vite App',
            headings: []
          },
          elements: {
            buttons: [],
            inputs: [],
            selects: [],
            links: [],
            navigation: [],
            tables: []
          },
          fields: [],
          warnings
        };
      },
      async action() {},
      async stable() {},
      async close() {}
    }));
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/blank',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.status).toBe('failed');
    expect(map.states).toEqual([]);
    expect(map.warnings.join('\n')).toContain('页面地图初始快照不可用');
    expect(map.warnings.join('\n')).toContain('domcontentloaded 等待超时');
  });

  it('根据安全动作生成初始状态和探索后的页面状态', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.status).toBe('ready');
    expect(map.states).toHaveLength(2);
    expect(map.states[1]).toMatchObject({
      stateId: 'state-action-1',
      name: '系统管理后页面',
      sourceAction: {
        id: 'action-1',
        targetName: '系统管理'
      }
    });
    expect(existsSync(map.states[1].snapshotPath)).toBe(true);
  });

  it('页面地图采集打开目标 URL 使用 browser.openTimeoutMs', async () => {
    const configPath = join(root, 'playwright-auto.config.json');
    await mkdir(root, { recursive: true });
    await writeFile(configPath, JSON.stringify({ browser: { openTimeoutMs: 45000 } }), 'utf8');
    process.env.PLAYWRIGHT_AUTO_CONFIG = configPath;
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.status).toBe('ready');
    expect(openedTimeouts).toEqual([45000]);
    expect(defaultTimeouts).toEqual([]);
    expect(stableTimeouts).not.toContain(45000);
  });

  it('危险动作只记录 warning，不生成探索状态', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'button',
          targetName: '保存',
          actionText: '点击保存',
          targetText: '保存按钮',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.states).toHaveLength(1);
    expect(map.warnings).toContain('已跳过危险动作：保存');
  });

  it('探索失败时保留已有状态并继续生成可用页面地图', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');
    failActionName = '高级筛选弹窗';

    const map = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        },
        {
          caseNo: 'TC001',
          stepNo: 2,
          actionType: 'click',
          targetType: 'dialog',
          targetName: '高级筛选弹窗',
          actionText: '打开高级筛选弹窗',
          targetText: '高级筛选弹窗',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(map.status).toBe('ready');
    expect(map.states.map((state) => state.name)).toEqual(['初始页面', '系统管理后页面', '高级筛选弹窗探索失败']);
    expect(map.warnings.join('\n')).toContain('探索动作失败：高级筛选弹窗');
    expect(map.states[2]).toMatchObject({
      sourceAction: {
        id: 'action-2',
        targetName: '高级筛选弹窗'
      },
      warnings: [expect.stringContaining('探索动作失败：高级筛选弹窗')]
    });
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

  it('同一页面的探索动作变化时不复用旧页面地图缓存', async () => {
    const { getPageMap } = await import('../../server/src/services/ai/page-map');

    const initial = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30
    });
    const withAction = await getPageMap({
      projectKey: 'crm',
      envKey: 'default',
      targetUrl: '/users',
      viewport: { width: 1280, height: 720 },
      staleDays: 30,
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'click',
          targetType: 'menu',
          targetName: '系统管理',
          actionText: '点击系统管理',
          targetText: '系统管理菜单',
          dataKeys: [],
          note: ''
        }
      ]
    });

    expect(withAction.mapId).not.toBe(initial.mapId);
    expect(withAction.actionHash).toMatch(/^actions-/);
    expect(withAction.states.map((state) => state.name)).toEqual(['初始页面', '系统管理后页面']);
    expect(collectCount).toBe(2);
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

/**
 * 创建页面地图测试用 Kendo 字段语义。
 */
function createKendoField(name: string) {
  return {
    name,
    type: 'select' as const,
    ui: 'kendo-dropdownlist',
    value: '---请选择---',
    locators: [
      {
        selector: `locator('.xr-fc').filter({ hasText: '${name}' }).locator('.k-dropdownlist')`,
        kind: 'field-container' as const,
        unique: true,
        confidence: 'high' as const,
        reason: '字段名来自同一字段容器内的 label'
      }
    ],
    source: 'label-container' as const,
    confidence: 'high' as const
  };
}
