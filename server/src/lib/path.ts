import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getAppConfig } from './app-config';
import {
  assertCaseKey,
  assertEnvKey,
  assertImportId,
  assertImportItemId,
  assertPageMapId,
  assertPageStateId,
  assertProjectKey,
  assertReviewId,
  assertRunId,
  assertWorkId
} from './guard';

interface PageMapKeyInput {
  projectKey: string;
  envKey: string;
  targetUrl: string;
  authHash: string;
  viewport: {
    width: number;
    height: number;
  };
  uiLibrary?: 'auto' | 'native' | 'kendo';
  actionHash?: string;
}

/**
 * 获取数据根目录。
 */
export function getDataRoot() {
  return resolve(getAppConfig().server.dataRoot);
}

/**
 * 获取全部项目的根目录。
 */
export function getProjectsRoot() {
  return resolve(getDataRoot(), 'projects');
}

/**
 * 获取单个项目的根目录。
 */
export function getProjectPath(projectKey: string) {
  assertProjectKey(projectKey);
  return resolve(getProjectsRoot(), projectKey);
}

/**
 * 获取项目导入任务根目录。
 */
export function getImportsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'imports');
}

/**
 * 获取单个导入任务目录。
 */
export function getImportPath(projectKey: string, importId: string) {
  assertImportId(importId);
  return resolve(getImportsPath(projectKey), importId);
}

/**
 * 获取单个导入项文件路径。
 */
export function getImportItemPath(projectKey: string, importId: string, itemId: string) {
  assertImportItemId(itemId);
  return resolve(getImportPath(projectKey, importId), 'items', `${itemId}.json`);
}

/**
 * 获取单个用例的目录。
 */
export function getCasePath(projectKey: string, caseKey: string) {
  assertCaseKey(caseKey);
  return resolve(getProjectPath(projectKey), 'cases', caseKey);
}

/**
 * 获取回收站中单个用例的目录。
 */
export function getTrashPath(projectKey: string, caseKey: string) {
  assertCaseKey(caseKey);
  return resolve(getProjectPath(projectKey), 'trash', caseKey);
}

/**
 * 获取单次运行的目录。
 */
export function getRunPath(projectKey: string, runId: string) {
  assertRunId(runId);
  return resolve(getProjectPath(projectKey), 'runs', runId);
}

/**
 * 获取实测检查根目录。
 */
export function getPracticalReviewsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'reviews');
}

/**
 * 获取单条实测检查记录目录。
 */
export function getPracticalReviewPath(projectKey: string, reviewId: string) {
  assertReviewId(reviewId);
  return resolve(getPracticalReviewsPath(projectKey), reviewId);
}

/**
 * 获取实测检查临时工作目录。
 */
export function getPracticalReviewWorkPath(projectKey: string, workId: string) {
  assertWorkId(workId);
  return resolve(getPracticalReviewsPath(projectKey), 'work', workId);
}

/**
 * 获取项目页面地图根目录。
 */
export function getPageMapsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'page-maps');
}

/**
 * 获取单张页面地图目录。
 */
export function getPageMapPath(projectKey: string, mapId: string) {
  assertPageMapId(mapId);
  return resolve(getPageMapsPath(projectKey), mapId);
}

/**
 * 获取单张页面地图摘要文件路径。
 */
export function getPageMapFile(projectKey: string, mapId: string) {
  return resolve(getPageMapPath(projectKey, mapId), 'map.json');
}

/**
 * 获取页面地图快照文件路径。
 */
export function getPageMapShotFile(projectKey: string, mapId: string, stateId: string) {
  assertPageStateId(stateId);
  return resolve(getPageMapPath(projectKey, mapId), 'snapshots', `${stateId}.json`);
}

/**
 * 创建页面地图缓存键。
 */
export function createPageMapKey(input: PageMapKeyInput) {
  assertProjectKey(input.projectKey);
  assertEnvKey(input.envKey);

  return {
    projectKey: input.projectKey,
    envKey: input.envKey,
    targetUrl: input.targetUrl.trim(),
    authHash: input.authHash || 'no-auth',
    viewport: {
      width: input.viewport.width,
      height: input.viewport.height
    },
    // 旧缓存没有控件库字段，统一归入 auto，保证历史页面地图仍可读可匹配。
    uiLibrary: input.uiLibrary ?? 'auto',
    ...(input.actionHash ? { actionHash: input.actionHash } : {})
  };
}

/**
 * 根据缓存键生成稳定页面地图标识。
 */
export function createPageMapId(key: PageMapKeyInput) {
  const text = JSON.stringify(createPageMapKey(key));
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);

  return `pm-${hash}`;
}

/**
 * 获取登录态摘要。
 */
export async function getAuthHash(projectKey: string, envKey: string) {
  assertProjectKey(projectKey);
  assertEnvKey(envKey);

  const path = join(getProjectPath(projectKey), 'auth', `${envKey}.storageState.json`);

  if (!existsSync(path)) {
    return 'no-auth';
  }

  const stat = statSync(path);
  const content = await readFile(path);
  const hash = createHash('sha256');

  hash.update(content);
  // 文件系统时间精度在不同平台可能不同，同时纳入内容和更新时间可覆盖手动替换与同内容刷新两类变化。
  hash.update(String(stat.mtimeMs));

  return `auth-${hash.digest('hex').slice(0, 16)}`;
}
