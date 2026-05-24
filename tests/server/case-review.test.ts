import { describe, expect, it } from 'vitest';
import type { CaseMeta } from '../../shared/types';
import { formatReviewSummary, getCaseCheckStatus, isReviewPassed, reviewCase } from '../../server/src/services/case-review';

function createCase(steps: CaseMeta['steps']): CaseMeta {
  return {
    name: '审查测试',
    key: 'case-review',
    status: 'draft',
    startPath: '/demo',
    steps,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z'
  };
}

describe('静态用例审查', () => {
  it('把空步骤用例标记为基础检查不通过', () => {
    const result = reviewCase(createCase([]));

    expect(result.items).toMatchObject([
      {
        level: 'danger',
        ruleCode: 'empty-steps',
        group: 'integrity',
        message: '用例至少需要包含一个测试步骤。'
      }
    ]);
    expect(isReviewPassed(result)).toBe(false);
    expect(getCaseCheckStatus({ ...createCase([]), review: result })).toBe('review-failed');
  });

  it('把缺少必填字段的步骤标记为完整性问题', () => {
    const result = reviewCase(
      createCase([
        { id: 's1', type: 'click', selector: '' },
        { id: 's2', type: 'fill', selector: "getByLabel('名称')", value: '' },
        { id: 's3', type: 'assertText', selector: "getByText('状态')", value: '' }
      ])
    );

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 's1',
          level: 'error',
          ruleCode: 'missing-selector',
          group: 'integrity'
        }),
        expect.objectContaining({
          stepId: 's2',
          level: 'error',
          ruleCode: 'missing-value',
          group: 'integrity'
        }),
        expect.objectContaining({
          stepId: 's3',
          level: 'error',
          ruleCode: 'missing-value',
          group: 'assertion'
        })
      ])
    );
    expect(result.summary.error).toBe(3);
  });

  it('把越界等待时间标记为完整性问题', () => {
    const result = reviewCase(
      createCase([
        { id: 's1', type: 'wait', timeout: 600001 },
        { id: 's2', type: 'click', selector: "getByRole('button', { name: '保存' })", timeout: -1 }
      ])
    );

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 's1',
          ruleCode: 'invalid-timeout',
          group: 'timeout'
        }),
        expect.objectContaining({
          stepId: 's2',
          ruleCode: 'invalid-timeout',
          group: 'timeout'
        })
      ])
    );
  });

  it('警告级问题不阻断基础检查通过', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "getByRole('button')"
        }
      ])
    );

    expect(result.summary.warning).toBe(1);
    expect(isReviewPassed(result)).toBe(true);
    expect(getCaseCheckStatus({ ...createCase([]), review: result })).toBe('pending-practical');
  });

  it('把 UUID id 标记为错误', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')"
        }
      ])
    );

    expect(result.items).toMatchObject([
      {
        stepId: 's1',
        level: 'error',
        ruleCode: 'dynamic-id',
        group: 'locator'
      }
    ]);
    expect(result.summary.error).toBe(1);
  });

  it('把宽泛框架下拉框选择器标记为高危', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "locator('.k-picker.k-dropdownlist.k-picker-solid.k-picker-md.k-rounded-md > .k-input-button')"
        }
      ])
    );

    expect(result.items).toMatchObject([
      {
        stepId: 's1',
        level: 'danger',
        ruleCode: 'wide-framework-selector'
      }
    ]);
  });

  it('把瞬态状态 class 标记为警告', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "locator('.k-picker.k-hover > .k-input-button')"
        }
      ])
    );

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 's1',
          level: 'warning',
          ruleCode: 'transient-state-class'
        })
      ])
    );
  });

  it('把结构顺序选择器标记为警告', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "locator('div:nth-child(2) > div:nth-child(4) > .i-row > .i-col.i-col-16')"
        }
      ])
    );

    expect(result.items).toMatchObject([
      {
        stepId: 's1',
        level: 'warning',
        ruleCode: 'structure-selector'
      }
    ]);
  });

  it('把缺少名称和区域约束的 role 定位标记为警告', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "getByRole('combobox')"
        }
      ])
    );

    expect(result.items).toMatchObject([
      {
        stepId: 's1',
        level: 'warning',
        ruleCode: 'weak-role-selector'
      }
    ]);
  });

  it('不标记带名称或区域锚点的语义定位', () => {
    const result = reviewCase(
      createCase([
        {
          id: 's1',
          type: 'click',
          selector: "getByRole('button', { name: '新增' })"
        },
        {
          id: 's2',
          type: 'click',
          selector: "getByLabel('能源计量点配置维护').getByRole('combobox').filter({ hasText: /^$/ })"
        }
      ])
    );

    expect(result.items).toEqual([]);
    expect(result.summary.level).toBe('pass');
  });

  it('只审查依赖元素定位的步骤', () => {
    const result = reviewCase(
      createCase([
        { id: 's1', type: 'goto', value: '/demo' },
        { id: 's2', type: 'assertUrl', value: '/demo' },
        { id: 's3', type: 'assertTitle', value: '首页' },
        { id: 's4', type: 'wait', timeout: 1000 }
      ])
    );

    expect(result.items).toEqual([]);
    expect(result.summary.level).toBe('pass');
  });

  it('格式化组合摘要', () => {
    const result = reviewCase(
      createCase([
        { id: 's1', type: 'click', selector: "locator('#afab153e-f49d-4716-ac77-c621ad4a2fe9')" },
        { id: 's2', type: 'click', selector: "locator('.k-picker.k-dropdownlist > .k-input-button')" },
        { id: 's3', type: 'click', selector: "locator('.k-hover')" },
        { id: 's4', type: 'click', selector: "getByRole('button')" }
      ])
    );

    expect(formatReviewSummary(result.summary)).toBe('错误 1 / 高危 1 / 警告 2');
  });

  it('根据实测结果合成检查状态', () => {
    const passed = reviewCase(createCase([{ id: 's1', type: 'wait', timeout: 1000 }]));

    expect(getCaseCheckStatus(createCase([{ id: 's1', type: 'wait', timeout: 1000 }]))).toBe('unchecked');
    expect(getCaseCheckStatus({ ...createCase([{ id: 's1', type: 'wait', timeout: 1000 }]), review: passed })).toBe(
      'pending-practical'
    );
    expect(
      getCaseCheckStatus({
        ...createCase([{ id: 's1', type: 'wait', timeout: 1000 }]),
        review: passed,
        practicalReview: {
          status: 'passed',
          envKey: 'default',
          envBaseUrl: 'https://crm.test.local',
          caseSnapshotHash: 'hash',
          stepCount: 1
        }
      })
    ).toBe('practical-passed');
    expect(
      getCaseCheckStatus({
        ...createCase([{ id: 's1', type: 'wait', timeout: 1000 }]),
        review: passed,
        practicalReview: {
          status: 'failed',
          envKey: 'default',
          envBaseUrl: 'https://crm.test.local',
          caseSnapshotHash: 'hash',
          stepCount: 1
        }
      })
    ).toBe('practical-failed');
  });
});
