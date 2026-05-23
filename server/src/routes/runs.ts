import { stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { Router } from 'express';
import { getRunPath } from '../lib/path';
import { deleteRun, listRuns } from '../lib/run-store';
import { zipDir } from '../services/export';
import { getRunConfig, runProject } from '../services/runner';
import { badRequest, notFound } from '../lib/http-error';

interface ProjectParams {
  projectKey: string;
}

interface RunParams extends ProjectParams {
  runId: string;
}

export const runsRouter = Router({ mergeParams: true });

runsRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listRuns(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

runsRouter.get('/config', (_req, res) => {
  res.json(getRunConfig());
});

runsRouter.post<ProjectParams>('/', async (req, res, next) => {
  try {
    res.status(201).json(await runProject(req.params.projectKey, req.body));
  } catch (error) {
    next(error);
  }
});

runsRouter.get<RunParams>('/:runId/export', async (req, res, next) => {
  try {
    const runPath = getRunPath(req.params.projectKey, req.params.runId);
    await assertRunRoot(runPath);
    const file = await zipDir(runPath, `${req.params.projectKey}-${req.params.runId}`);

    res.download(file.zipPath, `${req.params.projectKey}-${req.params.runId}.zip`, (error) => {
      file.dispose().catch(next);

      if (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

runsRouter.delete<RunParams>('/:runId', async (req, res, next) => {
  try {
    await deleteRun(req.params.projectKey, req.params.runId);
    res.status(204).send();
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
    await assertReportRoot(reportPath);
    const filePath = resolveReportFile(reportPath, req.originalUrl);
    res.sendFile(filePath);
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
 * 确认运行目录已存在。
 */
async function assertRunRoot(runPath: string) {
  try {
    await stat(runPath);
  } catch {
    throw notFound('测试报告尚未生成');
  }
}

/**
 * 确认 HTML 报告首页已经生成。
 */
async function assertReportExists(reportPath: string) {
  try {
    await stat(join(reportPath, 'index.html'));
  } catch {
    throw notFound('测试报告尚未生成');
  }
}

/**
 * 确认报告目录已存在。
 */
async function assertReportRoot(reportPath: string) {
  try {
    await stat(reportPath);
  } catch {
    throw notFound('测试报告尚未生成');
  }
}

/**
 * 清理报告静态资源路径，避免访问报告目录之外的文件。
 */
function resolveReportFile(reportPath: string, url: string) {
  const marker = '/report/';
  const index = url.indexOf(marker);
  const relPath = index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : '';
  const targetPath = relPath ? resolve(reportPath, relPath) : join(reportPath, 'index.html');

  const inside = relative(reportPath, targetPath);
  if (inside.startsWith('..') || inside === '') {
    throw badRequest('报告路径不合法');
  }

  return targetPath;
}
