import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AuthState } from '../../../shared/types';
import { writeJson } from '../lib/fs';
import { getProjectPath } from '../lib/path';
import { getProject } from '../lib/project-store';
import { getBrowserPath } from './browser-path';

interface StorageState {
  cookies: unknown[];
  origins: unknown[];
}

/**
 * 获取项目级登录态文件路径。
 */
export function getProjectAuthPath(projectKey: string) {
  return join(getProjectPath(projectKey), 'auth', 'default.storageState.json');
}

/**
 * 判断项目级登录态是否存在。
 */
export async function hasProjectAuth(projectKey: string) {
  return existsSync(getProjectAuthPath(projectKey));
}

/**
 * 创建项目级登录态文件。
 */
export async function createAuthState(projectKey: string, state: StorageState) {
  const path = getProjectAuthPath(projectKey);
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
  const project = await getProject(projectKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const envMeta = project.envs.find((item) => item.key === envKey);

  if (!envMeta) {
    throw new Error('登录环境不存在');
  }

  if (process.env.NODE_ENV === 'test') {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      projectKey,
      createdAt: new Date().toISOString()
    });

    return {
      sessionId,
      url: envMeta.baseUrl
    };
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath: getBrowserPath()
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const sessionId = crypto.randomUUID();

  sessions.set(sessionId, {
    projectKey,
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
 * 保存手动登录后的项目级登录态。
 */
export async function saveLoginSession(projectKey: string, sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session || session.projectKey !== projectKey) {
    throw new Error('登录会话不存在或已过期');
  }

  const statePath = getProjectAuthPath(projectKey);
  if (session.context && session.browser) {
    await session.context.storageState({ path: statePath });
    await session.browser.close();
  } else {
    await createAuthState(projectKey, { cookies: [], origins: [] });
  }
  sessions.delete(sessionId);

  return {
    path: statePath,
    createdAt: new Date().toISOString()
  } satisfies AuthState;
}
