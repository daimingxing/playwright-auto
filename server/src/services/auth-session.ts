import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AuthState } from '../../../shared/types';
import { writeJson } from '../lib/fs';
import { getProjectPath } from '../lib/path';
import { getProject } from '../lib/project-store';
import { getBrowserPath } from './browser-path';
import { assertVendorBrowser } from './vendor-browser';

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

interface ManualSession {
  projectKey: string;
  envKey: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  createdAt: string;
}

const sessions = new Map<string, ManualSession>();

/**
 * 打开有头浏览器让用户手动登录。
 */
export async function startLoginSession(projectKey: string, input: ManualLoginInput = {}) {
  const { envKey, envMeta } = await getAuthEnv(projectKey, input.envKey);

  if (process.env.NODE_ENV === 'test') {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      projectKey,
      envKey,
      createdAt: new Date().toISOString()
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

  sessions.set(sessionId, {
    projectKey,
    envKey,
    browser,
    context,
    page,
    createdAt: new Date().toISOString()
  });

  await page.goto(envMeta.baseUrl);

  return {
    sessionId,
    url: envMeta.baseUrl
  };
}

/**
 * 保存手动登录后的指定环境登录态。
 */
export async function saveLoginSession(projectKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey) {
    throw new Error('登录会话不存在或已过期');
  }

  const statePath = getProjectAuthPath(projectKey, session.envKey);
  if (session.context && session.browser) {
    await session.context.storageState({ path: statePath });
    await session.browser.close();
  } else {
    await createAuthState(projectKey, { cookies: [], origins: [] }, session.envKey);
  }
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
    throw new Error('登录环境不存在');
  }

  return {
    envKey: key,
    envMeta
  };
}
