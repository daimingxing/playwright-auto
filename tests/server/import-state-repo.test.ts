import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImportJob, getImportJob, listImportItems } from '../../server/src/lib/import-store';
import {
  bindGroupMeta,
  markDraftReady,
  markFailed,
  markGenerating,
  markMapFailed
} from '../../server/src/services/import/import-state-repo';
import type { AiCaseDraft, AiDebugInfo, CaseReview } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-state-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('导入项状态仓储', () => {
  it('集中写入生成状态、草稿状态和失败状态字段', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-state',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);
    const review = createReview();

    await bindGroupMeta('crm', job.importId, item.itemId, {
      groupId: 'pm-group',
      groupIndex: 0,
      pageMapId: 'pm-map'
    });
    await markGenerating('crm', job.importId, item.itemId, {
      mode: 'batch',
      fallbackReason: '分组生成失败：模拟错误'
    });
    await markDraftReady('crm', job.importId, item.itemId, {
      draft: createDraft(),
      aiDebug: undefined,
      review,
      mode: 'single',
      fallbackReason: '小批生成失败：模拟错误'
    });

    const [ready] = await listImportItems('crm', job.importId);
    const readyJob = await getImportJob('crm', job.importId);

    expect(ready).toMatchObject({
      status: 'pendingReview',
      groupId: 'pm-group',
      groupIndex: 0,
      pageMapId: 'pm-map',
      genMode: 'single',
      fallbackReason: '小批生成失败：模拟错误',
      retryCount: 0,
      review
    });
    expect(ready.errorMessage).toBeUndefined();
    expect(readyJob.generatedCount).toBe(1);

    await markFailed('crm', job.importId, item.itemId, {
      message: 'AI 未返回可用草稿',
      mode: 'group',
      retryCount: 2,
      clearDraft: true
    });

    const [failed] = await listImportItems('crm', job.importId);
    const failedJob = await getImportJob('crm', job.importId);

    expect(failed).toMatchObject({
      status: 'failed',
      errorMessage: 'AI 未返回可用草稿',
      genMode: 'group',
      retryCount: 2
    });
    expect(failed.draft).toBeUndefined();
    expect(failed.review).toBeUndefined();
    expect(failedJob.failedCount).toBe(1);
  });

  it('页面地图失败时清空可复用地图标识', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-page-map',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);

    await markMapFailed('crm', job.importId, item.itemId, {
      groupId: 'pm-group',
      groupIndex: 0,
      message: '页面地图生成失败：模拟页面不可访问'
    });

    const [failed] = await listImportItems('crm', job.importId);

    expect(failed).toMatchObject({
      status: 'failed',
      groupId: 'pm-group',
      groupIndex: 0,
      errorMessage: '页面地图生成失败：模拟页面不可访问',
      genMode: 'group',
      retryCount: 0
    });
    expect(failed.pageMapId).toBeUndefined();
  });

  it('失败补丁未传入调试信息时保留原有 AI 调试信息', async () => {
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-debug',
      envKey: 'default',
      cases: [createCase()]
    });
    const [item] = await listImportItems('crm', job.importId);
    const aiDebug = createDebug();

    await markDraftReady('crm', job.importId, item.itemId, {
      draft: createDraft(),
      aiDebug,
      review: createReview(),
      mode: 'single'
    });
    await markFailed('crm', job.importId, item.itemId, {
      message: '页面上下文采集失败',
      mode: 'single',
      retryCount: 1
    });

    const [failed] = await listImportItems('crm', job.importId);

    expect(failed.aiDebug).toEqual(aiDebug);
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

/**
 * 创建测试用 AI 草稿。
 */
function createDraft(): AiCaseDraft {
  return {
    name: '新增用户',
    startPath: '/user/list',
    confidence: 'high',
    warnings: [],
    missingInfo: [],
    steps: []
  };
}

/**
 * 创建测试用基础检查结果。
 */
function createReview(): CaseReview {
  return {
    summary: {
      level: 'pass',
      error: 0,
      danger: 0,
      warning: 0,
      info: 0
    },
    items: [],
    updatedAt: '2026-05-29T00:00:00.000Z'
  };
}

/**
 * 创建测试用 AI 调试信息。
 */
function createDebug(): AiDebugInfo {
  return {
    system: '系统提示词',
    user: '用户输入',
    response: '模型响应',
    parsed: {},
    updatedAt: '2026-05-29T00:00:00.000Z'
  };
}
