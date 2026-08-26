import type {
  ImportCaseStatus,
  ImportParseError,
  ImportSourceRow,
  ImportTask,
  ImportTaskCase
} from '../../../../shared/types';

const caseStatusMap: Record<ImportCaseStatus, { label: string; type: 'success' | 'danger' | 'warning' | 'info' }> = {
  parsed: { label: '已解析', type: 'success' },
  'parse-failed': { label: '解析失败', type: 'danger' },
  exploring: { label: '探索中', type: 'warning' },
  generating: { label: '生成中', type: 'warning' },
  'pending-review': { label: '待确认', type: 'warning' },
  publishable: { label: '可发布', type: 'success' },
  failed: { label: '失败', type: 'danger' }
};

/**
 * 格式化导入用例阶段文案。
 */
export function formatImportCaseStatus(status: ImportCaseStatus) {
  return caseStatusMap[status];
}

/**
 * 把解析错误格式化为带工作表和行号的展示文案。
 */
export function formatParseError(error: ImportParseError) {
  const sheet = error.sheet ? `「${error.sheet}」` : '';
  const row = error.row > 0 ? `第 ${error.row} 行` : '';
  const location = `${sheet}${row}`;

  return location ? `${location}：${error.reason}` : error.reason;
}

/**
 * 格式化任务级解析摘要。
 */
export function formatImportSummary(task: Pick<ImportTask, 'parsedCount' | 'failedCount'>) {
  return `已解析 ${task.parsedCount} 条，解析失败 ${task.failedCount} 条`;
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
 * 判断用例是否可以单条重试。已确认和解析失败的条目不能重试。
 */
export function canRetryImportCase(status: ImportCaseStatus) {
  return status !== 'publishable' && status !== 'parse-failed' && status !== 'parsed';
}

/**
 * 判断任务是否还有已解析、待生成意图的用例。
 */
export function hasParsedCases(cases: ImportTaskCase[]) {
  return cases.some((item) => item.status === 'parsed');
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
