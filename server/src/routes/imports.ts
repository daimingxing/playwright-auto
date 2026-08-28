import { Router, type Request } from 'express';
import multer from 'multer';
import { cleanupImportTask, createImportTask, deleteImportTask, getImportTask, listImportTasks, resumeImportTask } from '../lib/import-store';
import { badRequest } from '../lib/http-error';
import type { AgentRunner } from '../services/import/agent-runner';
import { createDefaultAgentRunner } from '../services/import/opencode-runner';
import { confirmImportCase, startRetryImportCase, startReviewImportTask, unconfirmImportCase } from '../services/import/import-review';
import { publishImportCase } from '../services/import/import-publish';

interface ProjectParams {
  projectKey: string;
}

interface ImportTaskParams extends ProjectParams {
  taskId: string;
}

interface ImportCaseParams extends ImportTaskParams {
  caseId: string;
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1
  }
});

export const importsRouter = Router({ mergeParams: true });

importsRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listImportTasks(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

importsRouter.post('/', (req: Request, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      next(toUploadError(error));
      return;
    }

    createImportFromUpload(req)
      .then((task) => {
        res.status(201).json(task);
      })
      .catch(next);
  });
});

importsRouter.get<ImportTaskParams>('/:taskId', async (req, res, next) => {
  try {
    res.json(await getImportTask(req.params.projectKey, req.params.taskId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportTaskParams>('/:taskId/resume', async (req, res, next) => {
  try {
    res.json(await resumeImportTask(req.params.projectKey, req.params.taskId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportTaskParams>('/:taskId/cleanup', async (req, res, next) => {
  try {
    res.json(await cleanupImportTask(req.params.projectKey, req.params.taskId));
  } catch (error) {
    next(error);
  }
});

importsRouter.delete<ImportTaskParams>('/:taskId', async (req, res, next) => {
  try {
    await deleteImportTask(req.params.projectKey, req.params.taskId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportTaskParams>('/:taskId/review', async (req, res, next) => {
  try {
    res.json(await startReviewImportTask(req.params.projectKey, req.params.taskId, getAgentRunner(req)));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportCaseParams>('/:taskId/cases/:caseId/confirm', async (req, res, next) => {
  try {
    res.json(await confirmImportCase(req.params.projectKey, req.params.taskId, req.params.caseId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportCaseParams>('/:taskId/cases/:caseId/unconfirm', async (req, res, next) => {
  try {
    res.json(await unconfirmImportCase(req.params.projectKey, req.params.taskId, req.params.caseId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportCaseParams>('/:taskId/cases/:caseId/retry', async (req, res, next) => {
  try {
    res.json(
      await startRetryImportCase(req.params.projectKey, req.params.taskId, req.params.caseId, getAgentRunner(req))
    );
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportCaseParams>('/:taskId/cases/:caseId/publish', async (req, res, next) => {
  try {
    res.json(await publishImportCase(req.params.projectKey, req.params.taskId, req.params.caseId));
  } catch (error) {
    next(error);
  }
});

/**
 * 从 multipart 上传创建导入任务，缺少文件时直接返回参数错误。
 */
async function createImportFromUpload(req: Request) {
  const file = req.file;

  if (!file?.buffer) {
    throw badRequest('请上传 Excel 文件');
  }

  return createImportTask(String(req.params.projectKey), {
    fileName: file.originalname,
    buffer: file.buffer
  });
}

/**
 * 把 multer 上传错误转换成可展示的参数错误。
 */
function toUploadError(error: unknown) {
  if (isMulterError(error) && error.code === 'LIMIT_FILE_SIZE') {
    return badRequest('文件过大，最大 10MB');
  }

  if (error instanceof Error) {
    return badRequest(error.message || '上传文件失败');
  }

  return badRequest('上传文件失败');
}

/**
 * 读取请求级 AgentRunner；未注入时回退到默认 OpenCode runner。
 */
function getAgentRunner(req: Pick<Request, 'app'>): AgentRunner {
  const runner = req.app.locals.agentRunner as AgentRunner | undefined;
  return runner ?? createDefaultAgentRunner();
}

/**
 * 判断是否为 multer 限制类错误。
 */
function isMulterError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}
