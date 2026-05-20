import { defineConfig, devices } from '@playwright/test';
import { getBrowserPath } from './server/src/services/browser-path';
import { getVendorEnv } from './server/src/services/vendor-browser';

const output = process.env.PLAYWRIGHT_AUTO_OUTPUT ?? 'test-results';
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE || undefined;
const executablePath = getBrowserPath();
const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';

Object.assign(process.env, getVendorEnv());

export default defineConfig({
  testDir: '.',
  testMatch: ['data/projects/**/cases/**/*.spec.ts'],
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
