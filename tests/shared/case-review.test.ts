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

  it('会接受常见链式定位表达式', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('.panel').getByText('保存').first()" }), 0);

    expect(result).toEqual([]);
  });

  it('会把未知 getBy 定位方法标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getBysasaText('asdad')" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'unknown-locator-method'
      })
    ]);
  });

  it('会把未知链式定位方法标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').findByText('保存')" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'unknown-locator-method'
      })
    ]);
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

  it('会把空字符串首参标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByText('')" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-argument'
      })
    ]);
  });

  it('会把非布尔 exact 标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByText('保存', { exact: 'yes' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-locator-option'
      })
    ]);
  });

  it('会把非法 nth 参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('button').nth(-1)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-locator-argument'
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

  it('会把 getByRole 中的 hasText 参数标记为未知参数', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('textbox', { hasText: '' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'unknown-role-option'
      })
    ]);
  });

  it('会把 getByRole 中的未知参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('textbox', { id: 'userName' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'unknown-role-option'
      })
    ]);
  });

  it('会把 getByRole 中的其他外部变量参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByRole('checkbox', { checked })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'external-locator-variable'
      })
    ]);
  });

  it('会把 filter 中的未知参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ id: 'panel' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'unknown-filter-option'
      })
    ]);
  });

  it('会把 filter options 对象前的多余字符标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter(asdada{ hasText: /^令牌分组，默认为用户的分组$/ }).nth(3)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-selector'
      })
    ]);
  });

  it('会把 filter options 中无法解析的字段标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ z hasText: /^令牌分组，默认为用户的分组$/ }).nth(3)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-selector'
      })
    ]);
  });

  it('会把 filter 中的外部变量参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ hasText })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'external-locator-variable'
      })
    ]);
  });

  it('会接受合法 filter 参数', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('article').filter({ hasText: '订单', visible: true })" }), 0);

    expect(result).toEqual([]);
  });

  it('会接受合法正则和 has 子定位器', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('tr').filter({ hasText: /订单\\d+/i, has: getByRole('button', { name: /编辑|修改/ }) })" }), 0);

    expect(result).toEqual([]);
  });

  it('会把非法正则标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "getByText(/订单[/)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-locator-regex'
      })
    ]);
  });

  it('会把非法 visible 参数标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('button').filter({ visible: 'yes' })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'invalid-locator-option'
      })
    ]);
  });

  it('会把复杂 has 子定位器标记为错误', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('tr').filter({ has: getByRole('button', { name: '编辑' }).filter({ hasText: '更多' }) })" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'complex-filter-locator'
      })
    ]);
  });

  it('会把空文本过滤加 nth 的定位链标记为高危', () => {
    const result = reviewCaseStep(makeStep({ selector: "locator('div').filter({ hasText: ' ' }).nth(2)" }), 0);

    expect(result).toEqual([
      expect.objectContaining({
        level: 'error',
        ruleCode: 'empty-locator-option'
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
