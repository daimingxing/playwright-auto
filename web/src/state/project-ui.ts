import { defineStore } from 'pinia';
import type { CaseStatus } from '../../../shared/types';

export type CaseStatusFilter = 'all' | CaseStatus;

interface UiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 创建项目级 UI 状态访问器。
 */
export function createProjectUiState(storage: UiStorage = localStorage) {
  return {
    getProjectEnvKey(projectKey: string) {
      return storage.getItem(getStorageKey('selected-env', projectKey)) ?? '';
    },

    setProjectEnv(projectKey: string, envKey: string) {
      storage.setItem(getStorageKey('selected-env', projectKey), envKey);
    },

    getCaseStatusFilter(projectKey: string): CaseStatusFilter {
      const value = storage.getItem(getStorageKey('case-status-filter', projectKey));
      return value === 'draft' || value === 'ready' || value === 'active' ? value : 'all';
    },

    setCaseStatusFilter(projectKey: string, status: CaseStatusFilter) {
      storage.setItem(getStorageKey('case-status-filter', projectKey), status);
    },

    getRunCaseKeys(projectKey: string) {
      return readStringList(storage.getItem(getStorageKey('run-case-keys', projectKey)));
    },

    setRunCaseKeys(projectKey: string, caseKeys: string[]) {
      storage.setItem(getStorageKey('run-case-keys', projectKey), JSON.stringify(caseKeys));
    }
  };
}

export const useProjectUiStore = defineStore('project-ui', () => createProjectUiState());

/**
 * 生成项目级 UI 状态本地存储键。
 */
function getStorageKey(scope: string, projectKey: string) {
  return `playwright-auto:${scope}:${projectKey}`;
}

/**
 * 读取字符串数组本地存储值。
 */
function readStringList(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
