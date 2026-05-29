import { chromium, type Locator, type Page } from '@playwright/test';
import type { ImportCaseSource, ImportDataSource, ImportStepSource, PageAction } from '../../../../shared/types';
import { buildStartUrl } from '../../../../shared/url';
import { getProject } from '../../lib/project-store';
import { getBrowserPath } from '../playwright/browser-path';
import { getProjectAuthPath, hasProjectAuth } from '../auth-session';
import { assertVendorBrowser } from '../playwright/vendor-browser';

export interface PageElement {
  text?: string;
  label?: string;
  placeholder?: string;
  locator: string;
  unique: boolean;
}

export interface TableElement {
  headers: string[];
  nearbyText: string;
}

export interface PageContext {
  page: {
    url: string;
    title: string;
    headings: string[];
  };
  elements: {
    buttons: PageElement[];
    inputs: PageElement[];
    selects: PageElement[];
    links: PageElement[];
    navigation: PageElement[];
    tables: TableElement[];
  };
  aria?: string;
  warnings: string[];
}

export interface CollectInput {
  projectKey: string;
  envKey: string;
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
}

export interface CollectPageInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
}

export interface CollectPageMapInput extends CollectPageInput {
  actions: PageAction[];
  timeoutMs: number;
}

export interface CollectedPageState {
  action?: PageAction;
  context: PageContext;
}

interface PageMapRunner {
  setDefaultTimeout(timeoutMs: number): void;
  open(targetUrl: string, timeoutMs: number): Promise<void>;
  snapshot(warnings: string[]): Promise<PageContext>;
  action(action: PageAction): Promise<void>;
  stable(timeoutMs: number, warnings: string[]): Promise<void>;
  close(): Promise<void>;
}

type PageMapRunnerFactory = (input: CollectPageMapInput) => Promise<PageMapRunner>;

interface PageResponse {
  url(): string;
  status(): number;
  statusText(): string;
}

export class PageContextError extends Error {
  /**
   * 创建页面上下文采集中断错误。
   */
  constructor(message: string) {
    super(message);
    this.name = 'PageContextError';
  }
}

const maxItems = 20;
const maxText = 80;
const readyTimeoutMs = 12000;
const minReadyTextLength = 50;
let pageMapRunnerFactory: PageMapRunnerFactory | undefined;

/**
 * 注入页面地图执行器，供测试用最小接口覆盖动作循环。
 */
export function setPageMapRunner(factory: PageMapRunnerFactory | undefined) {
  pageMapRunnerFactory = factory;
}

/**
 * 采集目标页面上下文摘要。
 */
export async function collectPageContext(input: CollectInput): Promise<PageContext> {
  if (process.env.NODE_ENV === 'test') {
    return createTestContext(input.caseInfo);
  }

  const project = await getProject(input.projectKey);
  const env = project.envs.find((item) => item.key === input.envKey);
  const baseUrl = env?.baseUrl ?? project.envs.find((item) => item.key === project.defaultEnv)?.baseUrl ?? '';

  await assertVendorBrowser();

  const browser = await chromium.launch({
    headless: true,
    executablePath: getBrowserPath()
  });
  const storageState = (await hasProjectAuth(input.projectKey, input.envKey)) ? getProjectAuthPath(input.projectKey, input.envKey) : undefined;
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();

  try {
    const targetUrl = buildStartUrl(baseUrl, input.caseInfo.targetUrl);
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    assertPageAvailable(response, targetUrl);
    const warnings: string[] = [];

    await waitForPageReady(page, warnings);

    // 必须等待快照读取完成后再进入 finally 关闭浏览器，否则真实页面读取标题或元素时会遇到页面已关闭。
    return await readPageSnapshot(page, warnings);
  } finally {
    await browser.close();
  }
}

/**
 * 按页面地址采集初始页面上下文。
 */
export async function collectInitialPage(input: CollectPageInput): Promise<PageContext> {
  return collectPageContext({
    projectKey: input.projectKey,
    envKey: input.envKey,
    caseInfo: {
      caseNo: 'PAGE-MAP',
      caseName: '初始页面',
      targetUrl: input.targetUrl,
      precondition: '',
      expectedResult: '',
      note: ''
    },
    steps: [],
    data: []
  });
}

/**
 * 采集初始页面以及安全探索动作后的多状态页面上下文。
 */
export async function collectPageMapStates(input: CollectPageMapInput): Promise<{ states: CollectedPageState[]; warnings: string[] }> {
  const runner = await createPageMapRunner(input);
  const states: CollectedPageState[] = [];
  const warnings: string[] = [];

  runner.setDefaultTimeout(input.timeoutMs);

  try {
    await runner.open(input.targetUrl, input.timeoutMs);
    states.push({ context: await runner.snapshot([...warnings]) });

    for (const action of input.actions) {
      const actionWarnings: string[] = [];

      try {
        await runner.action(action);
        await runner.stable(input.timeoutMs, actionWarnings);
        states.push({ action, context: await runner.snapshot(actionWarnings) });
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        const warning = `探索动作失败：${action.targetName}。${message}`;

        warnings.push(warning);
        states.push({ action, context: createFailedState(states, action, warning) });
      }
    }

    return { states, warnings };
  } finally {
    await runner.close();
  }
}

/**
 * 创建页面地图执行器，测试环境可注入轻量实现避免真实浏览器。
 */
async function createPageMapRunner(input: CollectPageMapInput): Promise<PageMapRunner> {
  if (pageMapRunnerFactory) {
    return pageMapRunnerFactory(input);
  }

  if (process.env.NODE_ENV === 'test') {
    return createTestRunner(input);
  }

  return createBrowserRunner(input);
}

/**
 * 创建真实浏览器执行器。
 */
async function createBrowserRunner(input: CollectPageMapInput): Promise<PageMapRunner> {
  const project = await getProject(input.projectKey);
  const env = project.envs.find((item) => item.key === input.envKey);
  const baseUrl = env?.baseUrl ?? project.envs.find((item) => item.key === project.defaultEnv)?.baseUrl ?? '';

  await assertVendorBrowser();

  const browser = await chromium.launch({
    headless: true,
    executablePath: getBrowserPath()
  });
  const storageState = (await hasProjectAuth(input.projectKey, input.envKey)) ? getProjectAuthPath(input.projectKey, input.envKey) : undefined;
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();

  return {
    setDefaultTimeout(timeoutMs) {
      page.setDefaultTimeout(timeoutMs);
    },
    async open(targetUrl, timeoutMs) {
      const url = buildStartUrl(baseUrl, targetUrl);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

      assertPageAvailable(response, url);
      await waitForPageReady(page);
    },
    snapshot(warnings) {
      return readPageSnapshot(page, warnings);
    },
    action(action) {
      return runPageAction(page, action);
    },
    stable(timeoutMs, warnings) {
      return waitForActionStable(page, timeoutMs, warnings);
    },
    close() {
      return browser.close();
    }
  };
}

/**
 * 创建测试环境默认执行器，保留动作循环但不启动浏览器。
 */
function createTestRunner(input: CollectPageMapInput): PageMapRunner {
  let title = '初始页面';
  let url = input.targetUrl;

  return {
    setDefaultTimeout() {},
    async open() {},
    async snapshot(warnings) {
      const context = createTestContext({ caseNo: 'PAGE-MAP', caseName: title, targetUrl: url, precondition: '', expectedResult: '', note: '' });

      return { ...context, warnings };
    },
    async action(action) {
      title = `${action.targetName}后页面`;
      url = `${input.targetUrl}#${action.id}`;
    },
    async stable() {},
    async close() {}
  };
}

/**
 * 创建探索失败的诊断状态，确保失败动作也能回溯来源。
 */
function createFailedState(states: CollectedPageState[], action: PageAction, warning: string): PageContext {
  const lastContext = states[states.length - 1]?.context;
  const baseContext = lastContext ?? createTestContext({ caseNo: 'PAGE-MAP', caseName: '初始页面', targetUrl: '', precondition: '', expectedResult: '', note: '' });

  return {
    ...baseContext,
    page: {
      ...baseContext.page,
      title: `${action.targetName}探索失败`
    },
    warnings: [...baseContext.warnings, warning]
  };
}

/**
 * 等待 SPA 页面渲染出可供 AI 使用的可见内容。
 */
export async function waitForPageReady(page: Page, warnings: string[] = []) {
  try {
    await page.waitForFunction(
      (minLength) => {
        const bodyText = document.body?.innerText?.trim() ?? '';
        const title = document.title.trim();
        const visibleCount = Array.from(document.querySelectorAll(
          'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],.el-menu-item,.el-sub-menu__title'
        )).filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).length;
        const hasBusinessTitle = title !== 'Vite App';
        const hasEnoughText = bodyText.length >= minLength;

        // 很多 Vite/Vue 页面在 domcontentloaded 时只有空壳，需要等真实业务文本或交互元素出现。
        return hasBusinessTitle && (hasEnoughText || visibleCount > 0);
      },
      minReadyTextLength,
      { timeout: readyTimeoutMs }
    );
  } catch {
    warnings.push(await buildPageReadyWarning(page));
  }
}

/**
 * 构造页面等待超时诊断信息。
 */
async function buildPageReadyWarning(page: Page) {
  const info = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.trim() ?? '';
    const visibleCount = Array.from(document.querySelectorAll(
      'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],.el-menu-item,.el-sub-menu__title'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length;

    return {
      title: document.title || '',
      bodyLength: bodyText.length,
      visibleCount,
      url: location.href
    };
  }).catch(() => ({ title: '', bodyLength: 0, visibleCount: 0, url: page.url() }));

  return `页面在等待后仍未达到业务可读状态，可能未登录、页面渲染失败或目标 URL 不正确。当前标题：${info.title || '空'}；正文长度：${info.bodyLength}；可见元素数：${info.visibleCount}；URL：${info.url}`;
}

/**
 * 执行单个页面地图安全探索动作。
 */
async function runPageAction(page: Page, action: PageAction) {
  const locator = getActionLocator(page, action);

  if (action.type === 'hover') {
    await locator.hover();
    return;
  }

  if (action.type === 'select' && action.value) {
    if (await locator.evaluate((element) => element.tagName.toLowerCase() === 'select').catch(() => false)) {
      await locator.selectOption({ label: action.value });
      return;
    }

    await locator.click();
    await page.getByText(action.value, { exact: true }).click();
    return;
  }

  await locator.click();
}

/**
 * 等待动作后的页面进入可读状态。
 */
async function waitForActionStable(page: Page, timeoutMs: number, warnings: string[]) {
  try {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
  } catch {
    warnings.push('探索动作后页面网络未在限定时间内完全空闲，已继续读取当前可见内容。');
  }

  await waitForPageReady(page, warnings);
}

/**
 * 根据动作类型创建最小可用定位器。
 */
function getActionLocator(page: Page, action: PageAction) {
  if (action.selector) {
    // selector 来自后续扩展的确定性定位器时直接使用，当前安全动作默认走语义定位。
    return page.locator(action.selector).first();
  }

  const name = action.targetName;

  if (action.targetType === 'tab') {
    return page.getByRole('tab', { name }).first();
  }

  if (action.targetType === 'menu') {
    return page.getByRole('menuitem', { name }).or(page.getByText(name, { exact: true })).first();
  }

  if (action.targetType === 'select') {
    return page.getByLabel(name).or(page.getByText(name, { exact: true })).first();
  }

  if (action.targetType === 'button') {
    return page.getByRole('button', { name }).or(page.locator('button,[role="button"],input[type="button"],input[type="submit"]').filter({ hasText: name })).first();
  }

  if (action.targetType === 'input') {
    return page.getByLabel(name).or(page.getByPlaceholder(name)).first();
  }

  if (action.targetType === 'dialog') {
    return page.getByRole('button', { name }).or(page.getByText(name, { exact: true })).first();
  }

  return page.getByText(name, { exact: true }).first();
}

/**
 * 读取当前页面的压缩上下文快照。
 */
export async function readPageSnapshot(page: Page, warnings: string[] = []): Promise<PageContext> {
  return {
    page: {
      url: page.url(),
      title: await page.title(),
      headings: await readTexts(page.locator('h1,h2,h3,[role="heading"]'))
    },
    elements: {
      buttons: await readButtons(page),
      inputs: await readInputs(page),
      selects: await readSelects(page),
      links: await readLinks(page),
      navigation: await readNavigation(page),
      tables: await readTables(page)
    },
    warnings
  };
}

/**
 * 确认目标页面真实可访问。
 */
export function assertPageAvailable(response: PageResponse | null, targetUrl: string) {
  if (!response) {
    throw new PageContextError(`目标页面不可访问：${targetUrl}。未收到页面响应，请检查目标页面URL是否写错，或页面是否存在。`);
  }

  const status = response.status();

  // HTTP 400 及以上表示客户端或服务端错误，不能把错误页上下文交给 AI 继续生成。
  if (status >= 400) {
    const reason = response.statusText() ? ` ${response.statusText()}` : '';

    throw new PageContextError(`目标页面不可访问：${response.url()}（HTTP ${status}${reason}）。请检查目标页面URL是否写错，或页面是否存在。`);
  }
}

/**
 * 读取按钮元素摘要。
 */
async function readButtons(page: Page) {
  const items = await readTexts(page.locator('button,[role="button"],input[type="button"],input[type="submit"]'));
  const candidates = items.map((text) => ({
    text,
    locator: `getByRole('button', { name: '${escapeText(text)}' })`
  }));
  const counts = await Promise.all(items.map((text) => page.getByRole('button', { name: text }).count()));

  return resolveUnique(candidates, counts);
}

/**
 * 读取输入框元素摘要。
 */
async function readInputs(page: Page) {
  return readAttrs(page, page.locator('input,textarea'), 'placeholder', 'getByPlaceholder');
}

/**
 * 读取下拉框元素摘要。
 */
async function readSelects(page: Page) {
  return readAttrs(page, page.locator('select'), 'aria-label', 'getByLabel');
}

/**
 * 读取链接元素摘要。
 */
async function readLinks(page: Page) {
  const items = await readTexts(page.locator('a'));
  const candidates = items.map((text) => ({
    text,
    locator: `getByText('${escapeText(text)}')`
  }));
  const counts = await Promise.all(items.map((text) => page.getByText(text).count()));

  return resolveUnique(candidates, counts);
}

/**
 * 读取导航和菜单元素摘要。
 */
async function readNavigation(page: Page) {
  const items = uniqueTexts(await readTexts(page.locator('[role="menuitem"],nav a,aside a,.el-menu-item,.el-sub-menu__title,.el-menu a')));
  const candidates = items.map((text) => ({
    text,
    locator: `getByText('${escapeText(text)}', { exact: true })`
  }));
  const counts = await Promise.all(items.map((text) => page.getByText(text, { exact: true }).count()));

  return resolveUnique(candidates, counts);
}

/**
 * 读取表格元素摘要。
 */
async function readTables(page: Page): Promise<TableElement[]> {
  const rows = await page.locator('table').evaluateAll((tables) =>
    tables.slice(0, 5).map((table) => ({
      headers: Array.from(table.querySelectorAll('th')).slice(0, 10).map((item) => item.textContent?.trim() ?? '').filter(Boolean),
      nearbyText: table.parentElement?.textContent?.trim().slice(0, 120) ?? ''
    }))
  );

  return rows;
}

/**
 * 读取可见元素文本。
 */
async function readTexts(locator: Locator) {
  const values: string[] = [];
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await item.textContent().catch(() => ''));

    if (text) {
      values.push(text);
    }
  }

  return values;
}

/**
 * 读取元素属性并生成语义定位候选。
 */
async function readAttrs(page: Page, locator: Locator, attrName: string, methodName: 'getByPlaceholder' | 'getByLabel'): Promise<PageElement[]> {
  const values: Array<Omit<PageElement, 'unique'>> = [];
  const counts: number[] = [];
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await item.getAttribute(attrName));

    if (text) {
      values.push({
        placeholder: attrName === 'placeholder' ? text : undefined,
        label: attrName !== 'placeholder' ? text : undefined,
        locator: `${methodName}('${escapeText(text)}')`
      });
      counts.push(await countAttrLocator(page, methodName, text));
    }
  }

  return resolveUnique(values, counts);
}

/**
 * 根据现场匹配数量标记候选定位器唯一性。
 */
export function resolveUnique<T extends Omit<PageElement, 'unique'>>(items: T[], counts: number[]) {
  return items.map((item, index) => ({
    ...item,
    unique: counts[index] === 1
  }));
}

/**
 * 创建测试环境固定页面上下文。
 */
function createTestContext(caseInfo: ImportCaseSource): PageContext {
  return {
    page: {
      url: caseInfo.targetUrl,
      title: caseInfo.caseName,
      headings: [caseInfo.caseName]
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
}

/**
 * 规范化页面文本。
 */
function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxText);
}

/**
 * 按文本内容去重，避免 Element Plus 菜单多层 DOM 输出重复菜单名。
 */
function uniqueTexts(values: string[]) {
  return Array.from(new Set(values));
}

/**
 * 统计属性语义定位器的现场匹配数量。
 */
function countAttrLocator(page: Page, methodName: 'getByPlaceholder' | 'getByLabel', text: string) {
  if (methodName === 'getByPlaceholder') {
    return page.getByPlaceholder(text).count();
  }

  return page.getByLabel(text).count();
}

/**
 * 转义定位文本中的单引号。
 */
function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
