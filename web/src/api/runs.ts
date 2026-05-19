import type { RunMeta } from '../../../shared/types';
import { requestJson } from './http';

/**
 * 按项目运行测试。
 */
export function runProject(projectKey: string) {
  return requestJson<RunMeta>(`/api/projects/${projectKey}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}
