import { resolve } from 'node:path';
import { getAppConfig } from './app-config';

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
  return resolve(getProjectsRoot(), projectKey);
}

/**
 * 获取单个用例的目录。
 */
export function getCasePath(projectKey: string, caseKey: string) {
  return resolve(getProjectPath(projectKey), 'cases', caseKey);
}

/**
 * 获取回收站中单个用例的目录。
 */
export function getTrashPath(projectKey: string, caseKey: string) {
  return resolve(getProjectPath(projectKey), 'trash', caseKey);
}

/**
 * 获取单次运行的目录。
 */
export function getRunPath(projectKey: string, runId: string) {
  return resolve(getProjectPath(projectKey), 'runs', runId);
}
