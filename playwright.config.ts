import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const output = process.env.PLAYWRIGHT_AUTO_OUTPUT ?? 'test-results';
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE || undefined;
const executablePath = getBrowserPath();
const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  reporter: [['html', { outputFolder: `${output}/html-report`, open: 'never' }]],
  outputDir: `${output}/test-results`,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless,
        launchOptions: {
          executablePath
        }
      }
    }
  ]
});

/**
 * 解析用户自定义 Chromium 可执行文件路径。
 */
function getBrowserPath() {
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
