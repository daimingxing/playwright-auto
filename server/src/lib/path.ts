import { resolve } from 'node:path';
import { getAppConfig } from './app-config';
import {
  assertCaseKey,
  assertImportCaseId,
  assertImportTaskId,
  assertProjectKey,
  assertReviewId,
  assertRunId,
  assertWorkId
} from './guard';

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
 * 获取项目下 AI 导入任务根目录。
 */
export function getImportsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'imports');
}

/**
 * 获取单个 AI 导入任务目录。
 */
export function getImportTaskPath(projectKey: string, taskId: string) {
  assertImportTaskId(taskId);
  return resolve(getImportsPath(projectKey), taskId);
}

/**
 * 获取导入任务中单条用例初始状态目录。
 */
export function getImportCasePath(projectKey: string, taskId: string, caseId: string) {
  assertImportCaseId(caseId);
  return resolve(getImportTaskPath(projectKey, taskId), 'cases', caseId);
}
