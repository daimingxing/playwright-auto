import type { CaseMeta, CaseReviewItem, CaseStatus, CaseStep, CheckStatus, EnvMeta, PracticalReviewSummary, StepTimeoutConfig, StepType } from '../../../shared/types';
import { buildStartUrl } from '../../../shared/url';

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

export const stepTimeouts: StepTimeoutConfig = {
  navigation: 20000,
  action: 2000,
  wait: 1000
};

const caseStatusMap: Record<CaseStatus, { label: string; type: 'info' | 'warning' | 'success' }> = {
  draft: { label: '草稿', type: 'info' },
  ready: { label: '待启用', type: 'warning' },
  active: { label: '启用', type: 'success' }
};

const checkStatusMap: Record<CheckStatus, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  unchecked: { label: '未审查', type: 'info' },
  'review-failed': { label: '审查不通过', type: 'danger' },
  'pending-practical': { label: '待实测', type: 'warning' },
  'practical-failed': { label: '实测失败', type: 'danger' },
  'practical-passed': { label: '实测通过', type: 'success' }
};

export type StepReviewPreview = CaseReviewItem[] | 'pending';

export interface StepReviewState {
  status: 'pending' | 'passed' | 'failed';
  reviews: CaseReviewItem[];
}

/**
 * 计算当前用例的实际打开地址。
 */
export function getStartPreview(item: CaseMeta | null, env: EnvMeta | null) {
  if (!item || !env) {
    return '';
  }

  return buildStartUrl(env.baseUrl, item.startPath);
}

/**
 * 创建一条新的步骤数据。
 */
export function createStep(type: StepType, timeouts: StepTimeoutConfig = stepTimeouts): CaseStep {
  const timeout = readTimeout(type, timeouts);

  return {
    id: crypto.randomUUID(),
    type,
    selector: hasSelector(type) ? '' : undefined,
    value: hasValue(type) ? '' : undefined,
    timeout
  };
}

/**
 * 读取步骤默认等待时间。
 */
export function readTimeout(type: StepType, timeouts: StepTimeoutConfig) {
  if (type === 'goto') {
    return timeouts.navigation;
  }

  if (type === 'wait') {
    return timeouts.wait;
  }

  if (hasTimeout(type)) {
    return timeouts.action;
  }

  return undefined;
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
 * 显示用例状态。
 */
export function formatCaseStatus(status: CaseStatus | undefined) {
  return status ? caseStatusMap[status] : caseStatusMap.draft;
}

/**
 * 显示合成检查状态。
 */
export function formatCheckStatus(item: CaseMeta) {
  return checkStatusMap[getCaseCheckStatus(item)];
}

/**
 * 读取用例合成检查状态。
 */
export function getCaseCheckStatus(item: CaseMeta): CheckStatus {
  if (!item.review) {
    return 'unchecked';
  }

  if (item.review.summary.error > 0 || item.review.summary.danger > 0) {
    return 'review-failed';
  }

  if (item.practicalReview?.status === 'passed') {
    return 'practical-passed';
  }

  if (item.practicalReview?.status === 'failed') {
    return 'practical-failed';
  }

  return 'pending-practical';
}

/**
 * 显示静态定位检查通过文案。
 */
export function formatLocatorCheckPass() {
  return '定位通过';
}

/**
 * 合并已保存基础检查和编辑中预览检查。
 */
export function mergeStepReviewState(
  stepId: string,
  savedReviews: CaseReviewItem[],
  previewMap: Map<string, StepReviewPreview>
): StepReviewState {
  if (previewMap.get(stepId) === 'pending') {
    return { status: 'pending', reviews: [] };
  }

  const preview = previewMap.get(stepId);

  if (Array.isArray(preview)) {
    return {
      status: preview.length > 0 ? 'failed' : 'passed',
      reviews: preview
    };
  }

  return {
    status: savedReviews.length > 0 ? 'failed' : 'passed',
    reviews: savedReviews
  };
}

/**
 * 显示步骤基础检查状态。
 */
export function formatStepReviewState(state: StepReviewState) {
  if (state.status === 'pending') {
    return { label: '待检查', type: 'info' as const };
  }

  if (state.status === 'failed') {
    return { label: '审查不通过', type: 'danger' as const };
  }

  return { label: formatLocatorCheckPass(), type: 'success' as const };
}

/**
 * 显示实测检查摘要状态。
 */
export function formatPracticalReviewStatus(summary: PracticalReviewSummary | undefined) {
  if (!summary || summary.status === 'untested') {
    return '未审查';
  }

  const labels: Record<PracticalReviewSummary['status'], string> = {
    untested: '未审查',
    running: '检查中',
    passed: '通过',
    failed: '失败',
    expired: '过期'
  };

  return labels[summary.status];
}

/**
 * 显示实测检查摘要标签类型。
 */
export function getPracticalReviewTagType(summary: PracticalReviewSummary | undefined) {
  if (!summary) {
    return 'info';
  }

  const types: Record<PracticalReviewSummary['status'], 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    untested: 'info',
    running: 'primary',
    passed: 'success',
    failed: 'danger',
    expired: 'warning'
  };

  return types[summary.status];
}

/**
 * 判断当前步骤是否为最近一次实测检查失败步骤。
 */
export function getFailedPracticalStep(summary: PracticalReviewSummary | undefined, step: CaseStep) {
  return summary?.status === 'failed' && summary.failedStepId === step.id;
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
export function insertStep(steps: CaseStep[], index: number, type: StepType, timeouts: StepTimeoutConfig = stepTimeouts) {
  const row = createStep(type, timeouts);
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
 * 判断批量选中的步骤是否可以整体移动。
 */
export function canMoveSteps(steps: CaseStep[], ids: string[], offset: -1 | 1) {
  const indexes = getStepIndexes(steps, ids);

  if (indexes.length === 0) {
    return false;
  }

  if (offset === -1) {
    return indexes[0] > 0;
  }

  return indexes[indexes.length - 1] < steps.length - 1;
}

/**
 * 批量移动选中的步骤。
 */
export function moveSteps(steps: CaseStep[], ids: string[], offset: -1 | 1) {
  if (!canMoveSteps(steps, ids, offset)) {
    return [];
  }

  const selected = new Set(ids);
  const moved = steps.filter((row) => selected.has(row.id));
  const start = offset === -1 ? 0 : steps.length - 1;
  const end = offset === -1 ? steps.length : -1;

  for (let index = start; index !== end; index -= offset) {
    const row = steps[index];
    const next = index + offset;

    // 相邻位置也是选中项时保持选中块内部顺序，不做交换。
    if (!row || selected.has(steps[next]?.id) || !selected.has(row.id)) {
      continue;
    }

    [steps[index], steps[next]] = [steps[next], steps[index]];
  }

  return moved;
}

/**
 * 批量复制选中的步骤到选中块后方。
 */
export function copySteps(steps: CaseStep[], ids: string[]) {
  const indexes = getStepIndexes(steps, ids);

  if (indexes.length === 0) {
    return [];
  }

  const selected = new Set(ids);
  const rows = steps
    .filter((row) => selected.has(row.id))
    .map((row) => ({
      ...row,
      id: crypto.randomUUID()
    }));

  steps.splice(indexes[indexes.length - 1] + 1, 0, ...rows);
  return rows;
}

/**
 * 删除指定步骤。
 */
export function removeStep(steps: CaseStep[], index: number) {
  steps.splice(index, 1);
}

/**
 * 批量删除选中的步骤。
 */
export function removeSteps(steps: CaseStep[], ids: string[]) {
  const selected = new Set(ids);
  const removed = steps.filter((row) => selected.has(row.id));
  const kept = steps.filter((row) => !selected.has(row.id));

  steps.splice(0, steps.length, ...kept);
  return removed;
}

/**
 * 获取步骤在当前列表里的索引。
 */
function getStepIndexes(steps: CaseStep[], ids: string[]) {
  const selected = new Set(ids);

  return steps
    .map((row, index) => (selected.has(row.id) ? index : -1))
    .filter((index) => index >= 0);
}
