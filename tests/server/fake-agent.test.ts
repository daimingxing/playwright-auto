import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentRunner, inferFakeOutcome, toTestIntent } from '../../server/src/services/import/agent-runner';
import type { ImportTaskCase } from '../../shared/types';

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
      diagnosticsDir: join(root, 'diagnostics')
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
  });

  it('按备注返回歧义和登录阻塞', () => {
    expect(inferFakeOutcome(makeParsedCase({ remark: '存在歧义' }))).toBe('ambiguity');
    expect(inferFakeOutcome(makeParsedCase({ remark: 'login required' }))).toBe('login-blocked');
    expect(toTestIntent(makeParsedCase(), true).pendingItems[0]?.message).toContain('歧义');
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
