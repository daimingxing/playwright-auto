import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta } from '../../../shared/types';
import { ensureDir, movePath, readJson, writeJson } from './fs';
import { getCasePath, getProjectPath, getTrashPath } from './path';
import { expirePracticalReviewIfNeeded } from './practical-review-store';
import { createCaseSchema } from './schema';
import { generateSpec } from '../services/case-generator';
import { reviewCase } from '../services/case-review';

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
  item.review = reviewCase(item);

  await ensureDir(getCasePath(projectKey, caseKey));
  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  await writeSpec(projectKey, item);

  return item;
}

/**
 * 复制已有用例为新的独立用例。
 */
export async function copyCase(projectKey: string, caseKey: string) {
  const source = await getCase(projectKey, caseKey);
  const nextKey = await getNextCaseKey(projectKey);
  const now = new Date().toISOString();
  const item: CaseMeta = {
    name: await getCopyName(projectKey, source.name),
    key: nextKey,
    startPath: source.startPath,
    steps: source.steps,
    createdAt: now,
    updatedAt: now
  };
  item.review = reviewCase(item);

  await ensureDir(getCasePath(projectKey, nextKey));
  await writeJson(join(getCasePath(projectKey, nextKey), 'case.json'), item);
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

  return Promise.all(items.map((item) => ensureReview(projectKey, item)));
}

/**
 * 读取单个用例。
 */
export async function getCase(projectKey: string, caseKey: string) {
  return ensureReview(projectKey, await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json')));
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
  const trashKey = await getUniqueCaseKey(projectKey, caseKey, { group: 'cases', caseKey });
  const item = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));

  item.key = trashKey;
  item.updatedAt = new Date().toISOString();
  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  await writeSpec(projectKey, item, caseKey);
  await movePath(getCasePath(projectKey, caseKey), getTrashPath(projectKey, trashKey));
}

/**
 * 将回收站中的用例恢复到可用用例目录。
 */
export async function restoreTrashCase(projectKey: string, caseKey: string) {
  const targetKey = await getUniqueCaseKey(projectKey, caseKey, { group: 'trash', caseKey });
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
  const previous = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
  const item: CaseMeta = {
    ...input,
    key: caseKey,
    practicalReview: previous.practicalReview,
    updatedAt: new Date().toISOString()
  };
  item.review = reviewCase(item);

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  await writeSpec(projectKey, item);

  return expirePracticalReviewIfNeeded(projectKey, item);
}

/**
 * 生成带时间和短随机后缀的用例标识。
 */
async function getNextCaseKey(projectKey: string) {
  const keys = await getAllCaseKeys(projectKey);
  let caseKey = createCaseKey();

  while (keys.has(caseKey)) {
    caseKey = createCaseKey();
  }

  return caseKey;
}

/**
 * 获取移动用例时可使用的全局唯一标识。
 */
async function getUniqueCaseKey(projectKey: string, caseKey: string, source?: { group: 'cases' | 'trash'; caseKey: string }) {
  const keys = await getAllCaseKeys(projectKey, source);

  if (!keys.has(caseKey)) {
    return caseKey;
  }

  let index = 1;
  let nextKey = `${caseKey}-${index}`;

  while (keys.has(nextKey)) {
    index += 1;
    nextKey = `${caseKey}-${index}`;
  }

  return nextKey;
}

/**
 * 读取 cases 和 trash 共用命名空间中的所有用例标识。
 */
async function getAllCaseKeys(projectKey: string, source?: { group: 'cases' | 'trash'; caseKey: string }) {
  const keys = new Set<string>();
  const roots: Array<{ group: 'cases' | 'trash'; path: string }> = [
    { group: 'cases', path: join(getProjectPath(projectKey), 'cases') },
    { group: 'trash', path: join(getProjectPath(projectKey), 'trash') }
  ];

  for (const root of roots) {
    if (!existsSync(root.path)) {
      continue;
    }

    for (const name of await readdir(root.path)) {
      if (source?.group === root.group && source.caseKey === name) {
        continue;
      }

      keys.add(name);
    }
  }

  return keys;
}

/**
 * 生成不会和当前用例列表重名的副本名称。
 */
async function getCopyName(projectKey: string, name: string) {
  const names = new Set((await listCases(projectKey)).map((item) => item.name));
  const baseName = `${name} 副本`;

  if (!names.has(baseName)) {
    return baseName;
  }

  // 基础副本名已占用时，从 2 开始保持常见副本命名习惯。
  let index = 2;
  let nextName = `${baseName} ${index}`;

  while (names.has(nextName)) {
    index += 1;
    nextName = `${baseName} ${index}`;
  }

  return nextName;
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
async function writeSpec(projectKey: string, item: CaseMeta, caseKey = item.key) {
  await writeFile(join(getCasePath(projectKey, caseKey), 'case.spec.ts'), generateSpec(item), 'utf8');
}

/**
 * 为历史用例补充静态审查结果。
 */
async function ensureReview(projectKey: string, item: CaseMeta) {
  const nextItem = item.review
    ? item
    : {
        ...item,
        review: reviewCase(item)
      };

  if (!item.review) {
    await writeJson(join(getCasePath(projectKey, item.key), 'case.json'), nextItem);
  }

  return expirePracticalReviewIfNeeded(projectKey, nextItem);
}
