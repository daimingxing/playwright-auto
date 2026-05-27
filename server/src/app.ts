import express from 'express';
import cors from 'cors';
import { casesRouter, trashRouter } from './routes/cases';
import { projectsRouter } from './routes/projects';
import { runsRouter } from './routes/runs';
import { authRouter } from './routes/auth';
import { recordRouter } from './routes/record';
import { importsRouter } from './routes/imports';
import { RunError } from './services/run/runner';
import { getAppConfig } from './lib/app-config';
import { ZodError, type ZodIssue } from 'zod';
import { HttpError } from './lib/http-error';

/**
 * 创建本地 API 服务。
 */
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new HttpError(403, '请求来源不允许访问本地服务'));
      }
    })
  );
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/app-config', (_req, res) => {
    const config = getAppConfig();

    res.json({
      steps: config.steps,
      ai: {
        enabled: config.ai.enabled,
        baseUrl: config.ai.baseUrl,
        model: config.ai.model,
        temperature: config.ai.temperature,
        timeoutMs: config.ai.timeoutMs,
        maxRetries: config.ai.maxRetries,
        concurrency: config.ai.concurrency,
        configured: Boolean(config.ai.baseUrl && config.ai.model)
      }
    });
  });

  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectKey/cases', casesRouter);
  app.use('/api/projects/:projectKey/cases/:caseKey/record', recordRouter);
  app.use('/api/projects/:projectKey/trash', trashRouter);
  app.use('/api/projects/:projectKey/runs', runsRouter);
  app.use('/api/projects/:projectKey/auth', authRouter);
  app.use('/api/projects/:projectKey/imports', importsRouter);

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

    if (error instanceof HttpError) {
      res.status(error.status).json(error.details ? { message, ...formatHttpDetails(error.details) } : { message });
      return;
    }

    if (isMissingFile(error)) {
      res.status(404).json({ message: '资源不存在' });
      return;
    }

    res.status(500).json({ message: '服务内部错误' });
  });

  return app;
}

/**
 * 格式化业务错误详情，供前端展示阻断原因。
 */
function formatHttpDetails(details: unknown) {
  return typeof details === 'object' && details !== null ? details : { details };
}

/**
 * 判断请求来源是否在允许列表中。
 */
function isAllowedOrigin(origin: string) {
  const value = normalizeOrigin(origin);
  const origins = getAppConfig().server.corsOrigins.map(normalizeOrigin);

  return origins.includes(value);
}

/**
 * 标准化来源字符串用于匹配。
 */
function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, '');
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

/**
 * 判断是否为文件不存在错误。
 */
function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
