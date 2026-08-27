import { describe, expect, it } from 'vitest';
import { compileIntentToActions } from '../../server/src/services/import/intent-compile';
import type { ImportSourceRow, IntentStep, TestIntent } from '../../shared/types';

describe('Intent 到 Action IR', () => {
  it('把线性业务步骤转成可执行 Action Group，断言值只来自用户输入', () => {
    const intent = createIntent({
      startPath: '/orders/create',
      steps: [
        createStep('stp-1', '打开页面', '/orders/create'),
        createStep('stp-2', '填写', '名称', '测试订单'),
        createStep('stp-3', '选择', '类型', '标准'),
        createStep('stp-4', '点击', '提交'),
        createStep('stp-5', '检查可见', '成功提示'),
        createStep('stp-6', '检查文本', '提示', '创建成功')
      ]
    });

    const result = compileIntentToActions(intent);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.groups.map((group) => group.intentStepId)).toEqual([
      'stp-1',
      'stp-2',
      'stp-3',
      'stp-4',
      'stp-5',
      'stp-6'
    ]);
    expect(result.steps.map((step) => step.type)).toEqual([
      'goto',
      'fill',
      'select',
      'click',
      'assertVisible',
      'assertText'
    ]);
    expect(result.steps[0]?.value).toBe('/orders/create');
    expect(result.steps[1]).toMatchObject({
      type: 'fill',
      value: '测试订单',
      selector: expect.stringContaining('getByLabel')
    });
    expect(result.steps[3]?.selector).toContain("getByRole('button'");
    expect(result.steps[3]?.selector).toContain('提交');
    expect(result.steps[5]).toMatchObject({
      type: 'assertText',
      value: '创建成功',
      match: 'contains'
    });
    expect(result.steps.every((step) => !step.pageAlias || step.pageAlias === 'page')).toBe(true);
  });

  it('未解决歧义时不能编译为可发布 Action IR', () => {
    const intent = createIntent({
      pendingItems: [{ id: 'cfm-1', stepId: 'stp-1', message: '目标描述存在歧义' }],
      steps: [createStep('stp-1', '点击', '提交')]
    });

    const result = compileIntentToActions(intent);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues[0]?.code).toBe('unresolved-ambiguity');
  });

  it('拦截重复标识、缺失来源引用和未验证定位器', () => {
    const duplicate = createIntent({
      steps: [createStep('stp-1', '点击', '提交'), createStep('stp-1', '点击', '保存')]
    });
    const missingSource = createIntent({
      steps: [{ ...createStep('stp-2', '点击', '提交'), sourceRefs: [] }]
    });
    const unverified = createIntent({
      steps: [createStep('stp-3', '点击', '   ')]
    });
    const missingValue = createIntent({
      steps: [createStep('stp-4', '填写', '名称', '')]
    });

    expect(compileIntentToActions(duplicate)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unstable-id' })]
    });
    expect(compileIntentToActions(missingSource)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'missing-source-ref' })]
    });
    expect(compileIntentToActions(unverified)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unverified-locator' })]
    });
    expect(compileIntentToActions(missingValue)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'missing-param' })]
    });
  });

  it('空步骤不能发布', () => {
    const result = compileIntentToActions(createIntent({ steps: [] }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues[0]?.code).toBe('empty-steps');
  });
});

/**
 * 构造带稳定来源引用的测试意图。
 */
function createIntent(input: Partial<TestIntent> & { steps: IntentStep[] }): TestIntent {
  return {
    id: 'item-1',
    caseNumber: 'TC-001',
    name: '创建订单',
    startPath: '/orders/create',
    preconditions: '',
    expected: '创建成功',
    remark: '',
    source: createSource('用例', 2),
    pendingItems: [],
    ...input
  };
}

/**
 * 构造一条带稳定标识和来源引用的意图步骤。
 */
function createStep(
  id: string,
  action: IntentStep['action'],
  target: string,
  data = ''
): IntentStep {
  return {
    id,
    action,
    target,
    data,
    note: '',
    sourceRefs: [createSource('步骤', 3)]
  };
}

/**
 * 构造 Excel 来源行引用。
 */
function createSource(sheet: string, row: number): ImportSourceRow {
  return {
    sheet,
    row,
    caseNumber: 'TC-001',
    cells: {}
  };
}
