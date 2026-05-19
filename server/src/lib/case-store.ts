import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
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
 * 生成连续的用例标识。
 */
async function getNextCaseKey(projectKey: string) {
  const items = await listCases(projectKey);

  // 第一版先使用顺序编号，避免中文名称转拼音带来额外依赖。
  return `case-${items.length + 1}`;
}

/**
 * 写入可迁移的 Playwright 测试文件。
 */
async function writeSpec(projectKey: string, item: CaseMeta) {
  await writeFile(join(getCasePath(projectKey, item.key), 'case.spec.ts'), generateSpec(item), 'utf8');
}
