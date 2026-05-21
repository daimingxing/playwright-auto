import type { RunConfig, RunInput, RunMeta } from '../../../shared/types';
import { downloadFile } from './http';
import { requestJson } from './http';

/**
 * 获取项目测试报告列表。
 */
export function listRuns(projectKey: string) {
  return requestJson<RunMeta[]>(`/api/projects/${projectKey}/runs`);
}

/**
 * 获取运行中心配置。
 */
export function getRunConfig(projectKey: string) {
  return requestJson<RunConfig>(`/api/projects/${projectKey}/runs/config`);
}

/**
 * 按项目运行测试。
 */
export function runProject(projectKey: string, input: RunInput = {}) {
  return requestJson<RunMeta>(`/api/projects/${projectKey}/runs`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

/**
 * 删除单条测试报告。
 */
export function deleteRun(projectKey: string, runId: string) {
  return requestJson<void>(`/api/projects/${projectKey}/runs/${runId}`, {
    method: 'DELETE'
  });
}

/**
 * 下载单条测试报告压缩包。
 */
export function exportRun(projectKey: string, runId: string) {
  return downloadFile(`/api/projects/${projectKey}/runs/${runId}/export`, `${projectKey}-${runId}.zip`);
}
