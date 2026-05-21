import { Router } from 'express';
import { getProjectAuthPathByEnv, hasProjectAuth, saveLoginSession, startLoginSession } from '../services/auth-session';

interface ProjectParams {
  projectKey: string;
}

export const authRouter = Router({ mergeParams: true });

authRouter.post<ProjectParams>('/start', async (req, res, next) => {
  try {
    res.status(201).json(await startLoginSession(req.params.projectKey, req.body));
  } catch (error) {
    next(error);
  }
});

authRouter.post<ProjectParams>('/save', async (req, res, next) => {
  try {
    res.status(201).json(await saveLoginSession(req.params.projectKey, req.body.sessionId));
  } catch (error) {
    next(error);
  }
});

authRouter.get<ProjectParams>('/state', async (req, res, next) => {
  try {
    const envKey = typeof req.query.envKey === 'string' ? req.query.envKey : undefined;

    res.json({
      exists: await hasProjectAuth(req.params.projectKey, envKey),
      path: await getProjectAuthPathByEnv(req.params.projectKey, envKey)
    });
  } catch (error) {
    next(error);
  }
});
