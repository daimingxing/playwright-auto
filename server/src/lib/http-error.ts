/**
 * 携带 HTTP 状态码的业务错误。
 */
export class HttpError extends Error {
  status: number;
  details?: unknown;

  /**
   * 创建可被全局错误处理中间件识别的错误。
   */
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/**
 * 创建参数错误。
 */
export function badRequest(message: string, details?: unknown) {
  return new HttpError(400, message, details);
}

/**
 * 创建资源不存在错误。
 */
export function notFound(message: string) {
  return new HttpError(404, message);
}

/**
 * 创建数据冲突错误。
 */
export function conflict(message: string) {
  return new HttpError(409, message);
}
