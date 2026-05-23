/**
 * 携带 HTTP 状态码的业务错误。
 */
export class HttpError extends Error {
  status: number;

  /**
   * 创建可被全局错误处理中间件识别的错误。
   */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * 创建参数错误。
 */
export function badRequest(message: string) {
  return new HttpError(400, message);
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
