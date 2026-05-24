/**
 * 获取可以直接展示给用户的错误消息。
 */
export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '操作失败，请查看服务状态或稍后重试';
}

interface ErrorIssue {
  stepIndex?: number;
  message?: string;
  suggestion?: string;
}

/**
 * 获取后端返回的基础检查问题列表。
 */
export function getErrorIssues(error: unknown) {
  if (!hasIssues(error)) {
    return [];
  }

  return error.issues.map(formatIssue);
}

/**
 * 判断错误对象是否携带基础检查问题。
 */
function hasIssues(error: unknown): error is { issues: ErrorIssue[] } {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return false;
  }

  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues);
}

/**
 * 格式化单条基础检查问题。
 */
function formatIssue(issue: ErrorIssue) {
  const stepText = typeof issue.stepIndex === 'number' && issue.stepIndex >= 0 ? `第 ${issue.stepIndex + 1} 步：` : '';
  const message = issue.message ?? '基础检查不通过。';
  const suggestion = issue.suggestion ? issue.suggestion : '';

  return `${stepText}${message}${suggestion}`;
}
