import { chromium, type Browser, type Locator, type Page, type Response } from '@playwright/test';
import type { PageAction, UiLibrary } from '../../../../shared/types';
import { buildStartUrl } from '../../../../shared/url';
import { getAppConfig } from '../../lib/app-config';
import { getProject } from '../../lib/project-store';
import { getProjectAuthPath, hasProjectAuth } from '../auth-session';
import { getBrowserPath } from '../playwright/browser-path';
import { assertVendorBrowser } from '../playwright/vendor-browser';

interface SessionInput {
  projectKey: string;
  envKey: string;
  uiLibrary?: UiLibrary;
}

export interface OpenPageInput {
  targetUrl: string;
  openTimeoutMs: number;
  warnings: string[];
}

const readyTimeoutMs = 12000;
const actionStableTimeoutMs = 5000;
const minReadyTextLength = 50;

/**
 * 等待 SPA 页面渲染出可见内容后再读取上下文。
 */
export async function waitForPageReady(page: Page, warnings: string[] = []): Promise<void> {
  try {
    await page.waitForFunction(
      (minLength) => {
        const bodyText = document.body?.innerText?.trim() ?? '';
        const title = document.title.trim();
        const visibleCount = Array.from(document.querySelectorAll(
          'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],[role="combobox"],.el-menu-item,.el-sub-menu__title,.k-dropdownlist,.k-combobox,.k-picker'
        )).filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).length;
        const hasBusinessTitle = title !== 'Vite App';
        const hasEnoughText = bodyText.length >= minLength;

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
 * 打开目标业务 URL 并完成登录态继承，作为页面快照与探索动作的统一入口。
 */
export async function openPageSession(input: SessionInput): Promise<PageSession> {
  const project = await getProject(input.projectKey);
  const env = project.envs.find((item) => item.key === input.envKey);
  const baseUrl = env?.baseUrl ?? project.envs.find((item) => item.key === project.defaultEnv)?.baseUrl ?? '';
  const storageState = (await hasProjectAuth(input.projectKey, input.envKey)) ? getProjectAuthPath(input.projectKey, input.envKey) : undefined;

  await assertVendorBrowser();

  const browser = await chromium.launch({
    headless: true,
    executablePath: getBrowserPath()
  });
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();

  return new BrowserPageSession({ browser, page, baseUrl, uiLibrary: input.uiLibrary ?? 'auto' });
}

export interface PageSession {
  page: Page;
  open(input: OpenPageInput): Promise<void>;
  waitForReady(warnings: string[]): Promise<void>;
  runAction(action: PageAction): Promise<void>;
  waitForActionStable(warnings: string[]): Promise<void>;
  close(): Promise<void>;
}

class BrowserPageSession implements PageSession {
  page: Page;
  private readonly browser: Browser;
  private readonly baseUrl: string;
  private readonly uiLibrary: UiLibrary;

  constructor(input: { browser: Browser; page: Page; baseUrl: string; uiLibrary: UiLibrary }) {
    this.browser = input.browser;
    this.page = input.page;
    this.baseUrl = input.baseUrl;
    this.uiLibrary = input.uiLibrary;
  }

  /**
   * 打开业务 URL 并等待 domcontentloaded，超时时不中断采集。
   */
  async open(input: OpenPageInput): Promise<void> {
    const url = buildStartUrl(this.baseUrl, input.targetUrl);

    try {
      const response: Response | null = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: input.openTimeoutMs });

      assertPageAvailable(response, url);
    } catch (error) {
      if (!isNavigationTimeout(error)) {
        throw error;
      }

      input.warnings.push(`domcontentloaded 等待超时，已继续尝试读取当前页面快照：${getErrorMessage(error)}`);
    }
  }

  /**
   * 等待 SPA 页面渲染出可供 AI 使用的可见内容。
   */
  async waitForReady(warnings: string[] = []): Promise<void> {
    try {
      await this.page.waitForFunction(
        (minLength) => {
          const bodyText = document.body?.innerText?.trim() ?? '';
          const title = document.title.trim();
          const visibleCount = Array.from(document.querySelectorAll(
            'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],[role="combobox"],.el-menu-item,.el-sub-menu__title,.k-dropdownlist,.k-combobox,.k-picker'
          )).filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          }).length;
          const hasBusinessTitle = title !== 'Vite App';
          const hasEnoughText = bodyText.length >= minLength;

          return hasBusinessTitle && (hasEnoughText || visibleCount > 0);
        },
        minReadyTextLength,
        { timeout: readyTimeoutMs }
      );
    } catch {
      warnings.push(await buildPageReadyWarning(this.page));
    }
  }

  /**
   * 执行单个页面地图安全探索动作。
   */
  async runAction(action: PageAction): Promise<void> {
    const locator = getActionLocator(this.page, action);

    if (action.type === 'hover') {
      await locator.hover();
      return;
    }

    if (action.type === 'select' && action.value) {
      await runSelectAction(this.page, action, locator);
      return;
    }

    await locator.click();
  }

  /**
   * 等待动作后的页面进入可读状态。
   */
  async waitForActionStable(warnings: string[]): Promise<void> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: actionStableTimeoutMs });
    } catch {
      warnings.push('探索动作后页面网络未在限定时间内完全空闲，已继续读取当前可见内容。');
    }

    await this.waitForReady(warnings);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

/**
 * 执行单个页面地图安全探索动作，供外部单点动作调用复用。
 */
export async function runPageAction(page: Page, action: PageAction): Promise<void> {
  const locator = getActionLocator(page, action);

  if (action.type === 'hover') {
    await locator.hover();
    return;
  }

  if (action.type === 'select' && action.value) {
    await runSelectAction(page, action, locator);
    return;
  }

  await locator.click();
}

const selectTriggerXpath = 'self::select or @role="combobox" or @data-role="dropdownlist" or @data-role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ")';

/**
 * 确认目标页面真实可访问。
 */
export function assertPageAvailable(response: PageResponse | null, targetUrl: string) {
  if (!response) {
    throw new PageSessionError(`目标页面不可访问：${targetUrl}。未收到页面响应，请检查目标页面URL是否写错，或页面是否存在。`);
  }

  const status = response.status();

  if (status >= 400) {
    const reason = response.statusText() ? ` ${response.statusText()}` : '';

    throw new PageSessionError(`目标页面不可访问：${response.url()}（HTTP ${status}${reason}）。请检查目标页面URL是否写错，或页面是否存在。`);
  }
}

interface PageResponse {
  url(): string;
  status(): number;
  statusText(): string;
}

export class PageSessionError extends Error {
  /**
   * 创建页面会话层的中断错误。
   */
  constructor(message: string) {
    super(message);
    this.name = 'PageSessionError';
  }
}

async function buildPageReadyWarning(page: Page) {
  const info = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.trim() ?? '';
    const visibleCount = Array.from(document.querySelectorAll(
      'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],[role="combobox"],.el-menu-item,.el-sub-menu__title,.k-dropdownlist,.k-combobox,.k-picker'
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
 * 执行下拉选择动作，原生 select 和 Kendo 等自定义下拉分开处理。
 */
async function runSelectAction(page: Page, action: PageAction, locator: Locator) {
  if (await locator.evaluate((element) => element.tagName.toLowerCase() === 'select').catch(() => false)) {
    await locator.selectOption({ label: action.value });
    return;
  }

  const trigger = await findSelectTrigger(page, action);

  await trigger.click();
  await findSelectOption(page, action.value ?? '').click();
}

/**
 * 查找下拉触发控件，避免 targetName 文本命中左侧标签。
 */
async function findSelectTrigger(page: Page, action: PageAction) {
  const name = action.targetName;
  const labeled = page.getByLabel(name).locator(`xpath=ancestor-or-self::*[${selectTriggerXpath}]`).first();

  if (await labeled.count()) {
    return labeled;
  }

  const nearLabel = page.getByText(name, { exact: true }).locator(`xpath=ancestor::*[1]/following-sibling::*//*[${selectTriggerXpath}][1] | ancestor::*[1]/following-sibling::*[${selectTriggerXpath}][1] | ancestor::*[2]//*[${selectTriggerXpath}][1]`).first();

  if (await nearLabel.count()) {
    return nearLabel;
  }

  throw new Error(`未找到下拉控件：${name}`);
}

/**
 * 查找展开后的下拉选项，优先使用选项角色和 Kendo 列表项。
 */
function findSelectOption(page: Page, value: string) {
  return page.getByRole('option', { name: value }).or(page.locator('.k-list-item,.k-item').filter({ hasText: value })).or(page.getByText(value, { exact: true })).first();
}

/**
 * 根据动作类型创建最小可用定位器。
 */
function getActionLocator(page: Page, action: PageAction) {
  if (action.selector) {
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
    return page.locator('select').filter({ hasText: name }).or(page.getByLabel(name)).or(page.getByText(name, { exact: true })).first();
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

function isNavigationTimeout(error: unknown) {
  return getErrorMessage(error).includes('Timeout');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读取 openTimeoutMs 默认值，供测试 / 单点调用复用。
 */
export function getDefaultOpenTimeoutMs() {
  return getAppConfig().browser.openTimeoutMs;
}
