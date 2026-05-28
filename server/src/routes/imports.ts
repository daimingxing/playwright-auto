import { existsSync } from 'node:fs';
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
  deleteImportJob,
  findImportByHash,
  getImportItem,
  getImportJob,
  listImportItems,
  listImportJobs,
  updateImportItem
} from '../lib/import-store';
import { createCaseDraft } from '../lib/case-store';
import { getCasePath } from '../lib/path';
import { listPageMaps } from '../lib/page-map-store';
import { getProject } from '../lib/project-store';
import { envKeySchema } from '../lib/schema';
import { parseImportExcel } from '../services/import/import-excel';
import { enqueueImportItem, enqueueImportJob } from '../services/import/import-worker';

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
const savingItems = new Map<string, Promise<{ itemId: string; caseKey: string }>>();

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

    const envKey = await readImportEnvKey(req.params.projectKey, req.body?.envKey);
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = await findImportByHash(req.params.projectKey, fileHash, envKey);

    if (existing) {
      res.json({ ...existing, reused: true });
      return;
    }

    const cases = await parseImportExcel(req.file.buffer);
    const job = await createImportJob(req.params.projectKey, {
      fileName: normalizeUploadName(req.file.originalname),
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

/**
 * 修正 multipart 上传中被 latin1 误读的 UTF-8 文件名。
 */
export function normalizeUploadName(fileName: string) {
  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');

  // replacement character 表示原始文件名不是可还原的 UTF-8，保留原值更安全。
  return decoded.includes('\uFFFD') ? fileName : decoded;
}

/**
 * 读取并校验导入使用的项目环境。
 */
async function readImportEnvKey(projectKey: string, value: unknown) {
  const project = await getProject(projectKey);
  const envKey = typeof value === 'string' && value.trim() ? value.trim() : project.defaultEnv || 'default';
  const parsed = envKeySchema.safeParse(envKey);

  if (!parsed.success) {
    throw badRequest('导入环境标识不合法');
  }

  if (!project.envs.some((env) => env.key === parsed.data)) {
    throw badRequest('导入环境不存在');
  }

  return parsed.data;
}

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
    res.json(await readImportItems(req.params.projectKey, req.params.importId));
  } catch (error) {
    next(error);
  }
});

importsRouter.post<ItemParams>('/:importId/items/:itemId/retry', async (req, res, next) => {
  try {
    const item = await getImportItem(req.params.projectKey, req.params.importId, req.params.itemId);
    const canRetrySaved = item.status === 'saved' && readSavedCaseState(req.params.projectKey, item.savedCaseKey) === 'missing';

    if (item.status !== 'failed' && !canRetrySaved) {
      throw badRequest('只有生成失败或草稿已不存在的导入项可以重试');
    }

    const nextItem = await updateImportItem(req.params.projectKey, req.params.importId, req.params.itemId, {
      status: 'pending',
      errorMessage: undefined,
      draft: undefined,
      aiDebug: undefined,
      review: undefined,
      savedCaseKey: undefined,
      savedCaseState: undefined,
      savedAt: undefined,
      retryCount: 0
    });
    enqueueImportItem(req.params.projectKey, req.params.importId, req.params.itemId);

    res.json(nextItem);
  } catch (error) {
    next(error);
  }
});

importsRouter.delete<ImportParams>('/:importId', async (req, res, next) => {
  try {
    await deleteImportJob(req.params.projectKey, req.params.importId);
    res.status(204).end();
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
        saved.push(await saveImportItem(req.params.projectKey, req.params.importId, itemId));
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
 * 幂等保存单个导入项为草稿用例。
 */
async function saveImportItem(projectKey: string, importId: string, itemId: string) {
  const lockKey = `${projectKey}/${importId}/${itemId}`;
  const existing = savingItems.get(lockKey);

  if (existing) {
    return existing;
  }

  const task = doSaveImportItem(projectKey, importId, itemId);
  savingItems.set(lockKey, task);

  try {
    return await task;
  } finally {
    savingItems.delete(lockKey);
  }
}

/**
 * 执行单个导入项保存。
 */
async function doSaveImportItem(projectKey: string, importId: string, itemId: string) {
  const item = await getImportItem(projectKey, importId, itemId);

  if (item.status === 'saved') {
    if (!item.savedCaseKey) {
      throw new Error('导入项已保存但缺少草稿标识');
    }

    if (readSavedCaseState(projectKey, item.savedCaseKey) === 'missing') {
      throw new Error('已保存草稿不存在，请重新生成后再保存');
    }

    return { itemId, caseKey: item.savedCaseKey };
  }

  if (item.status !== 'pendingReview' || !item.draft) {
    throw new Error('导入项尚未生成可保存草稿');
  }

  const created = await createCaseDraft(projectKey, {
    name: item.draft.name,
    startPath: item.draft.startPath,
    steps: item.draft.steps.map(toCaseStep)
  });
  await updateImportItem(projectKey, importId, itemId, {
    status: 'saved',
    savedCaseKey: created.key,
    savedAt: new Date().toISOString()
  });

  return { itemId, caseKey: created.key };
}

/**
 * 读取导入项列表并补充保存草稿引用状态。
 */
async function readImportItems(projectKey: string, importId: string) {
  const items = await listImportItems(projectKey, importId);
  const job = await getImportJob(projectKey, importId);
  const maps = await listPageMaps(projectKey);

  return items.map((item) => ({
    ...item,
    pageMap: maps.find((map) => map.envKey === job.envKey && map.targetUrl === item.source.caseInfo.targetUrl),
    savedCaseState: readSavedCaseState(projectKey, item.savedCaseKey)
  }));
}

/**
 * 判断已保存草稿是否仍然存在于可用用例列表中。
 */
function readSavedCaseState(projectKey: string, caseKey: string | undefined) {
  if (!caseKey) {
    return undefined;
  }

  return existsSync(getCasePath(projectKey, caseKey)) ? 'active' : 'missing';
}

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
