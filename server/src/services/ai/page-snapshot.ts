import type { Locator, Page } from '@playwright/test';
import type { UiLibrary } from '../../../../shared/types';
import type { PageContext, PageElement, TableElement } from './page-context';
import { readKendoFields, readKendoSelects, shouldCollectKendoFields } from './ui-adapters/kendo-snapshot';

const maxItems = 20;
const maxText = 80;

/**
 * 读取当前页面的压缩上下文快照。
 *
 * 该实现只负责通用元素读取，UI 控件库差异由 ui-adapters 层提供。
 */
export async function readPageSnapshot(page: Page, warnings: string[] = [], uiLibrary: UiLibrary = 'auto'): Promise<PageContext> {
  const includeKendoFields = await shouldCollectKendoFields(page, uiLibrary);

  return {
    page: {
      url: page.url(),
      title: await page.title(),
      headings: await readTexts(page.locator('h1,h2,h3,[role="heading"]'))
    },
    elements: {
      buttons: await readButtons(page),
      inputs: await readInputs(page),
      selects: await readSelects(page, uiLibrary),
      links: await readLinks(page),
      navigation: await readNavigation(page),
      tables: await readTables(page)
    },
    fields: includeKendoFields ? await readKendoFields(page) : [],
    uiLibrary,
    warnings
  };
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
 * 读取下拉框元素摘要，Kendo 模式时合并自定义下拉。
 */
async function readSelects(page: Page, uiLibrary: UiLibrary) {
  const nativeItems = await readAttrs(page, page.locator('select'), 'aria-label', 'getByLabel');

  if (uiLibrary === 'native') {
    return nativeItems;
  }

  return [...nativeItems, ...await readKendoSelects(page)];
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
