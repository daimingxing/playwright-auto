import type { AiDraftStep, AiLevel, ImportItem, ImportItemStatus, ImportJob, ImportStatus, StepType } from '../../../../shared/types';
import { formatDateTime } from '../../utils/time';

export type ImportFilter = 'all' | ImportItemStatus | 'lowConfidence' | 'warning';

/**
 * 计算导入任务生成进度。
 */
export function getImportProgress(job: ImportJob) {
  if (job.totalCount === 0) {
    return 0;
  }

  return Math.round((job.generatedCount / job.totalCount) * 100);
}

/**
 * 计算已生成但还需要用户确认的数量。
 */
export function getPendingCount(job: ImportJob) {
  return Math.max(job.generatedCount - job.savedCount, 0);
}

/**
 * 判断导入项是否可以保存为草稿。
 */
export function canSaveImportItem(item: ImportItem) {
  return item.status === 'pendingReview';
}

/**
 * 判断导入项是否可以重试生成。
 */
export function canRetryImportItem(item: ImportItem) {
  return item.status === 'failed' || (item.status === 'saved' && item.savedCaseState === 'missing');
}

/**
 * 判断保存后的草稿是否可以打开。
 */
export function canOpenSavedCase(item: ImportItem) {
  return Boolean(item.savedCaseKey && item.savedCaseState !== 'missing');
}

/**
 * 判断导入项是否可以跳过。
 */
export function canSkipImportItem(item: ImportItem) {
  return item.status === 'pendingReview' || item.status === 'failed';
}

/**
 * 格式化导入任务状态。
 */
export function formatImportStatus(status: ImportStatus) {
  const map: Record<ImportStatus, string> = {
    running: '生成中',
    pendingReview: '待确认',
    partialSaved: '部分保存',
    completed: '已完成',
    failed: '失败'
  };

  return map[status];
}

/**
 * 格式化导入项状态。
 */
export function formatImportItemStatus(status: ImportItemStatus) {
  const map: Record<ImportItemStatus, { label: string; type: 'info' | 'primary' | 'success' | 'warning' | 'danger' }> = {
    pending: { label: '等待生成', type: 'info' },
    generating: { label: '生成中', type: 'primary' },
    pendingReview: { label: '待确认', type: 'warning' },
    failed: { label: '生成失败', type: 'danger' },
    saved: { label: '已保存', type: 'success' },
    skipped: { label: '已跳过', type: 'info' }
  };

  return map[status];
}

/**
 * 格式化置信度。
 */
export function formatAiLevel(level?: AiLevel) {
  const map: Record<AiLevel, { label: string; type: 'success' | 'warning' | 'danger' }> = {
    high: { label: '高', type: 'success' },
    medium: { label: '中', type: 'warning' },
    low: { label: '低', type: 'danger' }
  };

  return level ? map[level] : { label: '-', type: 'warning' as const };
}

/**
 * 按导入项筛选条件过滤列表。
 */
export function filterImportItems(items: ImportItem[], filter: ImportFilter) {
  if (filter === 'all') {
    return items;
  }

  if (filter === 'lowConfidence') {
    return items.filter((item) => item.draft?.confidence === 'low' || item.draft?.steps.some((step) => step.confidence === 'low'));
  }

  if (filter === 'warning') {
    return items.filter((item) => item.draft?.warnings.length || item.draft?.missingInfo.length || item.draft?.steps.some((step) => step.warnings.length));
  }

  return items.filter((item) => item.status === filter);
}

/**
 * 读取导入项最适合展示的问题提示。
 */
export function getItemIssueText(item: ImportItem) {
  if (item.errorMessage) {
    return item.errorMessage;
  }

  if (item.draft?.warnings[0]) {
    return item.draft.warnings[0];
  }

  if (item.draft?.missingInfo[0]) {
    return item.draft.missingInfo[0];
  }

  const stepWarning = item.draft?.steps.find((step) => step.warnings.length > 0)?.warnings[0];

  return stepWarning ?? '-';
}

/**
 * 统计草稿检查步骤数量。
 */
export function getCheckCount(item: ImportItem) {
  return item.draft?.steps.filter((step) => step.type.startsWith('assert')).length ?? 0;
}

/**
 * 生成草稿检查步骤摘要。
 */
export function getCheckSummary(item: ImportItem) {
  const checks = item.draft?.steps.filter((step) => step.type.startsWith('assert')) ?? [];

  if (checks.length === 0) {
    return '-';
  }

  return checks.map((step) => step.text).join('；');
}

/**
 * 获取草稿操作步骤。
 */
export function getActionSteps(item: ImportItem) {
  return item.draft?.steps.filter((step) => !isCheckStep(step)) ?? [];
}

/**
 * 获取草稿检查步骤。
 */
export function getCheckSteps(item: ImportItem) {
  return item.draft?.steps.filter(isCheckStep) ?? [];
}

/**
 * 格式化草稿步骤类型，面向测试人员隐藏内部实现术语。
 */
export function formatDraftStepType(type: StepType) {
  const map: Record<StepType, string> = {
    goto: '打开页面',
    click: '点击',
    rightClick: '右键点击',
    doubleClick: '双击',
    hover: '悬停',
    fill: '输入',
    select: '下拉选择',
    wait: '等待',
    assertText: '检查文本',
    assertVisible: '检查显示',
    assertValue: '检查输入值',
    assertUrl: '检查页面地址',
    assertTitle: '检查页面标题'
  };

  return map[type];
}

/**
 * 格式化导入更新时间。
 */
export function formatImportTime(value?: string) {
  return formatDateTime(value);
}

/**
 * 判断草稿步骤是否为检查步骤。
 */
function isCheckStep(step: AiDraftStep) {
  return step.type.startsWith('assert');
}
