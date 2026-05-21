import { describe, expect, it } from 'vitest';
import type { CaseStep } from '../../shared/types';
import {
  copyStep,
  createStep,
  formatStepType,
  getInsertIndex,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  removeStep,
  stepGroups,
  stepLabels,
  stepTypes
} from '../../web/src/pages/case-editor';

/**
 * 创建一条测试用步骤。
 */
function makeStep(id: string, type: CaseStep['type'] = 'click'): CaseStep {
  return {
    id,
    type,
    selector: '#target',
    value: 'value',
    timeout: 1000
  };
}

describe('用例编辑器步骤工具', () => {
  it('步骤类型已经包含 goto 和 select', () => {
    expect(stepTypes).toContain('goto');
    expect(stepTypes).toContain('select');
    expect(stepLabels.goto).toBe('打开页面');
    expect(stepLabels.select).toBe('下拉选择');
    expect(stepGroups.map((group) => group.label)).toEqual(['页面', '动作', '断言']);
  });

  it('会把步骤类型展示为中文主文案和代码副标识', () => {
    expect(formatStepType('goto')).toEqual({ label: '打开页面', code: 'goto' });
    expect(formatStepType('click')).toEqual({ label: '点击', code: 'click' });
  });

  it('会根据步骤类型决定哪些字段可见', () => {
    expect(hasSelector('goto')).toBe(false);
    expect(hasValue('goto')).toBe(true);
    expect(hasTimeout('goto')).toBe(true);

    expect(hasSelector('select')).toBe(true);
    expect(hasValue('select')).toBe(true);
    expect(hasTimeout('select')).toBe(true);

    expect(hasSelector('wait')).toBe(false);
    expect(hasValue('wait')).toBe(false);
    expect(hasTimeout('wait')).toBe(true);
  });

  it('会为不同步骤生成合适的默认字段', () => {
    const goto = createStep('goto');
    const click = createStep('click');
    const wait = createStep('wait');

    expect(goto.type).toBe('goto');
    expect(goto.selector).toBeUndefined();
    expect(goto.value).toBe('');
    expect(goto.timeout).toBe(20000);

    expect(click.type).toBe('click');
    expect(click.selector).toBe('');
    expect(click.timeout).toBe(2000);

    expect(wait.type).toBe('wait');
    expect(wait.selector).toBeUndefined();
    expect(wait.value).toBeUndefined();
    expect(wait.timeout).toBe(1000);
  });

  it('创建步骤时支持传入自定义默认等待时间', () => {
    const timeouts = {
      navigation: 30000,
      action: 3000,
      wait: 1500
    };

    expect(createStep('goto', timeouts).timeout).toBe(30000);
    expect(createStep('fill', timeouts).timeout).toBe(3000);
    expect(createStep('wait', timeouts).timeout).toBe(1500);
    expect(createStep('assertVisible', timeouts).timeout).toBeUndefined();
  });

  it('可以在指定位置插入步骤', () => {
    const steps = [makeStep('a'), makeStep('b')];

    insertStep(steps, 1, 'select');

    expect(steps.map((row) => row.type)).toEqual(['click', 'select', 'click']);
  });

  it('会根据选中步骤计算新增位置，未选中时追加到末尾', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];

    expect(getInsertIndex(steps, 'b')).toBe(2);
    expect(getInsertIndex(steps, '')).toBe(3);
    expect(getInsertIndex(steps, 'missing')).toBe(3);
  });

  it('可以上下移动、复制和删除步骤', () => {
    const steps = [makeStep('a'), makeStep('b', 'fill'), makeStep('c', 'wait')];

    moveStep(steps, 1, -1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'a', 'c']);

    moveStep(steps, 1, 1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a']);

    copyStep(steps, 1);
    expect(steps).toHaveLength(4);
    expect(steps[2].id).not.toBe(steps[1].id);
    expect(steps[2].type).toBe('wait');

    removeStep(steps, 2);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });
});
