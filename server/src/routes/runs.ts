import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Router } from 'express';
import { getRunPath } from '../lib/path';
import { exportRun } from '../services/export';
import { runProject } from '../services/runner';

interface ProjectParams {
  projectKey: string;
}

interface RunParams extends ProjectParams {
  runId: string;
}

export const runsRouter = Router({ mergeParams: true });

runsRouter.post<ProjectParams>('/', async (req, res, next) => {
  try {
    res.status(201).json(await runProject(req.params.projectKey, req.body));
  } catch (error) {
    next(error);
  }
});

runsRouter.post<RunParams>('/:runId/export', async (req, res, next) => {
  try {
    res.json({ path: await exportRun(req.params.projectKey, req.params.runId) });
  } catch (error) {
    next(error);
  }
});

runsRouter.get<RunParams>('/:runId/report', async (req, res, next) => {
  try {
    const reportPath = getReportPath(req.params.projectKey, req.params.runId);
    await assertReportExists(reportPath);
    res.sendFile(join(reportPath, 'index.html'));
  } catch (error) {
    next(error);
  }
});

runsRouter.use<RunParams>('/:runId/report', async (req, res, next) => {
  try {
    const reportPath = getReportPath(req.params.projectKey, req.params.runId);
    await assertReportExists(reportPath);
    res.sendFile(resolve(reportPath, trimReportPath(req.path)));
  } catch (error) {
    next(error);
  }
});

/**
 * 获取单次运行的 HTML 报告目录。
 */
function getReportPath(projectKey: string, runId: string) {
  return join(getRunPath(projectKey, runId), 'html-report');
}

/**
 * 确认 HTML 报告首页已经生成。
 */
async function assertReportExists(reportPath: string) {
  try {
    await stat(join(reportPath, 'index.html'));
  } catch {
    throw new Error('测试报告尚未生成');
  }
}

/**
 * 清理报告静态资源路径，避免访问报告目录之外的文件。
 */
function trimReportPath(path: string) {
  const cleanPath = path.replace(/^\/+/, '') || 'index.html';
  const resolvedPath = resolve('/', cleanPath);

  // 以虚拟根目录校验路径，防止 .. 逃逸到报告目录外。
  if (!resolvedPath.startsWith('/')) {
    throw new Error('报告路径不合法');
  }

  return resolvedPath.replace(/^\/+/, '');
}
