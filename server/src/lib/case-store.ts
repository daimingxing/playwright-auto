import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta } from '../../../shared/types';
import { ensureDir, movePath, readJson, writeJson } from './fs';
import { getCasePath, getProjectPath, getTrashPath } from './path';
import { createCaseSchema } from './schema';
import { generateSpec } from '../services/case-generator';

interface CreateCaseInput {
  name: string;
  startPath: string;
}

/**
 * 创建用例目录和结构化用例文件。
 */
export async function createCase(projectKey: string, input: CreateCaseInput) {
  const value = createCaseSchema.parse(input);
  const caseKey = await getNextCaseKey(projectKey);
  const now = new Date().toISOString();
  const item: CaseMeta = {
    name: value.name,
    key: caseKey,
    startPath: value.startPath,
    steps: [],
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(getCasePath(projectKey, caseKey));
  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  await writeSpec(projectKey, item);

  return item;
}

/**
 * 读取项目下的可用用例。
 */
export async function listCases(projectKey: string) {
  const casesPath = join(getProjectPath(projectKey), 'cases');
  if (!existsSync(casesPath)) {
    return [];
  }

  const names = await readdir(casesPath);
  const items = await Promise.all(
    names.map((name) => readJson<CaseMeta>(join(casesPath, name, 'case.json')))
  );

  return items;
}

/**
 * 读取单个用例。
 */
export async function getCase(projectKey: string, caseKey: string) {
  return readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
}

/**
 * 读取项目回收站中的用例。
 */
export async function listTrash(projectKey: string) {
  const trashPath = join(getProjectPath(projectKey), 'trash');
  if (!existsSync(trashPath)) {
    return [];
  }

  const names = await readdir(trashPath);
  const items = await Promise.all(
    names.map((name) => readJson<CaseMeta>(join(trashPath, name, 'case.json')))
  );

  return items;
}

/**
 * 将用例移动到项目回收站。
 */
export async function deleteCase(projectKey: string, caseKey: string) {
  await movePath(getCasePath(projectKey, caseKey), getTrashPath(projectKey, caseKey));
}

/**
 * 将回收站中的用例恢复到可用用例目录。
 */
export async function restoreTrashCase(projectKey: string, caseKey: string) {
  const targetKey = await getRestoreCaseKey(projectKey, caseKey);
  const item = await readJson<CaseMeta>(join(getTrashPath(projectKey, caseKey), 'case.json'));

  item.key = targetKey;
  item.updatedAt = new Date().toISOString();
  await writeJson(join(getTrashPath(projectKey, caseKey), 'case.json'), item);
  await movePath(getTrashPath(projectKey, caseKey), getCasePath(projectKey, targetKey));

  return item;
}

/**
 * 从回收站中彻底删除用例目录。
 */
export async function removeTrashCase(projectKey: string, caseKey: string) {
  await rm(getTrashPath(projectKey, caseKey), { recursive: true, force: false });
}

/**
 * 更新结构化用例并重新生成测试文件。
 */
export async function updateCase(projectKey: string, caseKey: string, input: CaseMeta) {
  const item: CaseMeta = {
    ...input,
    key: caseKey,
    updatedAt: new Date().toISOString()
  };

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  await writeSpec(projectKey, item);

  return item;
}

/**
 * 生成带时间和短随机后缀的用例标识。
 */
async function getNextCaseKey(projectKey: string) {
  const items = await Promise.all([listCases(projectKey), listTrash(projectKey)]);
  const keys = new Set(items.flat().map((item) => item.key));
  let caseKey = createCaseKey();

  while (keys.has(caseKey)) {
    caseKey = createCaseKey();
  }

  return caseKey;
}

/**
 * 获取回收站恢复时可使用的用例标识。
 */
async function getRestoreCaseKey(projectKey: string, caseKey: string) {
  const items = await listCases(projectKey);
  const keys = new Set(items.map((item) => item.key));

  if (!keys.has(caseKey)) {
    return caseKey;
  }

  return getNextCaseKey(projectKey);
}

/**
 * 创建便于人工排查且不复用的用例标识。
 */
function createCaseKey() {
  const now = new Date();
  const date = formatDatePart(now);
  const time = formatTimePart(now);
  const suffix = randomBytes(2).toString('hex');

  return `case-${date}-${time}-${suffix}`;
}

/**
 * 格式化用例标识中的日期部分。
 */
function formatDatePart(date: Date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());

  return `${year}${month}${day}`;
}

/**
 * 格式化用例标识中的时间部分。
 */
function formatTimePart(date: Date) {
  const hour = padNumber(date.getHours());
  const minute = padNumber(date.getMinutes());
  const second = padNumber(date.getSeconds());

  return `${hour}${minute}${second}`;
}

/**
 * 将数字补齐为两位字符串。
 */
function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * 写入可迁移的 Playwright 测试文件。
 */
async function writeSpec(projectKey: string, item: CaseMeta) {
  await writeFile(join(getCasePath(projectKey, item.key), 'case.spec.ts'), generateSpec(item), 'utf8');
}
