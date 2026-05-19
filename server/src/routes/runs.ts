import { Router } from 'express';
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
