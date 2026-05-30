import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AuthState } from '../../../shared/types';
import { writeJson } from '../lib/fs';
import { getProjectPath } from '../lib/path';
import { getProject } from '../lib/project-store';
import { badRequest, notFound } from '../lib/http-error';
import { getBrowserPath } from './playwright/browser-path';
import { assertVendorBrowser } from './playwright/vendor-browser';

interface StorageState {
  cookies: unknown[];
  origins: unknown[];
}

/**
 * 获取指定环境的登录态文件路径。
 */
export function getProjectAuthPath(projectKey: string, envKey: string = 'default') {
  return join(getProjectPath(projectKey), 'auth', `${envKey}.storageState.json`);
}

/**
 * 获取项目默认环境的登录态文件路径。
 */
export async function getProjectAuthPathByEnv(projectKey: string, envKey?: string) {
  const key = await getAuthEnvKey(projectKey, envKey);

  return getProjectAuthPath(projectKey, key);
}

/**
 * 判断指定环境的登录态是否存在。
 */
export async function hasProjectAuth(projectKey: string, envKey?: string) {
  const key = await getAuthEnvKey(projectKey, envKey);

  return existsSync(getProjectAuthPath(projectKey, key));
}

/**
 * 创建指定环境的登录态文件。
 */
export async function createAuthState(projectKey: string, state: StorageState, envKey = 'default') {
  const path = getProjectAuthPath(projectKey, envKey);
  const auth: AuthState = {
    path,
    createdAt: new Date().toISOString()
  };

  await writeJson(path, state);

  return auth;
}

interface ManualLoginInput {
  envKey?: string;
}

interface ManualLoginResult {
  sessionId: string;
  url: string;
  warning?: string;
}

interface ManualSession {
  projectKey: string;
  envKey: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  createdAt: string;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ManualSession>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// 与 Playwright 默认导航超时保持一致，超时后只提示用户手动处理，不中断登录会话。
const LOGIN_NAV_TIMEOUT_MS = 30 * 1000;

/**
 * 打开有头浏览器让用户手动登录。
 */
export async function startLoginSession(projectKey: string, input: ManualLoginInput = {}): Promise<ManualLoginResult> {
  const { envKey, envMeta } = await getAuthEnv(projectKey, input.envKey);

  if (process.env.NODE_ENV === 'test') {
    const sessionId = crypto.randomUUID();
    const timer = createSessionTimer(sessionId);
    sessions.set(sessionId, {
      projectKey,
      envKey,
      createdAt: new Date().toISOString(),
      timer
    });

    return {
      sessionId,
      url: envMeta.baseUrl
    };
  }

  await assertVendorBrowser();

  const browser = await chromium.launch({
    headless: false,
    executablePath: getBrowserPath()
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const sessionId = crypto.randomUUID();
  const timer = createSessionTimer(sessionId);

  sessions.set(sessionId, {
    projectKey,
    envKey,
    browser,
    context,
    page,
    createdAt: new Date().toISOString(),
    timer
  });

  const warning = await openLoginUrl(page, envMeta.baseUrl);

  return {
    sessionId,
    url: envMeta.baseUrl,
    ...(warning ? { warning } : {})
  };
}

/**
 * 保存手动登录后的指定环境登录态。
 */
export async function saveLoginSession(projectKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey || isSessionExpired(session.createdAt)) {
    clearSession(session);
    sessions.delete(sessionId);
    throw badRequest('登录会话不存在或已过期');
  }

  const statePath = getProjectAuthPath(projectKey, session.envKey);
  if (session.context && session.browser) {
    await session.context.storageState({ path: statePath });
    await session.browser.close();
    session.browser = undefined;
  } else {
    await createAuthState(projectKey, { cookies: [], origins: [] }, session.envKey);
  }
  clearSession(session);
  sessions.delete(sessionId);

  return {
    path: statePath,
    createdAt: new Date().toISOString()
  } satisfies AuthState;
}

/**
 * 读取登录态使用的环境标识。
 */
async function getAuthEnvKey(projectKey: string, envKey?: string) {
  const { envKey: key } = await getAuthEnv(projectKey, envKey);

  return key;
}

/**
 * 读取登录态使用的环境配置。
 */
async function getAuthEnv(projectKey: string, envKey?: string) {
  const project = await getProject(projectKey);
  const key = envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((item) => item.key === key);

  if (!envMeta) {
    throw notFound('登录环境不存在');
  }

  return {
    envKey: key,
    envMeta
  };
}

/**
 * 创建会话过期定时器。
 */
function createSessionTimer(sessionId: string) {
  const timer = setTimeout(() => {
    const session = sessions.get(sessionId);

    clearSession(session);
    sessions.delete(sessionId);
  }, SESSION_TTL_MS);

  timer.unref?.();
  return timer;
}

/**
 * 自动打开登录地址，打开失败时保留手动登录会话。
 */
async function openLoginUrl(page: Page, url: string) {
  try {
    // 登录页本身可能位于慢内网，30 秒超时后仍允许用户在已打开浏览器中手动刷新或输入地址。
    await page.goto(url, { timeout: LOGIN_NAV_TIMEOUT_MS });
    return '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return `浏览器已打开，但目标页面自动打开失败：${message}。请在浏览器中手动刷新或输入地址，登录后返回本页面保存登录态。`;
  }
}

/**
 * 判断会话是否已过期。
 */
function isSessionExpired(createdAt: string) {
  return Date.now() - Date.parse(createdAt) >= SESSION_TTL_MS;
}

/**
 * 清理会话关联资源。
 */
function clearSession(session: ManualSession | undefined) {
  if (!session) {
    return;
  }

  clearTimeout(session.timer);

  if (session.browser) {
    session.browser.close().catch(() => {});
  }
}
