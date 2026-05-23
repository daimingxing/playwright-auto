import type { EnvMeta, ProjectMeta } from '../../../shared/types';

interface EnvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 读取项目当前选中的环境。
 */
export function getProjectEnv(project: ProjectMeta, storage: EnvStorage = localStorage) {
  const envKey = readProjectEnvKey(project.key, storage);

  return findProjectEnv(project, envKey) ?? getDefaultEnv(project);
}

/**
 * 保存项目当前选中的环境。
 */
export function setProjectEnv(projectKey: string, envKey: string, storage: EnvStorage = localStorage) {
  storage.setItem(getStorageKey(projectKey), envKey);
}

/**
 * 读取项目默认环境。
 */
export function getDefaultEnv(project: ProjectMeta) {
  const defaultKey = project.defaultEnv ?? 'default';

  return findProjectEnv(project, defaultKey) ?? project.envs[0];
}

/**
 * 判断环境是否为项目默认环境。
 */
export function isDefaultEnv(project: ProjectMeta, env?: EnvMeta) {
  return env?.key === getDefaultEnv(project)?.key;
}

/**
 * 读取项目本地环境选择。
 */
function readProjectEnvKey(projectKey: string, storage: EnvStorage) {
  return storage.getItem(getStorageKey(projectKey)) ?? '';
}

/**
 * 根据环境标识查找环境。
 */
function findProjectEnv(project: ProjectMeta, envKey: string) {
  return project.envs.find((env) => env.key === envKey);
}

/**
 * 生成项目环境选择的本地存储键。
 */
function getStorageKey(projectKey: string) {
  return `playwright-auto:selected-env:${projectKey}`;
}
