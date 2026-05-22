/**
 * 判断输入是否为完整 HTTP 地址。
 */
export function isFullUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * 拼接项目环境地址和用例起始路径。
 */
export function buildStartUrl(baseUrl: string, startPath: string) {
  if (isFullUrl(startPath)) {
    return startPath;
  }

  const base = baseUrl.replace(/\/+$/, '');
  const path = startPath.replace(/^\/+/, '');

  if (!path) {
    return base;
  }

  return `${base}/${path}`;
}
