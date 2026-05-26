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
    await page.goto(buildStartUrl(baseUrl, input.caseInfo.targetUrl), { waitUntil: 'domcontentloaded' });

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
 * 读取按钮元素摘要。
 */
async function readButtons(page: Page) {
  const items = await readTexts(page.locator('button,[role="button"],input[type="button"],input[type="submit"]'));

  return items.map((text) => ({
    text,
    locator: `getByRole('button', { name: '${escapeText(text)}' })`,
    unique: true
  }));
}

/**
 * 读取输入框元素摘要。
 */
async function readInputs(page: Page) {
  return readAttrs(page.locator('input,textarea'), 'placeholder', 'getByPlaceholder');
}

/**
 * 读取下拉框元素摘要。
 */
async function readSelects(page: Page) {
  return readAttrs(page.locator('select'), 'aria-label', 'getByLabel');
}

/**
 * 读取链接元素摘要。
 */
async function readLinks(page: Page) {
  const items = await readTexts(page.locator('a'));

  return items.map((text) => ({
    text,
    locator: `getByText('${escapeText(text)}')`,
    unique: true
  }));
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
async function readAttrs(locator: Locator, attrName: string, methodName: string): Promise<PageElement[]> {
  const values: PageElement[] = [];
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
        locator: `${methodName}('${escapeText(text)}')`,
        unique: true
      });
    }
  }

  return values;
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
 * 转义定位文本中的单引号。
 */
function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
