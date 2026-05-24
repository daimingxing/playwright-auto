import type { EnvMeta, ProjectMeta } from '../../../shared/types';
import { createProjectUiState } from './project-ui';

interface EnvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 读取项目当前选中的环境。
 */
export function getProjectEnv(project: ProjectMeta, storage: EnvStorage = localStorage) {
  const envKey = createProjectUiState(storage).getProjectEnvKey(project.key);

  return findProjectEnv(project, envKey) ?? getDefaultEnv(project);
}

/**
 * 保存项目当前选中的环境。
 */
export function setProjectEnv(projectKey: string, envKey: string, storage: EnvStorage = localStorage) {
  createProjectUiState(storage).setProjectEnv(projectKey, envKey);
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
 * 根据环境标识查找环境。
 */
function findProjectEnv(project: ProjectMeta, envKey: string) {
  return project.envs.find((env) => env.key === envKey);
}
