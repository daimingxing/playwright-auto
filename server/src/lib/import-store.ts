import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportCaseStatus, ImportTask, ImportTaskCase, ImportTaskDetail } from '../../../shared/types';
import { parseImportExcel } from '../services/import/import-excel';
import { ensureDir, readJson, writeJson } from './fs';
import { badRequest, notFound } from './http-error';
import { getImportCasePath, getImportTaskPath, getImportsPath } from './path';
import { getProject } from './project-store';

interface CreateImportInput {
  fileName: string;
  buffer: Buffer;
}

interface ImportInputSnapshot {
  fileName: string;
  fileHash: string;
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
}

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
  const fileHash = createHash('sha256').update(input.buffer).digest('hex');
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
    createdAt: now,
    parsedCount: cases.filter((item) => item.status === 'parsed').length,
    failedCount: cases.filter((item) => item.status === 'parse-failed').length
  };
  const taskPath = getImportTaskPath(projectKey, task.id);

  try {
    await writeImportSnapshots(projectKey, task, input.buffer, {
      fileName,
      fileHash,
      byteSize: input.buffer.length,
      uploadedAt: now
    }, {
      parsedAt: now,
      cases
    });
  } catch (error) {
    await rm(taskPath, { recursive: true, force: true });
    throw error;
  }

  return { ...task, cases };
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
 * 读取导入任务、解析快照和逐用例初始状态。
 */
export async function getImportTask(projectKey: string, taskId: string): Promise<ImportTaskDetail> {
  await getProject(projectKey);

  try {
    const taskPath = getImportTaskPath(projectKey, taskId);
    const task = await readJson<ImportTask>(join(taskPath, 'task.json'));
    const parseSnapshot = await readJson<ImportParseSnapshot>(join(taskPath, 'parse.json'));
    const cases = await Promise.all(
      parseSnapshot.cases.map(async (item) => mergeCaseStatus(projectKey, taskId, item))
    );

    return { ...task, cases };
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound('导入任务不存在');
    }

    throw error;
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
 * 写入输入快照、解析快照和逐用例初始状态。
 */
async function writeImportSnapshots(
  projectKey: string,
  task: ImportTask,
  buffer: Buffer,
  input: ImportInputSnapshot,
  parseSnapshot: ImportParseSnapshot
) {
  const taskPath = getImportTaskPath(projectKey, task.id);

  await ensureDir(taskPath);
  await writeFile(join(taskPath, 'input.xlsx'), buffer);
  await writeJson(join(taskPath, 'input.json'), input);
  await writeJson(join(taskPath, 'task.json'), task);
  await writeJson(join(taskPath, 'parse.json'), parseSnapshot);

  for (const item of parseSnapshot.cases) {
    const status: ImportCaseStatusFile = {
      id: item.id,
      caseNumber: item.caseNumber,
      name: item.name,
      status: item.status,
      errors: item.errors
    };
    await writeJson(join(getImportCasePath(projectKey, task.id, item.id), 'status.json'), status);
  }
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
