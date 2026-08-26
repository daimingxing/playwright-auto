import type { ImportCaseStatus, ImportParseError, ImportTask } from '../../../../shared/types';

const caseStatusMap: Record<ImportCaseStatus, { label: string; type: 'success' | 'danger' }> = {
  parsed: { label: '已解析', type: 'success' },
  'parse-failed': { label: '解析失败', type: 'danger' }
};

/**
 * 格式化导入用例的初始状态文案，仅包含已解析 / 解析失败。
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
