import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImportJob, getImportJob, listImportItems, listImportJobs, updateImportItem } from '../../server/src/lib/import-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-store-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('AI 导入任务存储', () => {
  it('创建任务并读取导入项', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [createCase()]
    });

    const jobs = await listImportJobs('crm');
    const detail = await getImportJob('crm', job.importId);
    const items = await listImportItems('crm', job.importId);

    expect(jobs).toHaveLength(1);
    expect(detail.totalCount).toBe(1);
    expect(items[0].caseNo).toBe('TC001');
  });

  it('更新导入项状态并同步任务摘要', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-a',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);

    await updateImportItem('crm', job.importId, item.itemId, {
      status: 'pendingReview',
      draft: {
        name: '新增用户',
        startPath: '/user/list',
        steps: [],
        confidence: 'high',
        warnings: [],
        missingInfo: []
      }
    });

    const detail = await getImportJob('crm', job.importId);
    const items = await listImportItems('crm', job.importId);

    expect(items[0].status).toBe('pendingReview');
    expect(detail.status).toBe('pendingReview');
    expect(detail.generatedCount).toBe(1);
  });
});

/**
 * 创建单条导入源数据。
 */
function createCase() {
  return {
    caseInfo: {
      caseNo: 'TC001',
      caseName: '新增用户',
      targetUrl: '/user/list',
      precondition: '',
      expectedResult: '添加成功',
      note: ''
    },
    steps: [],
    data: [],
    rowRefs: { caseRow: 2, stepRows: [], dataRows: [] }
  };
}
