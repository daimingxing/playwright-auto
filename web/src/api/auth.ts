import type { AuthState } from '../../../shared/types';
import { requestJson } from './http';

export interface LoginInput {
  envKey?: string;
}

/**
 * 打开浏览器让用户手动登录。
 */
export function startLogin(projectKey: string, input: LoginInput = {}) {
  return requestJson<{ sessionId: string; url: string }>(`/api/projects/${projectKey}/auth/start`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 保存用户手动登录后的登录态。
 */
export function saveLogin(projectKey: string, sessionId: string) {
  return requestJson<AuthState>(`/api/projects/${projectKey}/auth/save`, {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}

/**
 * 查询指定环境的登录态状态。
 */
export function getAuthState(projectKey: string, envKey?: string) {
  const query = envKey ? `?envKey=${encodeURIComponent(envKey)}` : '';

  return requestJson<{ exists: boolean; path: string }>(`/api/projects/${projectKey}/auth/state${query}`);
}
