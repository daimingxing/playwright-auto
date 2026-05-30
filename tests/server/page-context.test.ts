import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../server/src/lib/project-store';

const browserMocks = vi.hoisted(() => ({
  assertVendorBrowser: vi.fn(),
  getChromePath: vi.fn(() => 'C:/fake/chrome.exe'),
  launch: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  goto: vi.fn(),
  waitForFunction: vi.fn(),
  url: vi.fn(),
  title: vi.fn(),
  locator: vi.fn(),
  count: vi.fn(),
  allInnerTexts: vi.fn(),
  evaluateAll: vi.fn(),
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
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-context-'));
  process.env.DATA_ROOT = root;
  delete process.env.NODE_ENV;
  browserMocks.assertVendorBrowser.mockResolvedValue(undefined);
  browserMocks.launch.mockReset();
  browserMocks.newContext.mockReset();
  browserMocks.newPage.mockReset();
  browserMocks.goto.mockReset();
  browserMocks.waitForFunction.mockReset();
  browserMocks.url.mockReset();
  browserMocks.title.mockReset();
  browserMocks.locator.mockReset();
  browserMocks.count.mockReset();
  browserMocks.allInnerTexts.mockReset();
  browserMocks.evaluateAll.mockReset();
  browserMocks.close.mockReset();
  browserMocks.close.mockResolvedValue(undefined);
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('页面上下文采集', () => {
  it('domcontentloaded 超时但页面有可读内容时继续生成快照并记录 warning', async () => {
    const { collectPageContext } = await import('../../server/src/services/ai/page-context');
    await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
    browserMocks.goto.mockRejectedValue(new Error('page.goto: Timeout 30000ms exceeded'));
    browserMocks.waitForFunction.mockResolvedValue(undefined);
    browserMocks.url.mockReturnValue('https://crm.test.local/users');
    browserMocks.title.mockResolvedValue('用户列表');
    browserMocks.count.mockResolvedValue(0);
    browserMocks.allInnerTexts.mockResolvedValue([]);
    browserMocks.evaluateAll.mockResolvedValue([]);
    browserMocks.locator.mockReturnValue({
      count: browserMocks.count,
      allInnerTexts: browserMocks.allInnerTexts,
      evaluateAll: browserMocks.evaluateAll,
      first: () => ({
        isVisible: vi.fn().mockResolvedValue(false),
        getAttribute: vi.fn().mockResolvedValue(null),
        innerText: vi.fn().mockResolvedValue('')
      })
    });
    browserMocks.newPage.mockResolvedValue({
      goto: browserMocks.goto,
      waitForFunction: browserMocks.waitForFunction,
      url: browserMocks.url,
      title: browserMocks.title,
      locator: browserMocks.locator
    });
    browserMocks.newContext.mockResolvedValue({ newPage: browserMocks.newPage });
    browserMocks.launch.mockResolvedValue({
      newContext: browserMocks.newContext,
      close: browserMocks.close
    });

    const context = await collectPageContext({
      projectKey: 'crm',
      envKey: 'default',
      caseInfo: {
        caseNo: 'TC001',
        caseName: '用户列表',
        targetUrl: '/users',
        precondition: '',
        expectedResult: '',
        note: ''
      },
      steps: [],
      data: [],
      uiLibrary: 'native'
    });

    expect(context.page).toMatchObject({
      url: 'https://crm.test.local/users',
      title: '用户列表'
    });
    expect(context.warnings.join('\n')).toContain('domcontentloaded 等待超时');
    expect(browserMocks.waitForFunction).toHaveBeenCalled();
    expect(browserMocks.close).toHaveBeenCalledTimes(1);
  });
});
