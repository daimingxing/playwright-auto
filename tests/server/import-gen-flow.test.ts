import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImportJob, listImportItems } from '../../server/src/lib/import-store';
import { generateItems } from '../../server/src/services/import/import-gen-flow';
import type { AiCaseDraft, ImportCaseSource, ImportItem, ImportStepSource } from '../../shared/types';
import type { DraftPageMap } from '../../server/src/services/ai/ai-case-draft';
import type { PageContext } from '../../server/src/services/ai/page-context';

interface MockGroupItem {
  caseNo: string;
  draft?: AiCaseDraft;
  error?: string;
}

let root = '';
const draftStats = vi.hoisted(() => ({
  groupSizes: [] as number[],
  singleCaseNos: [] as string[],
  failGroupSizes: [] as number[],
  failSingleCaseNos: [] as string[],
  groupItems: undefined as MockGroupItem[] | undefined,
  groupErrors: [] as string[]
}));

vi.mock('../../server/src/services/ai/ai-case-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/ai/ai-case-draft')>();

  return {
    ...actual,
    generateCaseDraftGroup: vi.fn(async (input: Parameters<typeof actual.generateCaseDraftGroup>[0]) => {
      draftStats.groupSizes.push(input.cases.length);

      if (draftStats.failGroupSizes.includes(input.cases.length)) {
        throw new Error(`模拟分组失败 ${input.cases.length}`);
      }

      return {
        items: draftStats.groupItems ?? input.cases.map((item) => ({
          caseNo: item.caseInfo.caseNo,
          draft: createDraft(item.caseInfo.caseNo, item.caseInfo.targetUrl)
        })),
        groupErrors: draftStats.groupErrors,
        aiDebug: createDebug('分组')
      };
    }),
    generateCaseDraft: vi.fn(async (input: Parameters<typeof actual.generateCaseDraft>[0]) => {
      draftStats.singleCaseNos.push(input.caseInfo.caseNo);

      if (draftStats.failSingleCaseNos.includes(input.caseInfo.caseNo)) {
        throw new Error(`模拟单条失败 ${input.caseInfo.caseNo}`);
      }

      return {
        draft: createDraft(input.caseInfo.caseNo, input.caseInfo.targetUrl),
        aiDebug: createDebug('单条')
      };
    })
  };
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-import-gen-'));
  process.env.DATA_ROOT = root;
  draftStats.groupSizes = [];
  draftStats.singleCaseNos = [];
  draftStats.failGroupSizes = [];
  draftStats.failSingleCaseNos = [];
  draftStats.groupItems = undefined;
  draftStats.groupErrors = [];
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('导入生成降级编排', () => {
  it('分组失败后先拆批，拆批失败后降级单条生成', async () => {
    draftStats.failGroupSizes = [4, 2];
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-fallback',
      envKey: 'default',
      cases: [
        createCase('TC001'),
        createCase('TC002'),
        createCase('TC003'),
        createCase('TC004')
      ]
    });
    const items = await listImportItems('crm', job.importId);

    await generateItems({
      projectKey: 'crm',
      importId: job.importId,
      items,
      pageMap: createPageMap(),
      mode: 'group',
      readItemContext: readItemContext
    });

    const nextItems = await listImportItems('crm', job.importId);

    expect(draftStats.groupSizes).toEqual([4, 2, 2]);
    expect(draftStats.singleCaseNos).toEqual(['TC001', 'TC002', 'TC003', 'TC004']);
    expect(nextItems.every((item) => item.status === 'pendingReview')).toBe(true);
    expect(nextItems.every((item) => item.genMode === 'single')).toBe(true);
    expect(nextItems.every((item) => item.fallbackReason?.includes('模拟分组失败'))).toBe(true);
  });

  it('单条降级失败不会污染同批其他成功项', async () => {
    draftStats.failGroupSizes = [3, 2];
    draftStats.failSingleCaseNos = ['TC002'];
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-single-failed',
      envKey: 'default',
      cases: [createCase('TC001'), createCase('TC002'), createCase('TC003')]
    });
    const items = await listImportItems('crm', job.importId);

    await generateItems({
      projectKey: 'crm',
      importId: job.importId,
      items,
      pageMap: createPageMap(),
      mode: 'group',
      readItemContext: readItemContext
    });

    const nextItems = await listImportItems('crm', job.importId);
    const success = nextItems.filter((item) => item.status === 'pendingReview');
    const failed = nextItems.find((item) => item.caseNo === 'TC002');

    expect(success.map((item) => item.caseNo)).toEqual(['TC001', 'TC003']);
    expect(failed).toMatchObject({
      status: 'failed',
      genMode: 'single'
    });
    expect(failed?.errorMessage).toContain('模拟单条失败 TC002');
  });

  it('分组返回缺失编号时只失败对应项并保留组级错误', async () => {
    draftStats.groupErrors = ['模型返回未知用例编号 TC999', '模型缺少用例编号 TC001'];
    draftStats.groupItems = [
      { caseNo: 'TC002', error: '字段缺失：步骤为空' },
      { caseNo: 'TC003', draft: createDraft('TC003', '/users') },
      { caseNo: 'TC999', error: '未知用例编号' }
    ];
    const job = await createImportJob('crm', {
      fileName: 'cases.xlsx',
      fileHash: 'hash-group-error',
      envKey: 'default',
      cases: [createCase('TC001'), createCase('TC002'), createCase('TC003')]
    });
    const items = await listImportItems('crm', job.importId);

    await generateItems({
      projectKey: 'crm',
      importId: job.importId,
      items,
      pageMap: createPageMap(),
      mode: 'group',
      readItemContext: readItemContext
    });

    const nextItems = await listImportItems('crm', job.importId);
    const failedMissing = nextItems.find((item) => item.caseNo === 'TC001');
    const failedOwn = nextItems.find((item) => item.caseNo === 'TC002');
    const success = nextItems.find((item) => item.caseNo === 'TC003');

    expect(failedMissing?.errorMessage).toContain('模型缺少用例编号 TC001');
    expect(failedOwn?.errorMessage).toContain('字段缺失：步骤为空');
    expect(failedOwn?.aiDebug?.error).toContain('模型返回未知用例编号 TC999');
    expect(success?.status).toBe('pendingReview');
  });
});

/**
 * 读取单条生成使用的页面上下文。
 */
async function readItemContext() {
  return createContext('/users');
}

/**
 * 创建测试用页面地图。
 */
function createPageMap(): DraftPageMap {
  return {
    mapId: 'pm-test',
    targetUrl: '/users',
    states: [
      {
        stateId: 'state-initial',
        name: '初始页面',
        context: createContext('/users')
      }
    ],
    warnings: []
  };
}

/**
 * 创建单条导入源数据。
 */
function createCase(caseNo: string) {
  const caseInfo: ImportCaseSource = {
    caseNo,
    caseName: `${caseNo} 用例`,
    targetUrl: '/users',
    precondition: '',
    expectedResult: '操作成功',
    note: ''
  };
  const steps: ImportStepSource[] = [];

  return {
    caseInfo,
    steps,
    data: [],
    rowRefs: {
      caseRow: Number(caseNo.replace('TC', '')),
      stepRows: [],
      dataRows: []
    }
  };
}

/**
 * 创建 mock 页面上下文。
 */
function createContext(url: string): PageContext {
  return {
    page: {
      url,
      title: '用户管理',
      headings: ['用户管理']
    },
    elements: {
      buttons: [],
      inputs: [],
      selects: [],
      links: [],
      navigation: [],
      tables: []
    },
    warnings: []
  };
}

/**
 * 创建 mock AI 草稿。
 */
function createDraft(caseNo: string, targetUrl: string): AiCaseDraft {
  return {
    name: `${caseNo} 草稿`,
    startPath: targetUrl,
    confidence: 'medium',
    warnings: [],
    missingInfo: [],
    steps: []
  };
}

/**
 * 创建 mock AI 调试信息。
 */
function createDebug(name: string) {
  return {
    system: `${name}系统提示词`,
    user: `${name}用户输入`,
    response: `${name}响应`,
    parsed: {},
    updatedAt: new Date().toISOString()
  };
}
