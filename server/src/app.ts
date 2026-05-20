import express from 'express';
import cors from 'cors';
import { casesRouter, trashRouter } from './routes/cases';
import { projectsRouter } from './routes/projects';
import { runsRouter } from './routes/runs';
import { authRouter } from './routes/auth';
import { recordRouter } from './routes/record';

/**
 * 创建本地 API 服务。
 */
export function createApp() {
  const app = express();

  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectKey/cases', casesRouter);
  app.use('/api/projects/:projectKey/cases/:caseKey/record', recordRouter);
  app.use('/api/projects/:projectKey/trash', trashRouter);
  app.use('/api/projects/:projectKey/runs', runsRouter);
  app.use('/api/projects/:projectKey/auth', authRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : '未知错误';
    res.status(400).json({ message });
  });

  return app;
}
