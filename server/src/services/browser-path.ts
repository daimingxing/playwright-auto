import { getChromePath } from './vendor-browser';

/**
 * 获取 vendor 目录内的 Chromium 可执行文件路径。
 */
export function getBrowserPath() {
  return getChromePath();
}
