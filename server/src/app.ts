import express from 'express';
import cors from 'cors';
import { casesRouter, trashRouter } from './routes/cases';
import { projectsRouter } from './routes/projects';
import { runsRouter } from './routes/runs';
import { authRouter } from './routes/auth';
import { recordRouter } from './routes/record';
import { RunError } from './services/runner';
import { getAppConfig } from './lib/app-config';
import { ZodError, type ZodIssue } from 'zod';

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

  app.get('/api/app-config', (_req, res) => {
    res.json({ steps: getAppConfig().steps });
  });

  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectKey/cases', casesRouter);
  app.use('/api/projects/:projectKey/cases/:caseKey/record', recordRouter);
  app.use('/api/projects/:projectKey/trash', trashRouter);
  app.use('/api/projects/:projectKey/runs', runsRouter);
  app.use('/api/projects/:projectKey/auth', authRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : '未知错误';

    if (error instanceof RunError) {
      res.status(400).json({ message, reportPath: error.reportPath, reportUrl: error.reportUrl });
      return;
    }

    if (error instanceof ZodError) {
      res.status(400).json({ message: formatZodError(error) });
      return;
    }

    res.status(400).json({ message });
  });

  return app;
}

/**
 * 把校验错误转换成用户可读的中文提示。
 */
function formatZodError(error: ZodError) {
  return error.issues.map(formatZodIssue).join('；');
}

/**
 * 格式化单个参数校验错误。
 */
function formatZodIssue(issue: ZodIssue) {
  const label = getFieldLabel(issue.path);

  if (issue.code === 'invalid_string' && issue.validation === 'url') {
    return 'URL 不合法，请输入完整 URL';
  }

  if (issue.code === 'invalid_string' && issue.validation === 'regex') {
    return `${label}不合法，只能使用小写字母、数字和短横线，并且必须以小写字母开头`;
  }

  if (issue.code === 'too_small') {
    return `${label}不能为空`;
  }

  return `${label}不合法：${issue.message}`;
}

/**
 * 获取请求字段的中文名称。
 */
function getFieldLabel(path: (string | number)[]) {
  const key = path.at(-1);

  if (key === 'baseUrl') {
    return 'URL';
  }

  if (key === 'key' || key === 'envKey' || key === 'projectKey') {
    return '标识';
  }

  if (key === 'name') {
    return '名称';
  }

  return '请求参数';
}
