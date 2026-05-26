import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ImportItem, ImportJob } from '../../../shared/types';
import type { ParsedImportCase } from '../services/import-excel';
import { ensureDir, readJson, writeJson } from './fs';
import { getImportItemPath, getImportPath, getImportsPath } from './path';
import { notFound } from './http-error';

export interface CreateImportJobInput {
  fileName: string;
  fileHash: string;
  envKey: string;
  cases: ParsedImportCase[];
}

/**
 * 创建持久化导入任务和导入项文件。
 */
export async function createImportJob(projectKey: string, input: CreateImportJobInput) {
  const importId = await createUniqueImportId(projectKey);
  const now = new Date().toISOString();
  const job: ImportJob = {
    importId,
    fileName: input.fileName,
    fileHash: input.fileHash,
    envKey: input.envKey,
    status: 'running',
    totalCount: input.cases.length,
    generatedCount: 0,
    savedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(join(getImportPath(projectKey, importId), 'items'));
  await writeJson(getJobPath(projectKey, importId), job);

  for (const item of input.cases) {
    const itemId = await createUniqueItemId(projectKey, importId);

    await writeJson(getImportItemPath(projectKey, importId, itemId), {
      itemId,
      caseNo: item.caseInfo.caseNo,
      caseName: item.caseInfo.caseName,
      rowRefs: item.rowRefs,
      sourceHash: createSourceHash(item),
      source: {
        caseInfo: item.caseInfo,
        steps: item.steps,
        data: item.data
      },
      status: 'pending',
      retryCount: 0,
      updatedAt: now
    } satisfies ImportItem);
  }

  return job;
}

/**
 * 读取项目导入任务列表。
 */
export async function listImportJobs(projectKey: string) {
  const root = getImportsPath(projectKey);

  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const jobs = await Promise.all(
    names
      .filter((name) => existsSync(join(root, name, 'import.json')))
      .map((name) => readJson<ImportJob>(join(root, name, 'import.json')))
  );

  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 根据文件 hash 查找已有导入任务。
 */
export async function findImportByHash(projectKey: string, fileHash: string) {
  return (await listImportJobs(projectKey)).find((job) => job.fileHash === fileHash);
}

/**
 * 读取单个导入任务。
 */
export async function getImportJob(projectKey: string, importId: string) {
  try {
    return await readJson<ImportJob>(getJobPath(projectKey, importId));
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('导入任务不存在');
    }

    throw error;
  }
}

/**
 * 读取导入项列表。
 */
export async function listImportItems(projectKey: string, importId: string) {
  const itemsPath = join(getImportPath(projectKey, importId), 'items');

  if (!existsSync(itemsPath)) {
    return [];
  }

  const names = await readdir(itemsPath);
  const items = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson<ImportItem>(join(itemsPath, name)))
  );

  return items.sort((a, b) => a.caseNo.localeCompare(b.caseNo));
}

/**
 * 读取单个导入项。
 */
export async function getImportItem(projectKey: string, importId: string, itemId: string) {
  try {
    return await readJson<ImportItem>(getImportItemPath(projectKey, importId, itemId));
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('导入项不存在');
    }

    throw error;
  }
}

/**
 * 更新导入项并同步任务摘要。
 */
export async function updateImportItem(projectKey: string, importId: string, itemId: string, patch: Partial<ImportItem>) {
  const item = await getImportItem(projectKey, importId, itemId);
  const nextItem: ImportItem = {
    ...item,
    ...patch,
    itemId: item.itemId,
    updatedAt: new Date().toISOString()
  };

  await writeJson(getImportItemPath(projectKey, importId, itemId), nextItem);
  await updateImportJobSummary(projectKey, importId);

  return nextItem;
}

/**
 * 根据导入项状态刷新任务摘要。
 */
export async function updateImportJobSummary(projectKey: string, importId: string) {
  const job = await getImportJob(projectKey, importId);
  const items = await listImportItems(projectKey, importId);
  const generatedCount = items.filter((item) => item.status === 'pendingReview' || item.status === 'saved').length;
  const savedCount = items.filter((item) => item.status === 'saved').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const nextJob: ImportJob = {
    ...job,
    status: getJobStatus(items),
    generatedCount,
    savedCount,
    failedCount,
    skippedCount,
    updatedAt: new Date().toISOString()
  };

  await writeJson(getJobPath(projectKey, importId), nextJob);

  return nextJob;
}

/**
 * 获取导入任务摘要文件路径。
 */
function getJobPath(projectKey: string, importId: string) {
  return join(getImportPath(projectKey, importId), 'import.json');
}

/**
 * 生成导入任务标识。
 */
async function createUniqueImportId(projectKey: string) {
  let importId = createId('import');

  while (existsSync(getImportPath(projectKey, importId))) {
    importId = createId('import');
  }

  return importId;
}

/**
 * 生成导入项标识。
 */
async function createUniqueItemId(projectKey: string, importId: string) {
  let itemId = createId('item');

  while (existsSync(getImportItemPath(projectKey, importId, itemId))) {
    itemId = createId('item');
  }

  return itemId;
}

/**
 * 生成导入标识。
 */
function createId(prefix: 'import' | 'item') {
  const now = new Date();
  const date = formatDate(now);
  const time = formatTime(now);
  const suffix = randomBytes(2).toString('hex');

  return `${prefix}-${date}-${time}-${suffix}`;
}

/**
 * 计算导入源内容 hash。
 */
function createSourceHash(item: ParsedImportCase) {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex');
}

/**
 * 根据导入项状态推导任务状态。
 */
function getJobStatus(items: ImportItem[]): ImportJob['status'] {
  if (items.some((item) => item.status === 'pending' || item.status === 'generating')) {
    return 'running';
  }

  if (items.length > 0 && items.every((item) => item.status === 'saved' || item.status === 'skipped')) {
    return 'completed';
  }

  if (items.some((item) => item.status === 'pendingReview')) {
    return items.some((item) => item.status === 'saved' || item.status === 'skipped') ? 'partialSaved' : 'pendingReview';
  }

  return 'failed';
}

/**
 * 格式化日期部分。
 */
function formatDate(date: Date) {
  return `${date.getFullYear()}${padNumber(date.getMonth() + 1)}${padNumber(date.getDate())}`;
}

/**
 * 格式化时间部分。
 */
function formatTime(date: Date) {
  return `${padNumber(date.getHours())}${padNumber(date.getMinutes())}${padNumber(date.getSeconds())}`;
}

/**
 * 数字补零为两位。
 */
function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * 判断是否为文件不存在错误。
 */
function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
