import type { ImportCaseSource, ImportDataSource, ImportStepSource, PageAction, TargetType, UiLibrary } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import {
  assertPageAvailable,
  openPageSession,
  PageSessionError,
  runPageAction,
  waitForPageReady,
  type PageSession
} from './page-session';
import { readPageSnapshot, resolveUnique } from './page-snapshot';

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
  confidence: 'high' | 'medium' | 'low';
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
  confidence: 'high' | 'medium' | 'low';
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
  openTimeoutMs: number;
}

export interface CollectedPageState {
  action?: PageAction;
  context: PageContext;
}

/**
 * 兼容旧错误类型，保持外部导入不破坏。
 */
export const PageContextError = PageSessionError;

interface PageMapRunner {
  open(targetUrl: string, openTimeoutMs: number, warnings: string[]): Promise<void>;
  snapshot(warnings: string[]): Promise<PageContext>;
  action(action: PageAction): Promise<void>;
  stable(warnings: string[]): Promise<void>;
  close(): Promise<void>;
}

type PageMapRunnerFactory = (input: CollectPageMapInput) => Promise<PageMapRunner>;
type PageContextFactory = (input: CollectInput) => Promise<PageContext>;
type PageContextSnapshot = (input: { caseInfo: ImportCaseSource }) => PageContext;

let pageMapRunnerFactory: PageMapRunnerFactory | undefined;
let pageContextFactory: PageContextFactory | undefined;
let testContextBuilder: PageContextSnapshot | undefined;

/**
 * 注入页面地图执行器，供测试用最小接口覆盖动作循环。
 */
export function setPageMapRunner(factory: PageMapRunnerFactory | undefined) {
  pageMapRunnerFactory = factory;
}

/**
 * 注入整页采集工厂，供特殊场景替换默认实现。
 */
export function setPageContextFactory(factory: PageContextFactory | undefined) {
  pageContextFactory = factory;
}

/**
 * 注入测试用页面上下文构造器，单元测试可以避免真实浏览器。
 */
export function setTestPageContextBuilder(builder: PageContextSnapshot | undefined) {
  testContextBuilder = builder;
}

/**
 * 采集目标页面上下文摘要。
 */
export async function collectPageContext(input: CollectInput): Promise<PageContext> {
  if (pageContextFactory) {
    return pageContextFactory(input);
  }

  if (testContextBuilder) {
    return testContextBuilder({ caseInfo: input.caseInfo });
  }

  if (process.env.NODE_ENV === 'test') {
    return createTestContext(input.caseInfo);
  }

  const session = await openPageSession({
    projectKey: input.projectKey,
    envKey: input.envKey,
    uiLibrary: input.uiLibrary
  });
  const warnings: string[] = [];

  try {
    await session.open({
      targetUrl: input.caseInfo.targetUrl,
      openTimeoutMs: getAppConfig().browser.openTimeoutMs,
      warnings
    });
    await session.waitForReady(warnings);

    return await readPageSnapshot(session.page, warnings, input.uiLibrary);
  } finally {
    await session.close();
  }
}

/**
 * 按页面地址采集初始页面上下文。
 */
export async function collectInitialPage(input: CollectPageInput): Promise<PageContext> {
  const context = await collectPageContext({
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

  assertUsablePageContext(context);

  return context;
}

/**
 * 采集初始页面以及安全探索动作后的多状态页面上下文。
 */
export async function collectPageMapStates(input: CollectPageMapInput): Promise<{ states: CollectedPageState[]; warnings: string[] }> {
  const runner = await createPageMapRunner(input);
  const states: CollectedPageState[] = [];
  const warnings: string[] = [];

  try {
    await runner.open(input.targetUrl, input.openTimeoutMs, warnings);
    const initialContext = await runner.snapshot([...warnings]);

    assertUsablePageContext(initialContext);
    states.push({ context: initialContext });

    for (const action of input.actions) {
      const actionWarnings: string[] = [];

      try {
        await runner.action(action);
        await runner.stable(actionWarnings);
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
 * 等待 SPA 页面渲染出可供 AI 使用的可见内容。
 */
export { waitForPageReady, assertPageAvailable, readPageSnapshot, resolveUnique, runPageAction };

/**
 * 校验页面地图初始快照是否具备业务可读信号。
 */
export function assertUsablePageContext(context: PageContext) {
  if (hasPageSignal(context)) {
    return;
  }

  const warning = context.warnings.length > 0 ? `已有 warning：${context.warnings.join('；')}` : '未采集到可解释 warning';

  throw new PageSessionError(`页面地图初始快照不可用：页面没有可读业务内容。${warning}`);
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
 * 创建真实浏览器执行器，会话层由 page-session 提供。
 */
async function createBrowserRunner(input: CollectPageMapInput): Promise<PageMapRunner> {
  const session = await openPageSession({
    projectKey: input.projectKey,
    envKey: input.envKey,
    uiLibrary: input.uiLibrary
  });

  return wrapSessionAsRunner(session, input);
}

/**
 * 把会话层包装成 page-map 使用的 runner 接口。
 */
function wrapSessionAsRunner(session: PageSession, input: CollectPageMapInput): PageMapRunner {
  return {
    open(targetUrl, openTimeoutMs, warnings) {
      return session.open({ targetUrl, openTimeoutMs, warnings });
    },
    snapshot(warnings) {
      return readPageSnapshot(session.page, warnings, input.uiLibrary);
    },
    action(action) {
      return session.runAction(action);
    },
    stable(warnings) {
      return session.waitForActionStable(warnings);
    },
    close() {
      return session.close();
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
    async open() {},
    async snapshot(warnings) {
      const context = testContextBuilder
        ? testContextBuilder({ caseInfo: { caseNo: 'PAGE-MAP', caseName: title, targetUrl: url, precondition: '', expectedResult: '', note: '' } })
        : createTestContext({ caseNo: 'PAGE-MAP', caseName: title, targetUrl: url, precondition: '', expectedResult: '', note: '' });

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
 * 判断页面上下文是否包含足够保守的业务可读信号。
 */
function hasPageSignal(context: PageContext) {
  const title = context.page.title.trim();
  const hasTitle = Boolean(title && title !== 'Vite App');
  const hasHeadings = context.page.headings.some((text) => Boolean(text.trim()));
  const elements = context.elements;
  const hasElements = [
    elements.buttons,
    elements.inputs,
    elements.selects,
    elements.links,
    elements.navigation,
    elements.tables
  ].some((items) => items.length > 0);
  const hasFields = (context.fields ?? []).length > 0;
  const hasAria = Boolean(context.aria?.trim());

  return hasTitle || hasHeadings || hasElements || hasFields || hasAria;
}
