import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCase, getCase, updateCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import {
  cleanupPracticalReviews,
  createCaseSnapshotHash,
  listPracticalReviewRecords,
  readPracticalReviewRecord,
  savePracticalReviewRecord,
  updateLatestPracticalReview
} from '../../server/src/lib/practical-review-store';
import type { PracticalReviewRecord } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-practical-review-store-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('实测检查存储', () => {
  it('保存实测检查记录并更新用例最新摘要', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');
    const record = makeRecord(item.key, hash, 'passed');

    await savePracticalReviewRecord('crm', record);
    await updateLatestPracticalReview('crm', item.key, record.summary);

    const saved = await getCase('crm', item.key);
    const loaded = await readPracticalReviewRecord('crm', record.id);

    expect(saved.practicalReview).toMatchObject({
      status: 'passed',
      envKey: 'default',
      caseSnapshotHash: hash
    });
    expect(loaded.id).toBe(record.id);
  });

  it('用例步骤变化后最近实测检查显示过期', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');
    const record = makeRecord(item.key, hash, 'passed');

    await savePracticalReviewRecord('crm', record);
    await updateLatestPracticalReview('crm', item.key, record.summary);
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: '#save' }]
    });

    const saved = await getCase('crm', item.key);
    expect(saved.practicalReview?.status).toBe('expired');
    expect(saved.practicalReview?.reviewId).toBe(record.id);
  });

  it('清理 7 天前和超过 20 条的实测检查记录', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');

    for (let index = 0; index < 25; index += 1) {
      await savePracticalReviewRecord(
        'crm',
        makeRecord(
          item.key,
          hash,
          'passed',
          `review-${String(index).padStart(2, '0')}`,
          `2026-05-29T00:00:${String(index).padStart(2, '0')}.000Z`
        )
      );
    }

    await cleanupPracticalReviews('crm', {
      now: new Date('2026-05-30T00:00:00.000Z'),
      maxAgeDays: 7,
      maxRecords: 20
    });

    const records = await listPracticalReviewRecords('crm', item.key);
    expect(records).toHaveLength(20);
    expect(records[0].id).toBe('review-24');
    await expect(stat(join(root, 'projects', 'crm', 'reviews', 'review-00'))).rejects.toThrow();
  });
});

function makeRecord(
  caseKey: string,
  hash: string,
  status: PracticalReviewRecord['status'],
  id = 'review-1',
  startedAt = '2026-05-22T00:00:00.000Z'
): PracticalReviewRecord {
  return {
    id,
    projectKey: 'crm',
    caseKey,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    status,
    caseSnapshotHash: hash,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    steps: [],
    artifacts: [],
    summary: {
      status,
      envKey: 'default',
      envBaseUrl: 'https://crm.test.local',
      caseSnapshotHash: hash,
      stepCount: 0,
      reviewId: id,
      checkedAt: startedAt
    }
  };
}
