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
 * 格式化任务详情的逐用例总进度，供用户看到审阅和发布进展。
 */
export function formatImportProgress(cases: Array<{ status: ImportCaseStatus }>) {
  const count = (status: ImportCaseStatus) => cases.filter((item) => item.status === status).length;
  const exploring = count('exploring') + count('generating');

  return [
    exploring ? `探索中 ${exploring}` : '',
    count('pending-review') ? `待确认 ${count('pending-review')}` : '',
    count('publishable') ? `可发布 ${count('publishable')}` : '',
    count('published') ? `已发布 ${count('published')}` : '',
    count('failed') ? `失败 ${count('failed')}` : '',
    count('parse-failed') ? `解析失败 ${count('parse-failed')}` : ''
  ]
    .filter(Boolean)
    .join('，') || `共 ${cases.length} 条`;
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
 * 判断用例是否可以确认。有未解决待确认项时不能确认。
 */
export function canConfirmImportCase(item: Pick<ImportTaskCase, 'status' | 'intent'>) {
  return item.status === 'pending-review' && (item.intent?.pendingItems.length ?? 0) === 0;
}

/**
 * 判断已确认且未发布的用例是否可以取消确认。
 */
export function canUnconfirmImportCase(status: ImportCaseStatus) {
  return status === 'publishable';
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
 * 把发布失败整理成页面可见说明，带上未解决待确认项等具体原因。
 */
export function formatImportPublishError(error: unknown) {
  const issues = getImportPublishIssues(error);
  const message = readErrorMessage(error, '发布失败');

  if (issues.length === 0) {
    return message;
  }

  return `${message}：${issues[0]}`;
}

/**
 * 从未知错误对象读取可展示文案。
 */
function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return fallback;
}

/**
 * 从发布接口错误中读取校验问题说明。
 */
function getImportPublishIssues(error: unknown) {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return [];
  }

  const issues = (error as { issues?: unknown }).issues;

  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .map((item) => (typeof item === 'object' && item && 'message' in item ? String(item.message ?? '') : ''))
    .filter(Boolean);
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
