import { describe, expect, it } from 'vitest';
import { reviewCaseIntegrity } from '../../shared/case-review';
import type { CaseMeta, CaseStep } from '../../shared/types';

/**
 * 创建基础检查使用的最小用例。
 */
function makeCase(steps: CaseStep[]): CaseMeta {
  return {
    name: '示例',
    key: 'case-1',
    status: 'draft',
    startPath: '/',
    steps,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('共享基础检查', () => {
  it('检查必要字段和超时边界', () => {
    const items = reviewCaseIntegrity(makeCase([
      { id: 's1', type: 'fill', selector: '', value: '', timeout: 600001 }
    ]));

    expect(items.map((item) => item.ruleCode)).toEqual(['missing-selector', 'missing-value', 'invalid-timeout']);
  });

  it('保留无需解析表达式即可确认的定位风险', () => {
    const items = reviewCaseIntegrity(makeCase([
      { id: 's1', type: 'click', selector: '#550e8400-e29b-41d4-a716-446655440000' },
      { id: 's2', type: 'click', selector: "getByRole('button')" }
    ]));

    expect(items.map((item) => item.ruleCode)).toEqual(['dynamic-id', 'weak-role-selector']);
  });

  it('不再自行解析 Playwright 表达式语法', () => {
    const items = reviewCaseIntegrity(makeCase([
      { id: 's1', type: 'click', selector: "getByRole('button'" }
    ]));

    expect(items).toEqual([]);
  });
});
