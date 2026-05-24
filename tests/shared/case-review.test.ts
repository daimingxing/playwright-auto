import { describe, expect, it } from 'vitest';
import type { CaseStep } from '../../shared/types';
import { reviewCaseStep } from '../../shared/case-review';

describe('共享基础检查规则', () => {
  it('会把需要选择器但为空的步骤标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: '' }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        stepId: 's1',
        level: 'error',
        ruleCode: 'missing-selector',
        message: '步骤缺少元素选择器。'
      })
    ]);
  });

  it('会把明显不合法的选择器标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('button'" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        stepId: 's1',
        level: 'error',
        ruleCode: 'invalid-selector',
        group: 'locator'
      })
    ]);
  });

  it('会接受常见 Playwright 定位表达式', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('button', { name: '保存' })" }), 0);

    expect(result).toEqual([]);
  });

  it('会把裸词 CSS 选择器标记为弱选择器', () => {
    const result = reviewCaseStep(makeStep({ selector: 'asdasdad' }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'warning',
        ruleCode: 'weak-css-selector'
      })
    ]);
  });

  it('会把缺少名称的 role 定位标记为警告', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('button', { })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'warning',
        ruleCode: 'weak-role-selector'
      })
    ]);
  });

  it('会把空定位器链标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: 'locator().filter().nth()' }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-argument'
      })
    ]);
  });

  it('会把空 name 配置标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('button', { name:})" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-option'
      })
    ]);
  });

  it('会把空 hasText 配置标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ hasText:  }).nth(3)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-option'
      })
    ]);
  });

  it('会把尾逗号 role 定位标记为弱选择器', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('button',)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'warning',
        ruleCode: 'weak-role-selector'
      })
    ]);
  });

  it('会把依赖外部变量的定位配置标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('textbox', { name })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'external-locator-variable'
      })
    ]);
  });

  it('会把空字符串定位配置标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('textbox', { name: ' ' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-option'
      })
    ]);
  });

  it('会把 getByRole 中的 hasText 参数标记为可疑参数', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('textbox', { hasText: '' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'warning',
        ruleCode: 'suspicious-role-option'
      })
    ]);
  });

  it('会把空文本过滤加 nth 的定位链标记为高危', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ hasText: ' ' }).nth(2)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'danger',
        ruleCode: 'weak-nth-selector'
      })
    ]);
  });
});

/**
 * 创建基础检查测试步骤。
 */
function makeStep(input: Partial<CaseStep>): CaseStep {
  return {
    id: 's1',
    type: 'click',
    timeout: 1000,
    ...input
  };
}
