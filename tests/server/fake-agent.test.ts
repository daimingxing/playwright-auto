import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentRunner, applyAmbiguityPending, inferFakeOutcome, toTestIntent } from '../../server/src/services/import/agent-runner';
import { readJson } from '../../server/src/lib/fs';
import type { ExplorationResult, ImportTaskCase } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-fake-agent-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Fake AgentRunner', () => {
  it('把业务步骤转成 TestIntent，并保留工作表、行号、原始单元格和用例编号', async () => {
    const item = makeParsedCase();
    const runner = new FakeAgentRunner();
    const result = await runner.run({
      projectKey: 'crm',
      taskId: 'imp-20990101-000000-abcd',
      item,
      workDir: join(root, 'work'),
      outputDir: join(root, 'output'),
      diagnosticsDir: join(root, 'diagnostics'),
      baseUrl: 'https://crm.test.local'
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }

    expect(result.intent.steps.map((step) => step.action)).toEqual(['打开页面', '点击']);
    expect(result.intent.steps[1]?.sourceRefs[0]).toEqual({
      sheet: '步骤',
      row: 3,
      caseNumber: 'TC-001',
      cells: { 用例编号: 'TC-001', 动作类型: '点击', 目标: '提交' }
    });
    expect(result.intent.source.sheet).toBe('用例');
    expect(result.intent.pendingItems).toEqual([]);
    expect(result.exploration?.locators[result.intent.steps[1]?.id ?? '']).toMatchObject({
      selector: expect.stringContaining('getByRole')
    });
    const saved = await readJson<ExplorationResult>(join(root, 'output', 'exploration.json'));
    expect(saved.pageUrl).toBe('https://crm.test.local/orders/create');
  });

  it('按备注返回歧义和登录阻塞', () => {
    expect(inferFakeOutcome(makeParsedCase({ remark: '存在歧义' }))).toBe('ambiguity');
    expect(inferFakeOutcome(makeParsedCase({ remark: 'login required' }))).toBe('login-blocked');
    expect(toTestIntent(makeParsedCase(), true).pendingItems[0]?.message).toContain('歧义');
  });

  it('探索给出的歧义说明挂到检查文本步骤，不套成目标歧义', () => {
    const intent = toTestIntent(
      makeParsedCase({
        steps: [
          ...makeParsedCase().steps,
          {
            order: 3,
            action: '检查文本',
            target: '提示消息',
            data: '无法创建工单',
            note: '',
            source: {
              sheet: '步骤',
              row: 4,
              caseNumber: 'TC-001',
              cells: { 用例编号: 'TC-001', 动作类型: '检查文本', 目标: '提示消息' }
            }
          }
        ]
      })
    );
    applyAmbiguityPending(intent, '保存后的提示与用例不一致');
    expect(intent.pendingItems[0]?.message).toBe('保存后的提示与用例不一致');
    expect(intent.steps.find((step) => step.id === intent.pendingItems[0]?.stepId)?.action).toBe('检查文本');
  });

  it('覆盖取消、超时、进程失败和模型失败', async () => {
    expect(inferFakeOutcome(makeParsedCase({ remark: '取消' }))).toBe('cancelled');
    expect(inferFakeOutcome(makeParsedCase({ remark: 'timeout' }))).toBe('timeout');
    expect(inferFakeOutcome(makeParsedCase({ remark: '进程失败' }))).toBe('process-failed');
    expect(inferFakeOutcome(makeParsedCase({ remark: '模型失败' }))).toBe('model-failed');

    const controller = new AbortController();
    controller.abort();
    const cancelled = await new FakeAgentRunner().run(makeRunInput(makeParsedCase(), { signal: controller.signal }));
    expect(cancelled.kind).toBe('cancelled');

    const timedOut = await new FakeAgentRunner({ delayMs: 50 }).run(
      makeRunInput(makeParsedCase(), { timeoutMs: 10 })
    );
    expect(timedOut.kind).toBe('timeout');
  });
});

/**
 * 构造一条已解析用例，供 Fake Agent 单测使用。
 */
function makeParsedCase(patch: Partial<ImportTaskCase> = {}): ImportTaskCase {
  return {
    id: 'item-20990101-000000-abcd',
    caseNumber: 'TC-001',
    name: '创建订单',
    startPath: '/orders/create',
    preconditions: '已登录',
    expected: '创建成功',
    remark: '',
    status: 'parsed',
    source: {
      sheet: '用例',
      row: 2,
      caseNumber: 'TC-001',
      cells: { 用例编号: 'TC-001', 用例名称: '创建订单' }
    },
    steps: [
      {
        order: 1,
        action: '打开页面',
        target: '/orders/create',
        data: '',
        note: '',
        source: {
          sheet: '步骤',
          row: 2,
          caseNumber: 'TC-001',
          cells: { 用例编号: 'TC-001', 动作类型: '打开页面', 目标: '/orders/create' }
        }
      },
      {
        order: 2,
        action: '点击',
        target: '提交',
        data: '',
        note: '',
        source: {
          sheet: '步骤',
          row: 3,
          caseNumber: 'TC-001',
          cells: { 用例编号: 'TC-001', 动作类型: '点击', 目标: '提交' }
        }
      }
    ],
    errors: [],
    ...patch
  };
}

/**
 * 构造 Fake runner 输入。
 */
function makeRunInput(
  item: ImportTaskCase,
  extra: { signal?: AbortSignal; timeoutMs?: number } = {}
) {
  return {
    projectKey: 'crm',
    taskId: 'imp-20990101-000000-abcd',
    item,
    workDir: join(root, 'work'),
    outputDir: join(root, 'output'),
    diagnosticsDir: join(root, 'diagnostics'),
    ...extra
  };
}

