import type {
  ImportCaseFailure,
  ImportCaseStatus,
  ImportParseError,
  ImportSourceRow,
  ImportTask,
  ImportTaskCase
} from '../../../../shared/types';
import { summarizeImportFailure } from '../../../../shared/import-failure';

const caseStatusMap: Record<ImportCaseStatus, { label: string; type: 'success' | 'danger' | 'warning' | 'info' }> = {
  parsed: { label: '已解析', type: 'success' },
  'parse-failed': { label: '解析失败', type: 'danger' },
  exploring: { label: '探索中', type: 'warning' },
  generating: { label: '生成中', type: 'warning' },
  'pending-review': { label: '待确认', type: 'warning' },
  publishable: { label: '可发布', type: 'success' },
  published: { label: '已发布', type: 'success' },
  failed: { label: '失败', type: 'danger' }
};

/**
 * 格式化导入用例阶段文案。
 */
export function formatImportCaseStatus(status: ImportCaseStatus) {
  return caseStatusMap[status];
}

/**
 * 把解析错误格式化为带工作表、行号和步骤摘要的展示文案。
 */
export function formatParseError(error: ImportParseError) {
  const sheet = error.sheet ? `「${error.sheet}」` : '';
  const row = error.row > 0 ? `第 ${error.row} 行` : '';
  const location = `${sheet}${row}`;
  const subject = formatParseErrorSubject(error.cells);
  const prefix = [location, subject ? `（${subject}）` : ''].join('');

  return prefix ? `${prefix}：${error.reason}` : error.reason;
}

/**
 * 从原始单元格拼出步骤序号和动作对象，避免把 Excel 行号当成步骤序号。
 */
function formatParseErrorSubject(cells: ImportParseError['cells']) {
  if (!cells) {
    return '';
  }

  const order = cells['步骤序号']?.trim();
  const action = cells['动作类型']?.trim();
  const target = cells['目标']?.trim();
  const parts = [
    order ? `步骤序号 ${order}` : '',
    action ? (target ? `${action}「${target}」` : action) : ''
  ];

  return parts.filter(Boolean).join('，');
}

/**
 * 格式化任务级解析摘要。
 */
export function formatImportSummary(task: Pick<ImportTask, 'parsedCount' | 'failedCount'>) {
  return `已解析 ${task.parsedCount} 条，解析失败 ${task.failedCount} 条`;
}

/**
 * 生成删除导入任务的确认文案。已发布正式用例不受影响。
 */
export function getDeleteImportTaskConfirm(fileName: string) {
  return `确认删除导入任务「${fileName}」吗？这次导入记录无法恢复，已发布的正式用例不受影响。`;
}

/**
 * 从来源引用生成工作表、行号和用例编号文案。
 */
export function formatSourceRef(source: ImportSourceRow) {
  return `「${source.sheet}」第 ${source.row} 行 · ${source.caseNumber}`;
}

/**
 * 把原始单元格格式化为可审阅的字段列表。
 */
export function formatSourceCells(source: ImportSourceRow) {
  return Object.entries(source.cells)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('；');
}

/**
 * 判断用例是否可以确认。
 */
export function canConfirmImportCase(status: ImportCaseStatus) {
  return status === 'pending-review';
}

/**
 * 判断用例是否可以单条重试。已确认、已发布和解析失败的条目不能重试。
 */
export function canRetryImportCase(status: ImportCaseStatus) {
  return (
    status !== 'publishable' &&
    status !== 'published' &&
    status !== 'parse-failed' &&
    status !== 'parsed' &&
    !isExploreRunning(status)
  );
}

/**
 * 判断用例是否可以显式发布为正式用例。
 */
export function canPublishImportCase(status: ImportCaseStatus) {
  return status === 'publishable';
}

/**
 * 判断任务是否还有已解析、待生成意图的用例。
 */
export function hasParsedCases(cases: ImportTaskCase[]) {
  return cases.some((item) => item.status === 'parsed');
}

/**
 * 判断用例是否正在页面探索或生成意图。
 */
export function isExploreRunning(status: ImportCaseStatus) {
  return status === 'exploring' || status === 'generating';
}

/**
 * 判断用例是否仍在等待或执行页面探索。
 */
export function isImportCaseBusy(status: ImportCaseStatus) {
  return status === 'parsed' || isExploreRunning(status);
}

/**
 * 判断任务是否仍需启动或等待页面探索。
 */
export function needsImportReview(cases: Array<Pick<ImportTaskCase, 'status'>>) {
  return cases.some((item) => isImportCaseBusy(item.status));
}

/**
 * 把探索等待时间格式化为页面可见说明。
 */
export function formatExploreWait(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const clock = minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
  return `正在后台探索页面，已等待 ${clock}。离开本页不影响，完成后可回来查看结果。`;
}

/**
 * 把失败说明收成页面可见的短摘要，不展示过程日志。
 */
export function formatImportFailure(failure: ImportCaseFailure) {
  return summarizeImportFailure(failure.kind, failure.message);
}

/**
 * 从接口错误对象中读取 Excel 结构错误列表。
 */
export function getImportErrors(error: unknown): ImportParseError[] {
  if (typeof error !== 'object' || error === null || !('errors' in error)) {
    return [];
  }

  const errors = (error as { errors?: unknown }).errors;

  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.filter(isParseError);
}

/**
 * 判断未知值是否为可展示的解析错误。
 */
function isParseError(value: unknown): value is ImportParseError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return 'sheet' in value && 'row' in value && 'reason' in value && typeof (value as ImportParseError).reason === 'string';
}
