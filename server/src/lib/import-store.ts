import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ImportItem, ImportItemStatus, ImportJob, ImportStatus, UiLibrary } from '../../../shared/types';
import type { ParsedImportCase } from '../services/import/import-excel';
import { ensureDir, readJson, writeJson } from './fs';
import { getImportItemPath, getImportPath, getImportsPath } from './path';
import { notFound } from './http-error';

export interface CreateImportJobInput {
  fileName: string;
  fileHash: string;
  envKey: string;
  uiLibrary?: UiLibrary;
  cases: ParsedImportCase[];
}

/**
 * 单次状态转移对任务摘要计数的增量。
 */
export interface SummaryDelta {
  generatedDelta: number;
  savedDelta: number;
  failedDelta: number;
  skippedDelta: number;
}

/**
 * 写入导入项并返回前后对象，供调用方按需读取旧值。
 */
export interface ImportItemTransition {
  prev: ImportItem;
  next: ImportItem;
}

const ZERO_DELTA: SummaryDelta = {
  generatedDelta: 0,
  savedDelta: 0,
  failedDelta: 0,
  skippedDelta: 0
};
const importJobDeltaQueues = new Map<string, Promise<void>>();

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
    uiLibrary: input.uiLibrary ?? 'auto',
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
      groupId: undefined,
      groupIndex: undefined,
      rowRefs: item.rowRefs,
      sourceHash: createSourceHash(item),
      source: {
        caseInfo: item.caseInfo,
        steps: item.steps,
        data: item.data
      },
      status: 'pending',
      pageMapId: undefined,
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
 * 根据文件 hash 和导入环境查找已有导入任务。
 */
export async function findImportByHash(projectKey: string, fileHash: string, envKey: string, uiLibrary: UiLibrary = 'auto') {
  return (await listImportJobs(projectKey)).find((job) =>
    job.fileHash === fileHash &&
    job.envKey === envKey &&
    // 历史导入任务没有 uiLibrary，按 auto 参与去重，避免升级后重复打开旧任务。
    (job.uiLibrary ?? 'auto') === uiLibrary
  );
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
 * 删除单个导入任务目录。
 */
export async function deleteImportJob(projectKey: string, importId: string) {
  try {
    await rm(getImportPath(projectKey, importId), { recursive: true, force: false });
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
 * 更新导入项：仅写单条文件，并把状态转移作为增量应用到任务摘要。
 */
export async function updateImportItem(
  projectKey: string,
  importId: string,
  itemId: string,
  patch: Partial<ImportItem>
) {
  const { next } = await transitionImportItem(projectKey, importId, itemId, patch);

  return next;
}

/**
 * 把一次状态变更以“读旧值 → 写新值 → 增量改任务计数”的方式原子化。
 * 替代旧版在 updateImportItem 内做全量目录扫描的实现，避免大批量场景下的重复 I/O。
 */
export async function transitionImportItem(
  projectKey: string,
  importId: string,
  itemId: string,
  patch: Partial<ImportItem>
): Promise<ImportItemTransition> {
  const prev = await getImportItem(projectKey, importId, itemId);
  const next: ImportItem = {
    ...prev,
    ...patch,
    itemId: prev.itemId,
    updatedAt: new Date().toISOString()
  };

  await writeJson(getImportItemPath(projectKey, importId, itemId), next);
  await applyImportJobDelta(projectKey, importId, buildSummaryDelta(prev.status, next.status));

  return { prev, next };
}

/**
 * 批量更新导入项：只读一次目录、聚合计数后写一次任务摘要，适合分组生成等高频批量场景。
 */
export async function transitionImportItems(
  projectKey: string,
  importId: string,
  patches: Array<{ itemId: string; patch: Partial<ImportItem> }>
): Promise<ImportItemTransition[]> {
  if (patches.length === 0) {
    return [];
  }

  const items = await listImportItems(projectKey, importId);
  const itemMap = new Map(items.map((item) => [item.itemId, item]));
  const now = new Date().toISOString();
  const aggregate: SummaryDelta = { ...ZERO_DELTA };
  const transitions: ImportItemTransition[] = [];

  for (const { itemId, patch } of patches) {
    const prev = itemMap.get(itemId);

    if (!prev) {
      // 跳过已不存在的导入项，避免在删除任务后又收到旧事件时把任务目录“复活”。
      continue;
    }

    const next: ImportItem = {
      ...prev,
      ...patch,
      itemId: prev.itemId,
      updatedAt: now
    };
    const delta = buildSummaryDelta(prev.status, next.status);

    aggregate.generatedDelta += delta.generatedDelta;
    aggregate.savedDelta += delta.savedDelta;
    aggregate.failedDelta += delta.failedDelta;
    aggregate.skippedDelta += delta.skippedDelta;

    transitions.push({ prev, next });
  }

  await Promise.all(
    transitions.map(({ next }) => writeJson(getImportItemPath(projectKey, importId, next.itemId), next))
  );

  if (transitions.length > 0) {
    await applyImportJobDelta(projectKey, importId, aggregate);
  }

  return transitions;
}

/**
 * 把任务摘要计数变化量应用到任务文件，并按新计数重算任务状态。
 */
export async function applyImportJobDelta(
  projectKey: string,
  importId: string,
  delta: SummaryDelta
): Promise<ImportJob> {
  return runImportJobDeltaLocked(projectKey, importId, async () => applyImportJobDeltaUnlocked(projectKey, importId, delta));
}

/**
 * 串行执行同一导入任务的摘要增量写入，避免并发读改写覆盖计数。
 */
async function runImportJobDeltaLocked<T>(projectKey: string, importId: string, task: () => Promise<T>): Promise<T> {
  const key = `${projectKey}/${importId}`;
  const prev = importJobDeltaQueues.get(key) ?? Promise.resolve();
  const run = (async () => {
    // 前序写入失败也不能阻塞后续修正任务继续读取当前文件状态。
    await prev.catch(() => undefined);

    return task();
  })();
  const next = run.then(() => undefined, () => undefined);

  importJobDeltaQueues.set(key, next);

  try {
    return await run;
  } finally {
    if (importJobDeltaQueues.get(key) === next) {
      importJobDeltaQueues.delete(key);
    }
  }
}

/**
 * 执行实际摘要增量写入；调用方必须保证同一任务维度已经串行化。
 */
async function applyImportJobDeltaUnlocked(
  projectKey: string,
  importId: string,
  delta: SummaryDelta
): Promise<ImportJob> {
  const job = await getImportJob(projectKey, importId);
  const nextJob: ImportJob = {
    ...job,
    generatedCount: clampNonNegative(job.generatedCount + delta.generatedDelta),
    savedCount: clampNonNegative(job.savedCount + delta.savedDelta),
    failedCount: clampNonNegative(job.failedCount + delta.failedDelta),
    skippedCount: clampNonNegative(job.skippedCount + delta.skippedDelta),
    status: 'running',
    updatedAt: new Date().toISOString()
  };

  nextJob.status = deriveStatusFromCounts(nextJob);

  await writeJson(getJobPath(projectKey, importId), nextJob);

  return nextJob;
}

/**
 * 恢复服务中断前处于生成中的导入项。
 */
export async function recoverImportItems(projectKey: string, importId: string) {
  const items = await listImportItems(projectKey, importId);
  const recovered: string[] = [];

  for (const item of items) {
    if (item.status !== 'generating') {
      continue;
    }

    await updateImportItem(projectKey, importId, item.itemId, {
      status: 'pending',
      retryCount: 0,
      errorMessage: '上次导入生成被服务重启中断，已重新排队'
    });
    recovered.push(item.itemId);
  }

  // 恢复阶段只对受影响条目做单条 delta，结尾再校准一次以兜底历史状态异常。
  if (recovered.length > 0) {
    await rebuildImportJobSummary(projectKey, importId);
  }

  return recovered;
}

/**
 * 低频使用的全量重建入口：仅在恢复任务、数据修复或校验脚本里调用。
 */
export async function rebuildImportJobSummary(projectKey: string, importId: string) {
  const job = await getImportJob(projectKey, importId);
  const items = await listImportItems(projectKey, importId);
  const generatedCount = items.filter((item) => item.status === 'pendingReview' || item.status === 'saved').length;
  const savedCount = items.filter((item) => item.status === 'saved').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const nextJob: ImportJob = {
    ...job,
    status: 'running',
    generatedCount,
    savedCount,
    failedCount,
    skippedCount,
    updatedAt: new Date().toISOString()
  };

  nextJob.status = deriveStatusFromCounts(nextJob);

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
 * 把单项状态转移换算成对任务摘要计数的增量。
 */
function buildSummaryDelta(prevStatus: ImportItemStatus, nextStatus: ImportItemStatus): SummaryDelta {
  return {
    generatedDelta: contributesToGenerated(nextStatus) - contributesToGenerated(prevStatus),
    savedDelta: contributesToSaved(nextStatus) - contributesToSaved(prevStatus),
    failedDelta: contributesToFailed(nextStatus) - contributesToFailed(prevStatus),
    skippedDelta: contributesToSkipped(nextStatus) - contributesToSkipped(prevStatus)
  };
}

function contributesToGenerated(status: ImportItemStatus) {
  return status === 'pendingReview' || status === 'saved' ? 1 : 0;
}

function contributesToSaved(status: ImportItemStatus) {
  return status === 'saved' ? 1 : 0;
}

function contributesToFailed(status: ImportItemStatus) {
  return status === 'failed' ? 1 : 0;
}

function contributesToSkipped(status: ImportItemStatus) {
  return status === 'skipped' ? 1 : 0;
}

/**
 * 从任务摘要计数推导出任务状态，避免在高频更新路径里再读一次全量 item。
 */
function deriveStatusFromCounts(job: ImportJob): ImportStatus {
  const inProgressCount =
    job.totalCount - job.generatedCount - job.failedCount - job.skippedCount;
  const pendingReviewCount = job.generatedCount - job.savedCount;
  const hasSavedOrSkipped = job.savedCount + job.skippedCount > 0;

  if (inProgressCount > 0) {
    return 'running';
  }

  if (job.totalCount > 0 && pendingReviewCount === 0 && job.failedCount === 0) {
    return 'completed';
  }

  if (pendingReviewCount > 0) {
    return hasSavedOrSkipped ? 'partialSaved' : 'pendingReview';
  }

  return 'failed';
}

/**
 * 把负数修正为 0，理论上 delta 不会越界，但保留防御避免历史脏数据把计数打成负值。
 */
function clampNonNegative(value: number) {
  return value < 0 ? 0 : value;
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
