import { chromium, type Locator, type Page } from '@playwright/test';
import type { ImportCaseSource, ImportDataSource, ImportStepSource } from '../../../shared/types';
import { buildStartUrl } from '../../../shared/url';
import { getProject } from '../lib/project-store';
import { getBrowserPath } from './browser-path';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { assertVendorBrowser } from './vendor-browser';

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
        tables: await readTables(page)
      },
      warnings: []
    };
  } finally {
    await browser.close();
  }
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
