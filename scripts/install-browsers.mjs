import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 检查浏览器可执行文件是否存在。
 */
function hasBrowser() {
  const filePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (filePath && existsSync(filePath)) {
    return true;
  }

  const dirPath = process.env.PLAYWRIGHT_CHROMIUM_DIR;
  if (!dirPath) {
    return false;
  }

  return existsSync(join(dirPath, 'chrome.exe')) || existsSync(join(dirPath, 'chrome-win', 'chrome.exe'));
}

if (hasBrowser()) {
  console.log('已检测到本机 Chromium，跳过 Playwright 浏览器下载。');
  process.exit(0);
}

const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: true
});

process.exit(result.status ?? 1);
