import { defineConfig, devices } from '@playwright/test';
import { getBrowserPath } from './server/src/services/playwright/browser-path';
import { getVendorEnv } from './server/src/services/playwright/vendor-browser';

const output = process.env.PLAYWRIGHT_AUTO_OUTPUT ?? 'test-results';
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE || undefined;
const executablePath = getBrowserPath();
const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const testDir = process.env.PLAYWRIGHT_TEST_DIR ?? 'data/projects';
const testMatch = process.env.PLAYWRIGHT_TEST_MATCH ?? '**/cases/**/*.spec.ts';

Object.assign(process.env, getVendorEnv());

export default defineConfig({
  testDir,
  testMatch: [testMatch],
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
