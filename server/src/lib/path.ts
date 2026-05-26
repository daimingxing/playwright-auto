import { resolve } from 'node:path';
import { getAppConfig } from './app-config';
import { assertCaseKey, assertImportId, assertImportItemId, assertProjectKey, assertReviewId, assertRunId, assertWorkId } from './guard';

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
