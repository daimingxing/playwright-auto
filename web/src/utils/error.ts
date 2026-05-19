/**
 * 获取可以直接展示给用户的错误消息。
 */
export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '操作失败，请查看服务状态或稍后重试';
}
