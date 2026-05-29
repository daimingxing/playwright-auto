import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta, CaseStatus, CaseStep } from '../../../shared/types';
import { ensureDir, movePath, readJson, writeJson } from './fs';
import { getCasePath, getProjectPath, getTrashPath } from './path';
import { expirePracticalReviewIfNeeded, resolvePracticalReviewView } from './practical-review-store';
import { createCaseSchema } from './schema';
import { generateSpec } from '../services/case/case-generator';
import { isReviewPassed, reviewCase } from '../services/case-review';
import { HttpError, badRequest } from './http-error';

interface CreateCaseInput {
  name: string;
  startPath: string;
}

export interface CreateCaseDraftInput {
  name: string;
  startPath: string;
  steps: CaseStep[];
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
    status: 'draft',
    startPath: value.startPath,
    steps: [],
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(getCasePath(projectKey, caseKey));
  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);

  return item;
}

/**
 * 直接创建带步骤的草稿用例。
 */
export async function createCaseDraft(projectKey: string, input: CreateCaseDraftInput) {
  const created = await createCase(projectKey, {
    name: input.name,
    startPath: input.startPath
  });

  return updateCaseDraft(projectKey, created.key, {
    ...created,
    steps: input.steps
  });
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
    status: 'draft',
    startPath: source.startPath,
    steps: source.steps,
    review: source.review,
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(getCasePath(projectKey, nextKey));
  await writeJson(join(getCasePath(projectKey, nextKey), 'case.json'), item);

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

  return items.map((item) => deriveCaseView(item).item);
}

/**
 * 读取单个用例。
 */
export async function getCase(projectKey: string, caseKey: string) {
  const item = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));

  return deriveCaseView(item).item;
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
  // 删除草稿用例时不能重新生成 spec，否则基础检查不通过的草稿会被阻断删除。
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
 * 保存草稿并执行基础检查，不生成测试文件。
 */
export async function updateCaseDraft(projectKey: string, caseKey: string, input: CaseMeta) {
  return saveCase(projectKey, caseKey, input, { generateSpecFile: false, status: 'draft' });
}

/**
 * 更新结构化用例并重新生成测试文件。
 */
export async function updateCase(projectKey: string, caseKey: string, input: CaseMeta) {
  return saveCase(projectKey, caseKey, input, { generateSpecFile: true });
}

/**
 * 保存结构化用例并按需要生成测试文件。
 */
async function saveCase(projectKey: string, caseKey: string, input: CaseMeta, options: { generateSpecFile: boolean; status?: CaseStatus }) {
  const previous = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
  const item: CaseMeta = {
    ...input,
    key: caseKey,
    status: options.status ?? readCaseStatus(input.status),
    practicalReview: previous.practicalReview,
    updatedAt: new Date().toISOString()
  };
  item.review = reviewCase(item);

  if (options.generateSpecFile) {
    assertReviewPassedForSpec(item, '基础检查不通过，不能生成测试文件');
  }

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);

  if (options.generateSpecFile) {
    await writeSpec(projectKey, item);
  }

  return syncCaseDerivedState(projectKey, caseKey);
}

/**
 * 更新单条用例状态。
 */
export async function updateCaseStatus(projectKey: string, caseKey: string, status: CaseStatus) {
  const item = await syncCaseDerivedState(projectKey, caseKey);
  assertCaseStatusAllowed(item, status);

  const nextItem: CaseMeta = {
    ...item,
    status,
    updatedAt: new Date().toISOString()
  };

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), nextItem);
  if (status !== 'draft') {
    await writeSpec(projectKey, nextItem);
  }

  return nextItem;
}

/**
 * 显式同步用例的派生状态到磁盘。
 */
export async function syncCaseDerivedState(projectKey: string, caseKey: string) {
  const raw = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
  const result = deriveCaseView(raw);

  if (result.dirty) {
    await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), result.item);
  }

  return result.item;
}

/**
 * 批量更新用例状态并返回逐条结果。
 */
export async function batchUpdateCaseStatus(projectKey: string, caseKeys: string[], status: CaseStatus) {
  if (caseKeys.length === 0) {
    throw badRequest('请选择至少一条测试用例');
  }

  const updated: Array<{ caseKey: string; status: CaseStatus }> = [];
  const failed: Array<{ caseKey: string; message: string; issues?: ReturnType<typeof toReviewIssues> }> = [];

  for (const caseKey of caseKeys) {
    try {
      await updateCaseStatus(projectKey, caseKey, status);
      updated.push({ caseKey, status });
    } catch (error) {
      failed.push({
        caseKey,
        message: error instanceof Error ? error.message : '状态更新失败',
        issues: error instanceof HttpError && hasIssues(error.details) ? error.details.issues : undefined
      });
    }
  }

  return { updated, failed };
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
 * 派生用例读取视图并兼容历史数据。
 */
function deriveCaseView(item: CaseMeta) {
  const itemWithStatus = {
    ...item,
    status: readCaseStatus(item.status)
  };
  const nextItem = itemWithStatus.review || itemWithStatus.steps.length === 0
    ? itemWithStatus
    : {
        ...itemWithStatus,
        review: reviewCase(itemWithStatus)
      };
  const reviewDirty = !item.review && item.steps.length > 0;
  const statusDirty = item.status !== nextItem.status;
  const practicalResult = resolvePracticalReviewView(nextItem);

  return {
    item: practicalResult.item,
    dirty: reviewDirty || statusDirty || practicalResult.dirty
  };
}

/**
 * 读取用例状态并兼容历史数据。
 */
function readCaseStatus(status: unknown): CaseStatus {
  return status === 'ready' || status === 'active' ? status : 'draft';
}

/**
 * 判断状态切换是否满足基础检查门槛。
 */
function assertCaseStatusAllowed(item: CaseMeta, status: CaseStatus) {
  if (status === 'draft') {
    return;
  }

  assertReviewPassedForSpec(item, '基础检查不通过，不能切换用例状态');
}

/**
 * 阻断无法生成测试文件的基础检查结果。
 */
function assertReviewPassedForSpec(item: CaseMeta, message: string) {
  if (isReviewPassed(item.review)) {
    return;
  }

  throw badRequest(message, { issues: toReviewIssues(item) });
}

/**
 * 生成前端可展示的基础检查阻断项。
 */
function toReviewIssues(item: CaseMeta) {
  return (item.review?.items ?? [])
    .filter((issue) => issue.level === 'error' || issue.level === 'danger')
    .map((issue) => ({
      stepId: issue.stepId,
      stepIndex: issue.stepIndex,
      level: issue.level,
      group: issue.group,
      ruleCode: issue.ruleCode,
      message: issue.message,
      suggestion: issue.suggestion
    }));
}

/**
 * 判断错误详情是否包含基础检查问题列表。
 */
function hasIssues(details: unknown): details is { issues: ReturnType<typeof toReviewIssues> } {
  return typeof details === 'object' && details !== null && 'issues' in details;
}
