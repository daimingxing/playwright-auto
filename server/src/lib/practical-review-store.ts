import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta, PracticalReviewRecord, PracticalReviewSummary } from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { getCasePath, getPracticalReviewPath, getPracticalReviewsPath } from './path';
import { assertReviewId } from './guard';

/**
 * 创建实测检查记录编号。
 */
export function createPracticalReviewId() {
  const now = new Date();

  return `review-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomUUID().slice(0, 8)}`;
}

/**
 * 计算实测检查对应的用例和环境快照。
 */
export function createCaseSnapshotHash(item: CaseMeta, envKey: string, envBaseUrl: string) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        envKey,
        envBaseUrl,
        name: item.name,
        startPath: item.startPath,
        steps: item.steps
      })
    )
    .digest('hex');
}

/**
 * 保存一条实测检查记录。
 */
export async function savePracticalReviewRecord(projectKey: string, record: PracticalReviewRecord) {
  assertReviewId(record.id);

  const dir = getPracticalReviewPath(projectKey, record.id);
  await ensureDir(dir);
  await writeJson(join(dir, 'review.json'), record);

  return record;
}

/**
 * 读取一条实测检查记录。
 */
export async function readPracticalReviewRecord(projectKey: string, reviewId: string) {
  assertReviewId(reviewId);

  return readJson<PracticalReviewRecord>(join(getPracticalReviewPath(projectKey, reviewId), 'review.json'));
}

/**
 * 读取项目或用例下的实测检查记录。
 */
export async function listPracticalReviewRecords(projectKey: string, caseKey?: string) {
  const root = getPracticalReviewsPath(projectKey);
  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const records = await Promise.all(
    names.map(async (name) => {
      try {
        const record = await readPracticalReviewRecord(projectKey, name);

        return caseKey && record.caseKey !== caseKey ? null : record;
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((item): item is PracticalReviewRecord => Boolean(item))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id));
}

/**
 * 把最新实测检查摘要写回用例。
 */
export async function updateLatestPracticalReview(projectKey: string, caseKey: string, summary: PracticalReviewSummary) {
  const item = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
  const nextItem: CaseMeta = {
    ...item,
    practicalReview: summary
  };

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), nextItem);

  return nextItem;
}

/**
 * 如果用例或环境和最近实测检查快照不一致，则标记为过期。
 */
export async function expirePracticalReviewIfNeeded(projectKey: string, item: CaseMeta, envBaseUrl?: string) {
  const summary = item.practicalReview;
  if (!summary || summary.status === 'untested' || summary.status === 'expired') {
    return item;
  }

  const currentHash = createCaseSnapshotHash(item, summary.envKey, envBaseUrl ?? summary.envBaseUrl);
  if (currentHash === summary.caseSnapshotHash) {
    return item;
  }

  const nextItem: CaseMeta = {
    ...item,
    practicalReview: {
      ...summary,
      status: 'expired'
    }
  };

  await writeJson(join(getCasePath(projectKey, item.key), 'case.json'), nextItem);

  return nextItem;
}

/**
 * 清理过期或超过数量上限的实测检查记录。
 */
export async function cleanupPracticalReviews(
  projectKey: string,
  options: { now?: Date; maxAgeDays?: number; maxRecords?: number } = {}
) {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? 7;
  const maxRecords = options.maxRecords ?? 20;
  const records = await listPracticalReviewRecords(projectKey);
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const keepIds = new Set(records.slice(0, maxRecords).map((record) => record.id));

  await Promise.all(
    records.map(async (record) => {
      const tooOld = new Date(record.startedAt).getTime() < cutoff;
      const tooMany = !keepIds.has(record.id);

      if (tooOld || tooMany) {
        await rm(getPracticalReviewPath(projectKey, record.id), { recursive: true, force: true });
      }
    })
  );
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
