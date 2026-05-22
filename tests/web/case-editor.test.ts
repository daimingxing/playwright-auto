import { describe, expect, it } from 'vitest';
import type { CaseStep } from '../../shared/types';
import {
  canMoveSteps,
  copyStep,
  copySteps,
  createStep,
  formatStepType,
  getInsertIndex,
  getStartPreview,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  moveSteps,
  removeStep,
  removeSteps,
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

  it('根据项目环境和起始路径计算实际打开地址', () => {
    const preview = getStartPreview(
      {
        name: '下拉框选择',
        key: 'case-1',
        startPath: '/web/NGBS03',
        steps: [],
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      {
        name: '默认环境',
        key: 'default',
        baseUrl: 'http://xcmpmstest.baowuresources.info/xcmpms-imms-f'
      }
    );

    expect(preview).toBe('http://xcmpmstest.baowuresources.info/xcmpms-imms-f/web/NGBS03');
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

  it('可以批量删除选中的步骤并保留未选中顺序', () => {
    const steps = [makeStep('a'), makeStep('b', 'fill'), makeStep('c', 'wait'), makeStep('d')];

    const removed = removeSteps(steps, ['b', 'd']);

    expect(removed.map((row) => row.id)).toEqual(['b', 'd']);
    expect(steps.map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('可以批量复制选中的步骤到选中块后方', () => {
    const steps = [makeStep('a'), makeStep('b', 'fill'), makeStep('c', 'wait'), makeStep('d')];

    const copied = copySteps(steps, ['b', 'd']);

    expect(copied).toHaveLength(2);
    expect(copied.map((row) => row.type)).toEqual(['fill', 'click']);
    expect(copied[0].id).not.toBe('b');
    expect(copied[1].id).not.toBe('d');
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', copied[0].id, copied[1].id]);
  });

  it('可以批量上移和下移选中的步骤并保持内部顺序', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c'), makeStep('d')];

    expect(canMoveSteps(steps, ['b', 'c'], -1)).toBe(true);
    const movedUp = moveSteps(steps, ['b', 'c'], -1);

    expect(movedUp.map((row) => row.id)).toEqual(['b', 'c']);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a', 'd']);

    expect(canMoveSteps(steps, ['b', 'c'], 1)).toBe(true);
    const movedDown = moveSteps(steps, ['b', 'c'], 1);

    expect(movedDown.map((row) => row.id)).toEqual(['b', 'c']);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('批量移动非连续选择时会让每个选中块各移动一格', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c'), makeStep('d'), makeStep('e')];

    moveSteps(steps, ['b', 'd'], -1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'a', 'd', 'c', 'e']);

    moveSteps(steps, ['b', 'd'], 1);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('批量移动会处理空选择和首尾边界', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];

    expect(canMoveSteps(steps, [], -1)).toBe(false);
    expect(canMoveSteps(steps, ['a'], -1)).toBe(false);
    expect(canMoveSteps(steps, ['c'], 1)).toBe(false);
    expect(moveSteps(steps, [], 1)).toEqual([]);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});
