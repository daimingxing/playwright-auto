import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ImportCaseStatus,
  ImportCheckpoint,
  ImportCheckpointItem,
  ImportResumeResult,
  ImportTask,
  ImportTaskCase,
  ImportTaskDetail,
  TestAssetRef
} from '../../../shared/types';
import { parseImportExcel } from '../services/import/import-excel';
import { hashBuffer, putProjectAsset } from './asset-store';
import { ensureDir, readJson, writeFileAtomic, writeJson } from './fs';
import { badRequest, notFound } from './http-error';
import {
  getImportCasePath,
  getImportDiagnosticsPath,
  getImportInputPath,
  getImportOutputPath,
  getImportTaskPath,
  getImportWorkPath,
  getImportsPath
} from './path';
import { getProject } from './project-store';

interface CreateImportInput {
  fileName: string;
  buffer: Buffer;
}

interface ImportInputSnapshot {
  fileName: string;
  fileHash: string;
  assetId: string;
  byteSize: number;
  uploadedAt: string;
}

interface ImportParseSnapshot {
  parsedAt: string;
  cases: ImportTaskCase[];
}

interface ImportCaseStatusFile {
  id: string;
  caseNumber: string;
  name: string;
  status: ImportCaseStatus;
  errors: ImportTaskCase['errors'];
  checkpointedAt: string;
}

const IMPORT_TEMP_DIRS = ['work', 'output', 'diagnostics'] as const;

/**
 * 创建 AI 导入任务：先解析再落盘。结构错误不写任务目录。
 */
export async function createImportTask(projectKey: string, input: CreateImportInput): Promise<ImportTaskDetail> {
  await getProject(projectKey);

  const fileName = decodeUploadFileName(input.fileName);

  if (!fileName.toLowerCase().endsWith('.xlsx')) {
    throw badRequest('只支持 .xlsx 文件');
  }

  const parsed = await parseImportExcel(input.buffer);

  if (!parsed.ok) {
    throw badRequest('Excel 文件结构错误', { errors: parsed.errors });
  }

  const now = new Date().toISOString();
  const fileHash = hashBuffer(input.buffer);
  const usedCaseIds = new Set<string>();
  const cases = parsed.cases.map((item) => ({
    ...item,
    id: createUniqueImportCaseId(usedCaseIds)
  }));
  const task: ImportTask = {
    id: createImportTaskId(),
    projectKey,
    fileName,
    fileHash,
    assetId: fileHash,
    status: 'interrupted',
    createdAt: now,
    updatedAt: now,
    parsedCount: cases.filter((item) => item.status === 'parsed').length,
    failedCount: cases.filter((item) => item.status === 'parse-failed').length
  };
  const taskPath = getImportTaskPath(projectKey, task.id);

  try {
    await persistImportTask(projectKey, task, input.buffer, {
      fileName,
      fileHash,
      assetId: fileHash,
      byteSize: input.buffer.length,
      uploadedAt: now
    }, {
      parsedAt: now,
      cases
    });
  } catch (error) {
    if (existsSync(join(taskPath, 'checkpoint.json'))) {
      await markImportInterrupted(projectKey, task.id, toErrorMessage(error));
      return getImportTask(projectKey, task.id);
    }

    await rm(taskPath, { recursive: true, force: true });
    throw error;
  }

  return getImportTask(projectKey, task.id);
}

/**
 * 列出项目下的导入任务，按创建时间倒序。
 */
export async function listImportTasks(projectKey: string): Promise<ImportTask[]> {
  await getProject(projectKey);

  const names = await readdir(getImportsPath(projectKey)).catch(() => [] as string[]);
  const tasks = await Promise.all(
    names.map(async (name) => {
      try {
        return await readJson<ImportTask>(join(getImportTaskPath(projectKey, name), 'task.json'));
      } catch {
        return null;
      }
    })
  );

  return tasks
    .filter((item): item is ImportTask => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}

/**
 * 读取导入任务、检查点、解析快照和逐用例状态。
 */
export async function getImportTask(projectKey: string, taskId: string): Promise<ImportTaskDetail> {
  await getProject(projectKey);

  try {
    const taskPath = getImportTaskPath(projectKey, taskId);
    const task = await readJson<ImportTask>(join(taskPath, 'task.json'));
    const parseSnapshot = await readParseSnapshot(taskPath);
    const input = await readImportInputRef(taskPath, task);
    const checkpoint = await readImportCheckpoint(projectKey, taskId);
    const cases = await Promise.all(
      (parseSnapshot?.cases ?? []).map(async (item) => mergeCaseStatus(projectKey, taskId, item))
    );

    return { ...task, cases, checkpoint, input };
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('导入任务不存在');
    }

    throw error;
  }
}

/**
 * 从检查点恢复导入任务：跳过已成功项，补写未完成项，不重新解析 Excel。
 */
export async function resumeImportTask(projectKey: string, taskId: string): Promise<ImportResumeResult> {
  await getImportTask(projectKey, taskId);
  const taskPath = getImportTaskPath(projectKey, taskId);
  const parseSnapshot = await readParseSnapshot(taskPath);

  if (!parseSnapshot) {
    throw badRequest('解析快照缺失，无法恢复');
  }

  await ensureImportTaskLayout(projectKey, taskId);
  await restoreInputAsset(projectKey, taskId);

  const checkpoint = await readImportCheckpoint(projectKey, taskId);
  const skippedItemIds: string[] = [];
  const processedItemIds: string[] = [];
  const items = [...checkpoint.items];

  for (const item of parseSnapshot.cases) {
    const statusPath = join(getImportCasePath(projectKey, taskId, item.id), 'status.json');

    if (existsSync(statusPath)) {
      skippedItemIds.push(item.id);
      upsertCheckpointItem(items, { id: item.id, status: item.status });
      continue;
    }

    await writeCaseCheckpoint(projectKey, taskId, item);
    upsertCheckpointItem(items, { id: item.id, status: item.status });
    processedItemIds.push(item.id);
    await writeImportCheckpoint(projectKey, taskId, {
      stage: 'items',
      items
    });
  }

  await writeImportCheckpoint(projectKey, taskId, {
    stage: 'completed',
    items
  });
  await writeTaskRecord(projectKey, taskId, { status: 'completed' });

  const next = await getImportTask(projectKey, taskId);
  return { ...next, skippedItemIds, processedItemIds };
}

/**
 * 清理任务内未发布的临时资料。不影响输入/解析/检查点、正式用例或其他项目。
 */
export async function cleanupImportTask(projectKey: string, taskId: string): Promise<ImportTaskDetail> {
  await getImportTask(projectKey, taskId);

  for (const name of IMPORT_TEMP_DIRS) {
    const dir = join(getImportTaskPath(projectKey, taskId), name);
    await rm(dir, { recursive: true, force: true });
    await ensureDir(dir);
  }

  return getImportTask(projectKey, taskId);
}

/**
 * 读取任务检查点。半截临时文件不会被当作检查点；损坏的 JSON 视为缺失。
 */
export async function readImportCheckpoint(projectKey: string, taskId: string): Promise<ImportCheckpoint> {
  try {
    return await readJson<ImportCheckpoint>(join(getImportTaskPath(projectKey, taskId), 'checkpoint.json'));
  } catch {
    return {
      stage: 'input',
      updatedAt: new Date().toISOString(),
      items: []
    };
  }
}

/**
 * 还原上传文件名中的中文。部分 multipart 解析会把 UTF-8 文件名按 latin1 传入。
 */
export function decodeUploadFileName(name: string) {
  if (!name) {
    return 'upload.xlsx';
  }

  const base = name.replace(/^.*[/\\]/, '');

  if (/[\u4e00-\u9fff]/.test(base)) {
    return base;
  }

  const decoded = Buffer.from(base, 'latin1').toString('utf8');
  return decoded || base;
}

/**
 * 按阶段原子写入输入快照、解析快照和逐用例检查点。
 */
async function persistImportTask(
  projectKey: string,
  task: ImportTask,
  buffer: Buffer,
  input: ImportInputSnapshot,
  parseSnapshot: ImportParseSnapshot
) {
  const taskPath = getImportTaskPath(projectKey, task.id);

  await ensureImportTaskLayout(projectKey, task.id);
  await writeJson(join(taskPath, 'task.json'), task);

  const asset = await putProjectAsset(projectKey, buffer);
  input.assetId = asset.id;
  task.assetId = asset.id;

  await writeFileAtomic(join(getImportInputPath(projectKey, task.id), 'input.xlsx'), buffer);
  await writeJson(join(getImportInputPath(projectKey, task.id), 'input.json'), input);
  await writeImportCheckpoint(projectKey, task.id, { stage: 'input', items: [] });
  await writeTaskRecord(projectKey, task.id, { assetId: asset.id, fileHash: input.fileHash });

  await writeJson(join(taskPath, 'parse.json'), parseSnapshot);
  await writeImportCheckpoint(projectKey, task.id, { stage: 'parse', items: [] });

  const items: ImportCheckpointItem[] = [];

  for (const item of parseSnapshot.cases) {
    await writeCaseCheckpoint(projectKey, task.id, item);
    items.push({ id: item.id, status: item.status });
    await writeImportCheckpoint(projectKey, task.id, {
      stage: 'items',
      items
    });
  }

  await writeImportCheckpoint(projectKey, task.id, {
    stage: 'completed',
    items
  });
  await writeTaskRecord(projectKey, task.id, { status: 'completed' });
}

/**
 * 创建任务目录分层：input / work / output / diagnostics。
 */
async function ensureImportTaskLayout(projectKey: string, taskId: string) {
  await ensureDir(getImportInputPath(projectKey, taskId));
  await ensureDir(getImportWorkPath(projectKey, taskId));
  await ensureDir(getImportOutputPath(projectKey, taskId));
  await ensureDir(getImportDiagnosticsPath(projectKey, taskId));
  await ensureDir(join(getImportTaskPath(projectKey, taskId), 'cases'));
}

/**
 * 原子写入任务检查点。
 */
async function writeImportCheckpoint(
  projectKey: string,
  taskId: string,
  value: Pick<ImportCheckpoint, 'stage' | 'items'> & Partial<Pick<ImportCheckpoint, 'error'>>
) {
  const checkpoint: ImportCheckpoint = {
    stage: value.stage,
    updatedAt: new Date().toISOString(),
    items: value.items,
    ...(value.error ? { error: value.error } : {})
  };
  await writeJson(join(getImportTaskPath(projectKey, taskId), 'checkpoint.json'), checkpoint);
}

/**
 * 写入单条用例的 status.json 检查点。
 */
async function writeCaseCheckpoint(projectKey: string, taskId: string, item: ImportTaskCase) {
  const status: ImportCaseStatusFile = {
    id: item.id,
    caseNumber: item.caseNumber,
    name: item.name,
    status: item.status,
    errors: item.errors,
    checkpointedAt: new Date().toISOString()
  };
  await writeJson(join(getImportCasePath(projectKey, taskId, item.id), 'status.json'), status);
}

/**
 * 用落盘的用例初始状态覆盖解析快照中的状态字段。
 */
async function mergeCaseStatus(projectKey: string, taskId: string, item: ImportTaskCase) {
  const statusPath = join(getImportCasePath(projectKey, taskId, item.id), 'status.json');

  if (!existsSync(statusPath)) {
    return item;
  }

  const status = await readJson<ImportCaseStatusFile>(statusPath);
  return {
    ...item,
    status: status.status,
    errors: status.errors
  };
}

/**
 * 读取输入快照中的资产引用；兼容任务根目录下的旧 input.json。
 */
async function readImportInputRef(taskPath: string, task: ImportTask): Promise<TestAssetRef> {
  const layered = join(taskPath, 'input', 'input.json');
  const legacy = join(taskPath, 'input.json');
  const path = existsSync(layered) ? layered : legacy;

  if (!existsSync(path)) {
    return { assetId: task.assetId, fileName: task.fileName };
  }

  const snapshot = await readJson<ImportInputSnapshot>(path);
  return {
    assetId: snapshot.assetId || task.assetId,
    fileName: snapshot.fileName || task.fileName
  };
}

/**
 * 读取解析快照。缺失时返回空，恢复流程不得改去解析 Excel。
 */
async function readParseSnapshot(taskPath: string) {
  try {
    return await readJson<ImportParseSnapshot>(join(taskPath, 'parse.json'));
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * 若项目资产库缺少本任务输入文件，则从输入快照补登记，不查找其他导入任务。
 */
async function restoreInputAsset(projectKey: string, taskId: string) {
  const inputPath = resolveInputWorkbookPath(getImportTaskPath(projectKey, taskId));

  if (!inputPath) {
    return;
  }

  const buffer = await readFile(inputPath);
  await putProjectAsset(projectKey, buffer);
}

/**
 * 解析输入工作簿路径，优先分层目录，其次任务根目录。
 */
function resolveInputWorkbookPath(taskPath: string) {
  const layered = join(taskPath, 'input', 'input.xlsx');
  const legacy = join(taskPath, 'input.xlsx');

  if (existsSync(layered)) {
    return layered;
  }

  if (existsSync(legacy)) {
    return legacy;
  }

  return null;
}

/**
 * 将任务标记为中断并记下错误，供后续恢复。
 */
async function markImportInterrupted(projectKey: string, taskId: string, message: string) {
  const checkpoint = await readImportCheckpoint(projectKey, taskId);
  await writeImportCheckpoint(projectKey, taskId, {
    stage: checkpoint.stage === 'completed' ? 'items' : checkpoint.stage,
    items: checkpoint.items,
    error: { message, at: new Date().toISOString() }
  });
  await writeTaskRecord(projectKey, taskId, { status: 'interrupted' });
}

/**
 * 更新 task.json 中的部分字段。
 */
async function writeTaskRecord(projectKey: string, taskId: string, patch: Partial<ImportTask>) {
  const path = join(getImportTaskPath(projectKey, taskId), 'task.json');
  const current = await readJson<ImportTask>(path);
  const next: ImportTask = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeJson(path, next);
}

/**
 * 按条目标识插入或替换检查点中的用例记录。
 */
function upsertCheckpointItem(items: ImportCheckpointItem[], item: ImportCheckpointItem) {
  const index = items.findIndex((entry) => entry.id === item.id);

  if (index >= 0) {
    items[index] = item;
    return;
  }

  items.push(item);
}

/**
 * 生成导入任务标识。
 */
function createImportTaskId() {
  return `imp-${formatDatePart(new Date())}-${formatTimePart(new Date())}-${randomBytes(2).toString('hex')}`;
}

/**
 * 生成任务内用例条目标识，避免把 Excel 行号或数组下标当作对象 ID。
 */
function createUniqueImportCaseId(used: Set<string>) {
  let id = createImportCaseId();

  while (used.has(id)) {
    id = createImportCaseId();
  }

  used.add(id);
  return id;
}

/**
 * 生成导入用例条目标识。
 */
function createImportCaseId() {
  return `item-${formatDatePart(new Date())}-${formatTimePart(new Date())}-${randomBytes(2).toString('hex')}`;
}

/**
 * 格式化标识中的日期部分。
 */
function formatDatePart(date: Date) {
  return `${date.getFullYear()}${padNumber(date.getMonth() + 1)}${padNumber(date.getDate())}`;
}

/**
 * 格式化标识中的时间部分。
 */
function formatTimePart(date: Date) {
  return `${padNumber(date.getHours())}${padNumber(date.getMinutes())}${padNumber(date.getSeconds())}`;
}

/**
 * 将数字补齐为两位字符串。
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

/**
 * 把未知错误转成可写入检查点的短文本。
 */
function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '写入导入任务失败';
}
