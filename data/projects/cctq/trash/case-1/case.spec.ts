import { test, expect } from '@playwright/test';

test('测试', async ({ page }) => {
  await page.goto('/');
});
