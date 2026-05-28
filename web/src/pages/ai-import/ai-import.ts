import {
  matchTypeLabels,
  stepTypeLabels,
  targetTypeLabels,
  type AiDraftStep,
  type AiLevel,
  type ImportItem,
  type ImportItemStatus,
  type ImportJob,
  type ImportStatus,
  type ImportStepSource,
  type MatchType,
  type PageMap,
  type PageState,
  type PageMapStatus,
  type StepType,
  type TargetType
} from '../../../../shared/types';
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
export function formatDraftStepType(type?: StepType | string | null) {
  return formatTypeText(type, stepTypeLabels);
}

/**
 * 格式化同组生成状态，便于预览页按页面地图理解批量生成进度。
 */
export function formatGroupState(item: ImportItem, items: ImportItem[]) {
  const groupItems = item.groupId ? items.filter((value) => value.groupId === item.groupId) : [item];
  const doneCount = groupItems.filter((value) => value.status === 'pendingReview' || value.status === 'saved').length;
  const failedCount = groupItems.filter((value) => value.status === 'failed').length;
  const type = failedCount > 0 ? 'warning' : doneCount === groupItems.length ? 'success' : 'primary';
  const label = `${formatGenMode(item.genMode)} ${doneCount}/${groupItems.length}`;

  return {
    url: item.source.caseInfo.targetUrl,
    mapId: item.pageMapId ?? item.groupId ?? '-',
    label,
    type
  };
}

/**
 * 读取降级提示文案。
 */
export function getFallbackText(item: ImportItem) {
  if (!item.fallbackReason) {
    return '-';
  }

  if (item.genMode === 'single') {
    return `已降级为单条生成：${item.fallbackReason}`;
  }

  return `已拆小批次生成：${item.fallbackReason}`;
}

/**
 * 格式化导入步骤目标类型，避免在预览页暴露内部枚举值。
 */
export function formatTargetType(type?: TargetType | string | null) {
  return formatTypeText(type, targetTypeLabels);
}

/**
 * 格式化检查匹配方式，面向测试人员展示中文含义。
 */
export function formatMatchType(type?: MatchType | string | null) {
  return formatTypeText(type, matchTypeLabels);
}

/**
 * 生成源步骤摘要，优先使用新版两表结构化字段。
 */
export function getStepSummary(step: ImportStepSource) {
  if (step.actionType || step.targetType || step.targetName || step.inputValue || step.matchType) {
    const parts = [formatDraftStepType(step.actionType), formatTargetType(step.targetType), step.targetName].filter(isSummaryPart);
    const valueText = step.inputValue ? `：${step.inputValue}` : '';
    const matchText = step.matchType ? `，匹配方式：${formatMatchType(step.matchType)}` : '';

    return `${parts.join(' ')}${valueText}${matchText}`;
  }

  // 旧三表导入项没有结构化字段，继续展示旧模板的自然语言描述。
  return [step.actionText, step.targetText].filter(Boolean).join('，') || '-';
}

/**
 * 格式化导入更新时间。
 */
export function formatImportTime(value?: string) {
  return formatDateTime(value);
}

/**
 * 格式化页面地图状态。
 */
export function formatPageMapStatus(status?: PageMapStatus) {
  const map: Record<PageMapStatus, { label: string; type: 'success' | 'warning' | 'danger' }> = {
    ready: { label: '可用', type: 'success' },
    stale: { label: '建议刷新', type: 'warning' },
    failed: { label: '采集失败', type: 'danger' }
  };

  return status ? map[status] : { label: '未缓存', type: 'warning' as const };
}

/**
 * 格式化页面地图缓存年龄。
 */
export function formatPageMapAge(value?: string, now = new Date()) {
  if (!value) {
    return '-';
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return '-';
  }

  const diffMs = Math.max(now.getTime() - time, 0);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) {
    // 页面地图是缓存资源，分钟级年龄足够判断是否刚刷新。
    return `${Math.max(Math.floor(diffMs / minuteMs), 1)} 分钟前`;
  }

  if (diffMs < dayMs) {
    return `${Math.floor(diffMs / hourMs)} 小时前`;
  }

  return `${Math.floor(diffMs / dayMs)} 天前`;
}

/**
 * 格式化页面地图状态数量。
 */
export function formatPageMapCount(count?: number) {
  return `${count ?? 0} 个状态`;
}

/**
 * 格式化页面地图状态，统一用于预览详情和地图详情展示。
 */
export function formatPageMapState(state: PageState) {
  return {
    name: state.name || '未命名状态',
    action: formatMapAction(state.sourceAction),
    warning: getMapWarnings(state.warnings).join('；') || '-'
  };
}

/**
 * 读取页面地图 warning，避免页面直接渲染空值。
 */
export function getMapWarnings(warnings?: string[]) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings
    .filter((warning): warning is string => typeof warning === 'string')
    .map((warning) => warning.trim())
    .filter(Boolean);
}

/**
 * 读取页面地图状态数组，兼容历史缓存和接口漂移的缺失字段。
 */
export function getMapStates(map?: Pick<PageMap, 'states'> | null) {
  if (!Array.isArray(map?.states)) {
    return [];
  }

  return map.states;
}

/**
 * 判断页面地图是否有调试信息可展示。
 */
export function hasPageMapDebug(map?: PageMap | null) {
  return Boolean(
    map && (getMapWarnings(map.warnings).length > 0 || getMapStates(map).some((state) => getMapWarnings(state.warnings).length > 0))
  );
}

/**
 * 判断草稿步骤是否为检查步骤。
 */
function isCheckStep(step: AiDraftStep) {
  return step.type.startsWith('assert');
}

/**
 * 格式化分组生成模式。
 */
function formatGenMode(mode: ImportItem['genMode']) {
  const map: Record<NonNullable<ImportItem['genMode']>, string> = {
    group: '分组生成',
    batch: '小批生成',
    single: '单条生成'
  };

  return mode ? map[mode] : '等待生成';
}

/**
 * 格式化运行时枚举文本，兼容后端新增但前端尚未映射的值。
 */
function formatTypeText<T extends string>(type: T | string | null | undefined, map: Record<T, string>) {
  if (!type) {
    return '-';
  }

  // 运行时可能收到新枚举，直接展示原值，避免 Vue 渲染成空白。
  return map[type as T] ?? type;
}

/**
 * 判断摘要片段是否应参与拼接。
 */
function isSummaryPart(value?: string) {
  // 新版结构化字段缺失时格式化函数会返回占位符，摘要中需要跳过占位符。
  return Boolean(value && value !== '-');
}

/**
 * 格式化页面地图状态的来源动作。
 */
function formatMapAction(action?: PageState['sourceAction']) {
  if (!action) {
    return '直接打开目标页面';
  }

  const parts = [formatDraftStepType(action.type), formatTargetType(action.targetType), action.targetName].filter(isSummaryPart);

  return parts.join(' ') || '探索动作';
}
