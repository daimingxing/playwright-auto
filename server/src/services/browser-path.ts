import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 解析用户自定义 Chromium 可执行文件路径。
 */
export function getBrowserPath() {
  const filePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (filePath) {
    return filePath;
  }

  const dirPath = process.env.PLAYWRIGHT_CHROMIUM_DIR;
  if (!dirPath) {
    return undefined;
  }

  const directPath = join(dirPath, 'chrome.exe');
  if (existsSync(directPath)) {
    return directPath;
  }

  const nestedPath = join(dirPath, 'chrome-win', 'chrome.exe');
  if (existsSync(nestedPath)) {
    return nestedPath;
  }

  return undefined;
}
