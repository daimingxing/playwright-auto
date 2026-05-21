import type { CaseStep, StepType } from '../../../shared/types';

export const stepTypes: StepType[] = [
  'goto',
  'click',
  'rightClick',
  'doubleClick',
  'hover',
  'fill',
  'select',
  'wait',
  'assertText',
  'assertVisible',
  'assertValue',
  'assertUrl',
  'assertTitle'
];

export const stepLabels: Record<StepType, string> = {
  goto: '打开页面',
  click: '点击',
  rightClick: '右键点击',
  doubleClick: '双击',
  hover: '悬停',
  fill: '输入',
  select: '下拉选择',
  wait: '等待',
  assertText: '文本断言',
  assertVisible: '可见断言',
  assertValue: '值断言',
  assertUrl: 'URL 断言',
  assertTitle: '标题断言'
};

export const stepGroups: Array<{ label: string; types: StepType[] }> = [
  { label: '页面', types: ['goto'] },
  { label: '动作', types: ['click', 'rightClick', 'doubleClick', 'hover', 'fill', 'select', 'wait'] },
  { label: '断言', types: ['assertText', 'assertVisible', 'assertValue', 'assertUrl', 'assertTitle'] }
];

/**
 * 创建一条新的步骤数据。
 */
export function createStep(type: StepType): CaseStep {
  return {
    id: crypto.randomUUID(),
    type,
    selector: hasSelector(type) ? '' : undefined,
    value: hasValue(type) ? '' : undefined,
    timeout: type === 'wait' ? 1000 : undefined
  };
}

/**
 * 生成步骤类型的展示文案。
 */
export function formatStepType(type: StepType) {
  return {
    label: stepLabels[type],
    code: type
  };
}

/**
 * 获取插入步骤时应使用的位置。
 */
export function getInsertIndex(steps: CaseStep[], selectedId?: string) {
  const index = steps.findIndex((row) => row.id === selectedId);

  if (index < 0) {
    return steps.length;
  }

  return index + 1;
}

/**
 * 判断当前步骤是否需要选择器。
 */
export function hasSelector(type: StepType) {
  return !['goto', 'assertUrl', 'assertTitle', 'wait'].includes(type);
}

/**
 * 判断当前步骤是否需要值输入。
 */
export function hasValue(type: StepType) {
  return ['goto', 'fill', 'select', 'assertText', 'assertValue', 'assertUrl', 'assertTitle'].includes(type);
}

/**
 * 判断当前步骤是否需要等待时间。
 */
export function hasTimeout(type: StepType) {
  return ['goto', 'click', 'rightClick', 'doubleClick', 'hover', 'fill', 'select', 'wait'].includes(type);
}

/**
 * 在指定位置插入步骤。
 */
export function insertStep(steps: CaseStep[], index: number, type: StepType) {
  const row = createStep(type);
  steps.splice(index, 0, row);
  return row;
}

/**
 * 上移或下移指定步骤。
 */
export function moveStep(steps: CaseStep[], index: number, offset: -1 | 1) {
  const next = index + offset;

  if (next < 0 || next >= steps.length) {
    return undefined;
  }

  const [row] = steps.splice(index, 1);
  steps.splice(next, 0, row);
  return row;
}

/**
 * 复制指定步骤。
 */
export function copyStep(steps: CaseStep[], index: number) {
  const row = steps[index];

  if (!row) {
    return undefined;
  }

  const next = {
    ...row,
    id: crypto.randomUUID()
  };

  steps.splice(index + 1, 0, next);
  return next;
}

/**
 * 删除指定步骤。
 */
export function removeStep(steps: CaseStep[], index: number) {
  steps.splice(index, 1);
}
