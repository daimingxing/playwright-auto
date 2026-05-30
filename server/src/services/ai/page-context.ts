import { chromium, type Locator, type Page } from '@playwright/test';
import type { AiLevel, ImportCaseSource, ImportDataSource, ImportStepSource, PageAction, TargetType, UiLibrary } from '../../../../shared/types';
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

export interface PageLocator {
  selector: string;
  kind: 'role' | 'label' | 'field-container' | 'attr' | 'text';
  unique: boolean;
  confidence: AiLevel;
  reason?: string;
}

export interface PageOption {
  text: string;
  value?: string;
  locator?: string;
}

export interface PageField {
  name: string;
  type: TargetType;
  ui?: string;
  required?: boolean;
  value?: string;
  state?: 'enabled' | 'disabled' | 'readonly';
  locators: PageLocator[];
  attrs?: Record<string, string>;
  options?: PageOption[];
  source: 'label-container' | 'native-label' | 'aria' | 'heuristic';
  confidence: AiLevel;
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
  fields?: PageField[];
  aria?: string;
  uiLibrary?: UiLibrary;
  warnings: string[];
}

export interface CollectInput {
  projectKey: string;
  envKey: string;
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  uiLibrary?: UiLibrary;
}

export interface CollectPageInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  uiLibrary?: UiLibrary;
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
    return await readPageSnapshot(page, warnings, input.uiLibrary);
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
    data: [],
    uiLibrary: input.uiLibrary
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
      return readPageSnapshot(page, warnings, input.uiLibrary);
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
          'button,a,input,textarea,select,table,[role="button"],[role="menuitem"],[role="combobox"],.el-menu-item,.el-sub-menu__title,.k-dropdownlist,.k-combobox,.k-picker'
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
 * 执行单个页面地图安全探索动作。
 */
export async function runPageAction(page: Page, action: PageAction) {
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
  const labeled = page.getByLabel(name).locator('xpath=ancestor-or-self::*[self::select or @role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ")]').first();

  if (await labeled.count()) {
    return labeled;
  }

  const nearLabel = page.getByText(name, { exact: true }).locator('xpath=ancestor::*[1]/following-sibling::*//*[self::select or @role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ")][1] | ancestor::*[1]/following-sibling::*[self::select or @role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ")][1] | ancestor::*[2]//*[self::select or @role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ")][1]').first();

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

/**
 * 读取当前页面的压缩上下文快照。
 */
export async function readPageSnapshot(page: Page, warnings: string[] = [], uiLibrary: UiLibrary = 'auto'): Promise<PageContext> {
  const shouldReadKendoFields = await shouldCollectKendoFields(page, uiLibrary);

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
    fields: shouldReadKendoFields ? await readKendoFields(page) : [],
    uiLibrary,
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
async function readSelects(page: Page, uiLibrary: UiLibrary) {
  const nativeItems = await readAttrs(page, page.locator('select'), 'aria-label', 'getByLabel');

  if (uiLibrary === 'native') {
    return nativeItems;
  }

  return [...nativeItems, ...await readKendoSelects(page)];
}

/**
 * 读取 Kendo 自定义下拉摘要，补足非原生 select 的页面上下文。
 */
async function readKendoSelects(page: Page): Promise<PageElement[]> {
  const values: Array<Omit<PageElement, 'unique'>> = [];
  const counts: number[] = [];
  const locator = page.locator('.k-dropdownlist,.k-combobox,.k-picker,[role="combobox"]');
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const info = await item.evaluate((element) => {
      const attrLabel = element.getAttribute('aria-label')?.trim() || element.getAttribute('title')?.trim() || '';
      const valueText = element.querySelector('.k-input-value-text,.k-input-inner,.k-input')?.textContent?.trim() || element.textContent?.trim() || '';
      const labelText = attrLabel || findNearLabel(element);

      return {
        label: labelText,
        text: valueText
      };

      /**
       * 在同一表单行或前序兄弟中寻找字段标签。
       */
      function findNearLabel(target: Element) {
        const row = target.closest('.k-form-field,.form-row,.el-form-item,.ant-form-item,.field-row,td,li,div');
        const rowLabel = row?.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label')?.textContent?.trim();

        if (rowLabel) {
          return rowLabel.replace(/[:：]$/, '').trim();
        }

        let previous = target.previousElementSibling;

        while (previous) {
          const text = previous.textContent?.trim().replace(/[:：]$/, '').trim();

          if (text) {
            return text;
          }

          previous = previous.previousElementSibling;
        }

        return '';
      }
    });
    const label = normalizeText(info.label);
    const text = normalizeText(info.text);

    if (!label && !text) {
      continue;
    }

    const key = label || text;

    values.push({
      label: label || undefined,
      text: text || undefined,
      locator: `getByLabel('${escapeText(key)}')`
    });
    counts.push(label ? await page.getByLabel(label).count() : await page.getByText(text, { exact: true }).count());
  }

  return resolveUnique(values, counts);
}

/**
 * 判断当前快照是否需要执行 Kendo 字段语义采集。
 */
async function shouldCollectKendoFields(page: Page, uiLibrary: UiLibrary) {
  if (uiLibrary === 'native') {
    return false;
  }

  if (uiLibrary === 'kendo') {
    return true;
  }

  return (await page.locator('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker,[data-role="dropdownlist"],[data-role="combobox"],[data-role="datepicker"],[data-role="numerictextbox"]').count()) > 0;
}

/**
 * 读取 Kendo 控件对应的表单字段语义。
 */
async function readKendoFields(page: Page): Promise<PageField[]> {
  const fields: PageField[] = [];
  const locator = page.locator('.k-dropdownlist,.k-combobox,.k-picker[role="combobox"],.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker,[data-role="dropdownlist"],[data-role="combobox"]');
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const info = await item.evaluate((element) => {
      const control = findKendoControl(element);
      const input = findKendoInput(control);
      const field = findFieldInfo(control, input);
      const container = field.container;
      const label = field.label;
      const ariaText = cleanLabel(control.getAttribute('aria-label') || control.getAttribute('title') || '');
      const fallbackName = cleanLabel(input?.getAttribute('name') || input?.getAttribute('id') || '');
      const source = label ? 'label-container' : ariaText ? 'aria' : 'heuristic';
      const name = label || ariaText || fallbackName;
      const value = readKendoValue(control, input);
      const attrs = readKendoAttrs(control, input);
      const className = control.getAttribute('class') || '';
      const dataRole = input?.getAttribute('data-role') || control.getAttribute('data-role') || '';
      const disabled = isDisabled(control, input, container);
      const readonly = isReadonly(control, input, container);

      return {
        name,
        value,
        source,
        ui: getKendoUi(className, dataRole),
        type: getKendoType(className, dataRole),
        required: Boolean(input?.required || field.required),
        state: disabled ? 'disabled' : readonly ? 'readonly' : 'enabled',
        attrs,
        containerTag: container?.tagName.toLowerCase() || '',
        containerClass: container?.getAttribute('class') || '',
        hasContainerLabel: Boolean(label && container),
        ariaLabel: ariaText,
        inputName: attrs.inputName || '',
        inputId: attrs.inputId || ''
      };

      /**
       * 查找可交互的 Kendo 控件包装节点。
       */
      function findKendoControl(target: Element) {
        return target.matches('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker')
          ? target
          : target.closest('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker') ?? target;
      }

      /**
       * 查找 Kendo 控件内承载 id/name/data-role 的输入节点。
       */
      function findKendoInput(controlElement: Element) {
        if (controlElement.tagName.toLowerCase() === 'input') {
          return controlElement as HTMLInputElement;
        }

        return controlElement.querySelector('input,select,textarea') as HTMLInputElement | null;
      }

      /**
       * 清理字段标签文本，避免必填星号和冒号污染字段名。
       */
      function cleanLabel(value: string) {
        return value.replace(/\*/g, '').replace(/\s+/g, ' ').replace(/[:：]$/, '').trim();
      }

      /**
       * 查找当前控件真实关联的字段信息，避免宽表单行串用其他字段。
       */
      function findFieldInfo(controlElement: Element, inputElement: HTMLInputElement | null) {
        const id = inputElement?.getAttribute('id') || '';
        const exactLabel = id ? document.querySelector(`label[for="${cssEscape(id)}"]`) : null;

        if (exactLabel) {
          return {
            label: cleanLabel(exactLabel.textContent ?? ''),
            required: isRequiredLabel(exactLabel),
            container: exactLabel.closest('.xr-fc,.i-select,.i-input,.k-form-field,.el-form-item,.ant-form-item')
          };
        }

        const scoped = controlElement.closest('.xr-fc,.i-select,.i-input,.k-form-field,.el-form-item,.ant-form-item');
        const scopedLabel = scoped?.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label');

        if (scopedLabel) {
          return {
            label: cleanLabel(scopedLabel.textContent ?? ''),
            required: isRequiredLabel(scopedLabel),
            container: scoped
          };
        }

        const siblingLabel = findSiblingLabel(controlElement);

        if (siblingLabel) {
          const parent = siblingLabel.parentElement;

          return {
            label: cleanLabel(siblingLabel.textContent ?? ''),
            required: isRequiredLabel(siblingLabel),
            // form-row/field-row 可能包含多个字段，只用于识别字段名，不作为字段容器定位依据。
            container: parent?.matches('.form-row,.field-row') ? null : parent
          };
        }

        return {
          label: '',
          required: false,
          container: null
        };
      }

      /**
       * 查找当前控件前序同级标签，不跨越前一个 Kendo 控件。
       */
      function findSiblingLabel(controlElement: Element) {
        let node = controlElement.previousElementSibling;

        while (node) {
          if (isKendoControl(node)) {
            return null;
          }

          if (node.matches('label,.field-label,.label,.el-form-item__label,.ant-form-item-label')) {
            return node;
          }

          const nested = node.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label');

          if (nested) {
            return nested;
          }

          node = node.previousElementSibling;
        }

        return null;
      }

      /**
       * 判断节点是否是 Kendo 控件边界。
       */
      function isKendoControl(node: Element) {
        return node.matches('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker,[data-role]');
      }

      /**
       * 判断当前字段标签是否表达必填。
       */
      function isRequiredLabel(labelElement: Element) {
        return Boolean(labelElement.querySelector('.i-input-required,[required]') || labelElement.textContent?.includes('*'));
      }

      /**
       * 转义 label[for] 属性选择器中的特殊字符。
       */
      function cssEscape(value: string) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      }

      /**
       * 读取 Kendo 当前显示值，隐藏 input 的空 value 不覆盖可见文本。
       */
      function readKendoValue(controlElement: Element, inputElement: HTMLInputElement | null) {
        const text = controlElement.querySelector('.k-input-value-text,.k-input-inner,.k-input')?.textContent?.trim() || '';

        return text || inputElement?.value || '';
      }

      /**
       * 读取 Kendo 控件和隐藏 input 的关键属性。
       */
      function readKendoAttrs(controlElement: Element, inputElement: HTMLInputElement | null) {
        const values: Record<string, string> = {};
        const attrPairs: Array<[string, string | null | undefined]> = [
          ['inputId', inputElement?.getAttribute('id')],
          ['inputName', inputElement?.getAttribute('name')],
          ['ariaControls', controlElement.getAttribute('aria-controls')],
          ['ariaExpanded', controlElement.getAttribute('aria-expanded')],
          ['ariaDisabled', controlElement.getAttribute('aria-disabled')],
          ['ariaReadonly', controlElement.getAttribute('aria-readonly')],
          ['dataRole', inputElement?.getAttribute('data-role') || controlElement.getAttribute('data-role')]
        ];

        for (const [key, value] of attrPairs) {
          if (value) {
            values[key] = value;
          }
        }

        return values;
      }

      /**
       * 判断控件是否处于禁用状态。
       */
      function isDisabled(controlElement: Element, inputElement: HTMLInputElement | null, containerElement: Element | null) {
        const disabledRoot = controlElement.closest('fieldset[disabled],.k-disabled,.k-state-disabled,[aria-disabled="true"]') || containerElement?.closest('fieldset[disabled],.k-disabled,.k-state-disabled,[aria-disabled="true"]');

        return Boolean(disabledRoot || inputElement?.disabled || controlElement.classList.contains('k-disabled') || controlElement.classList.contains('k-state-disabled') || controlElement.getAttribute('aria-disabled') === 'true' || containerElement?.getAttribute('aria-disabled') === 'true');
      }

      /**
       * 判断控件是否处于只读状态。
       */
      function isReadonly(controlElement: Element, inputElement: HTMLInputElement | null, containerElement: Element | null) {
        const readonlyRoot = controlElement.closest('[aria-readonly="true"],.k-readonly,.k-state-readonly') || containerElement?.closest('[aria-readonly="true"],.k-readonly,.k-state-readonly');

        return Boolean(readonlyRoot || inputElement?.readOnly || controlElement.classList.contains('k-readonly') || controlElement.classList.contains('k-state-readonly') || controlElement.getAttribute('aria-readonly') === 'true' || containerElement?.getAttribute('aria-readonly') === 'true' || containerElement?.classList.contains('k-readonly') || containerElement?.classList.contains('k-state-readonly'));
      }

      /**
       * 根据 Kendo class 和 data-role 推断 UI 控件类型。
       */
      function getKendoUi(classNameValue: string, dataRoleValue: string) {
        if (classNameValue.includes('k-combobox') || dataRoleValue === 'combobox') {
          return 'kendo-combobox';
        }

        if (classNameValue.includes('k-multiselect')) {
          return 'kendo-multiselect';
        }

        if (classNameValue.includes('k-dropdowntree')) {
          return 'kendo-dropdowntree';
        }

        if (classNameValue.includes('k-datepicker') || classNameValue.includes('k-datetimepicker') || classNameValue.includes('k-timepicker')) {
          return 'kendo-datepicker';
        }

        if (classNameValue.includes('k-numerictextbox')) {
          return 'kendo-numerictextbox';
        }

        return 'kendo-dropdownlist';
      }

      /**
       * 将 Kendo 控件类型映射到导入目标类型。
       */
      function getKendoType(classNameValue: string, dataRoleValue: string) {
        if (classNameValue.includes('k-datepicker') || classNameValue.includes('k-datetimepicker') || classNameValue.includes('k-timepicker')) {
          return 'date';
        }

        if (classNameValue.includes('k-dropdownlist') || classNameValue.includes('k-combobox') || classNameValue.includes('k-multiselect') || classNameValue.includes('k-dropdowntree') || dataRoleValue === 'dropdownlist' || dataRoleValue === 'combobox') {
          return 'select';
        }

        return 'input';
      }
    });
    const name = normalizeText(info.name);

    if (!name) {
      continue;
    }

    const locators: PageLocator[] = [];

    if (info.source === 'label-container' && info.hasContainerLabel) {
      const selector = buildKendoFieldSelector(info);

      locators.push({
        selector,
        kind: 'field-container',
        unique: await page.locator(selector).count().then((matchCount) => matchCount === 1).catch(() => false),
        confidence: 'high',
        reason: '字段名来自同一字段容器内的 label'
      });
    }

    const ariaSelector = buildKendoAriaSelector(info);

    if (ariaSelector) {
      locators.push({
        selector: ariaSelector,
        kind: 'label',
        unique: await page.locator(ariaSelector).count().then((matchCount) => matchCount === 1).catch(() => false),
        confidence: 'medium',
        reason: '字段名来自控件 aria-label'
      });
    }

    const attrSelector = buildKendoAttrSelector(info);

    if (attrSelector) {
      locators.push({
        selector: attrSelector,
        kind: 'attr',
        unique: await page.locator(attrSelector).count().then((matchCount) => matchCount === 1).catch(() => false),
        confidence: 'medium',
        reason: '隐藏输入提供了 id 或 name 属性'
      });
    }

    fields.push({
      name,
      type: info.type as TargetType,
      ui: info.ui,
      required: info.required,
      value: normalizeText(info.value) || undefined,
      state: info.state as PageField['state'],
      locators,
      attrs: info.attrs,
      options: [],
      source: info.source as PageField['source'],
      confidence: info.source === 'label-container' ? 'high' : 'medium'
    });
  }

  return fields;
}

/**
 * 构造可由 page.locator 执行的 Kendo 字段容器定位器。
 */
function buildKendoFieldSelector(info: { name: string; containerTag: string; containerClass: string }) {
  const tag = info.containerTag || '*';
  const classPredicate = buildClassPredicate(info.containerClass);
  const controlPredicate = 'self::*[@role="combobox" or contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ") or contains(concat(" ", normalize-space(@class), " "), " k-multiselect ") or contains(concat(" ", normalize-space(@class), " "), " k-dropdowntree ") or contains(concat(" ", normalize-space(@class), " "), " k-numerictextbox ") or contains(concat(" ", normalize-space(@class), " "), " k-datepicker ") or contains(concat(" ", normalize-space(@class), " "), " k-datetimepicker ") or contains(concat(" ", normalize-space(@class), " "), " k-timepicker ")]';

  // 字段名只用于限制容器，不作为控件可访问名，避免把当前值误当成 label。
  return `xpath=//${tag}[${classPredicate}][.//*[self::label or contains(concat(" ", normalize-space(@class), " "), " field-label ") or contains(concat(" ", normalize-space(@class), " "), " label ")][contains(normalize-space(.), ${xpathLiteral(info.name)})]]//*[${controlPredicate}][1]`;
}

/**
 * 构造 aria-label 控件定位器，避免 aria 来源使用字段容器 XPath。
 */
function buildKendoAriaSelector(info: { ariaLabel: string }) {
  if (!info.ariaLabel) {
    return undefined;
  }

  return `[aria-label=${cssString(info.ariaLabel)}]`;
}

/**
 * 构造隐藏 input 属性定位器，作为字段容器定位失败时的候选。
 */
function buildKendoAttrSelector(info: { inputName: string; inputId: string }) {
  if (info.inputName) {
    return `input[name=${cssString(info.inputName)}]`;
  }

  if (info.inputId) {
    return `input[id=${cssString(info.inputId)}]`;
  }

  return undefined;
}

/**
 * 根据字段容器 class 构造 XPath class 条件。
 */
function buildClassPredicate(className: string) {
  const classes = className.split(/\s+/).filter((item) => ['xr-fc', 'i-select', 'i-input', 'k-form-field', 'el-form-item', 'ant-form-item', 'form-row', 'field-row'].includes(item));

  if (!classes.length) {
    return 'true()';
  }

  return classes.map((item) => `contains(concat(" ", normalize-space(@class), " "), " ${item} ")`).join(' and ');
}

/**
 * 转义 XPath 字符串字面量。
 */
function xpathLiteral(value: string) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

/**
 * 转义 CSS 属性选择器字符串。
 */
function cssString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
    uiLibrary: 'auto',
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
