import multer from 'multer';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseStep } from '../../../shared/types';
import { badRequest } from '../lib/http-error';
import { ensureDir } from '../lib/fs';
import { getImportPath } from '../lib/path';
import {
  createImportJob,
  findImportByHash,
  getImportItem,
  getImportJob,
  listImportItems,
  listImportJobs,
  updateImportItem
} from '../lib/import-store';
import { createCaseDraft } from '../lib/case-store';
import { parseImportExcel } from '../services/import-excel';
import { enqueueImportItem, enqueueImportJob } from '../services/import-worker';

interface ProjectParams {
  [key: string]: string;
  projectKey: string;
}

interface ImportParams extends ProjectParams {
  importId: string;
}

interface ItemParams extends ImportParams {
  itemId: string;
}

export const importsRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  // 上传模板限制为 10MB，避免本地服务被误传大文件占满内存。
  limits: { fileSize: 10 * 1024 * 1024 }
});

importsRouter.post<ProjectParams>('/ai', upload.single('file') as RequestHandler<ProjectParams>, async (req, res, next) => {
  try {
    if (!req.file) {
      throw badRequest('请上传 Excel 文件');
    }

    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = await findImportByHash(req.params.projectKey, fileHash);

    if (existing) {
      res.json({ ...existing, reused: true });
      return;
    }

    const cases = await parseImportExcel(req.file.buffer);
    const envKey = typeof req.body?.envKey === 'string' && req.body.envKey.trim() ? req.body.envKey.trim() : 'default';
    const job = await createImportJob(req.params.projectKey, {
      fileName: req.file.originalname,
      fileHash,
      envKey,
      cases
    });

    await ensureDir(getImportPath(req.params.projectKey, job.importId));
    await writeFile(join(getImportPath(req.params.projectKey, job.importId), 'source.xlsx'), req.file.buffer);
    await enqueueImportJob(req.params.projectKey, job.importId);

    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
});

importsRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listImportJobs(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

importsRouter.get<ImportParams>('/:importId', async (req, res, next) => {
  try {
    res.json(await getImportJob(req.params.projectKey, req.params.importId));
  } catch (error) {
    next(error);
  }
});

importsRouter.get<ImportParams>('/:importId/items', async (req, res, next) => {
  try {
    res.json(await listImportItems(req.params.projectKey, req.params.importId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ItemParams>('/:importId/items/:itemId/retry', async (req, res, next) => {
  try {
    const item = await getImportItem(req.params.projectKey, req.params.importId, req.params.itemId);

    if (item.status !== 'failed') {
      throw badRequest('只有生成失败的导入项可以重试');
    }

    const nextItem = await updateImportItem(req.params.projectKey, req.params.importId, req.params.itemId, {
      status: 'pending',
      errorMessage: undefined
    });
    enqueueImportItem(req.params.projectKey, req.params.importId, req.params.itemId);

    res.json(nextItem);
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ItemParams>('/:importId/items/:itemId/skip', async (req, res, next) => {
  try {
    const item = await getImportItem(req.params.projectKey, req.params.importId, req.params.itemId);

    if (item.status !== 'pendingReview' && item.status !== 'failed') {
      throw badRequest('当前导入项不能跳过');
    }

    res.json(await updateImportItem(req.params.projectKey, req.params.importId, req.params.itemId, { status: 'skipped' }));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ImportParams>('/:importId/save', async (req, res, next) => {
  try {
    const itemIds = parseItemIds(req.body);
    const saved: Array<{ itemId: string; caseKey: string }> = [];
    const failed: Array<{ itemId: string; message: string }> = [];

    for (const itemId of itemIds) {
      try {
        const item = await getImportItem(req.params.projectKey, req.params.importId, itemId);

        if (item.status === 'saved') {
          failed.push({ itemId, message: '导入项已保存' });
          continue;
        }

        if (item.status !== 'pendingReview' || !item.draft) {
          failed.push({ itemId, message: '导入项尚未生成可保存草稿' });
          continue;
        }

        const created = await createCaseDraft(req.params.projectKey, {
          name: item.draft.name,
          startPath: item.draft.startPath,
          steps: item.draft.steps.map(toCaseStep)
        });
        await updateImportItem(req.params.projectKey, req.params.importId, itemId, {
          status: 'saved',
          savedCaseKey: created.key,
          savedAt: new Date().toISOString()
        });
        saved.push({ itemId, caseKey: created.key });
      } catch (error) {
        failed.push({ itemId, message: error instanceof Error ? error.message : '保存草稿失败' });
      }
    }

    res.json({ saved, failed });
  } catch (error) {
    next(error);
  }
});

/**
 * 解析保存接口传入的导入项列表。
 */
function parseItemIds(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { itemIds?: unknown }).itemIds)) {
    throw badRequest('请选择至少一条导入项');
  }

  const itemIds = (body as { itemIds: unknown[] }).itemIds;

  if (itemIds.length === 0 || !itemIds.every((item) => typeof item === 'string' && item.trim())) {
    throw badRequest('请选择至少一条导入项');
  }

  return itemIds as string[];
}

/**
 * 转换 AI 草稿步骤为平台用例步骤。
 */
function toCaseStep(step: CaseStep & { text?: string; confidence?: unknown; warnings?: unknown }): CaseStep {
  return {
    id: step.id,
    type: step.type,
    selector: step.selector,
    value: step.value,
    timeout: step.timeout,
    match: step.match
  };
}
