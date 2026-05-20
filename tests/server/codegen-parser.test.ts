import { describe, expect, it } from 'vitest';
import { parseCodegenSpec } from '../../server/src/services/codegen-parser';

describe('codegen 脚本解析器', () => {
  it('把 Playwright codegen 输出转换为平台步骤', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://example.test/orders');
  await page.getByRole('textbox', { name: '名称' }).fill('测试订单');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('link', { name: '售后 QQ' }).hover();
  await page.getByRole('button', { name: '更多' }).dblclick();
  await page.getByRole('row', { name: '订单 1' }).click({ button: 'right' });
  await expect(page.getByText('保存成功')).toBeVisible();
  await expect(page.getByLabel('名称')).toHaveValue('测试订单');
  await expect(page).toHaveURL(/.*orders/);
  await expect(page).toHaveTitle(/订单/);
});
`;

    const result = parseCodegenSpec(code);

    expect(result.steps).toMatchObject([
      { type: 'goto', value: 'https://example.test/orders', timeout: 10000 },
      { type: 'fill', selector: "getByRole('textbox', { name: '名称' })", value: '测试订单', timeout: 1000 },
      { type: 'click', selector: "getByRole('button', { name: '保存' })", timeout: 1000 },
      { type: 'hover', selector: "getByRole('link', { name: '售后 QQ' })", timeout: 1000 },
      { type: 'doubleClick', selector: "getByRole('button', { name: '更多' })", timeout: 1000 },
      { type: 'rightClick', selector: "getByRole('row', { name: '订单 1' })", timeout: 1000 },
      { type: 'assertVisible', selector: "getByText('保存成功')" },
      { type: 'assertValue', selector: "getByLabel('名称')", value: '测试订单' },
      { type: 'assertUrl', value: '/.*orders/' },
      { type: 'assertTitle', value: '/订单/' }
    ]);
  });

  it('忽略第一阶段不支持的复杂语句', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.getByRole('button', { name: '导出' }).click();
  const downloadPromise = page.waitForEvent('download');
  const download = await downloadPromise;
  await download.saveAs('result.xlsx');
});
`;

    const result = parseCodegenSpec(code);

    expect(result.steps).toMatchObject([
      { type: 'click', selector: "getByRole('button', { name: '导出' })", timeout: 1000 }
    ]);
  });

  it('把 codegen 页面别名选择器规范化为当前页面选择器', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page1.getByText('---请选择---').first().click();
  await expect(page1.locator('div').filter({ hasText: '查询成功' })).toBeVisible();
});
`;

    const result = parseCodegenSpec(code);

    expect(result.steps).toMatchObject([
      { type: 'click', selector: "getByText('---请选择---').first()", timeout: 1000 },
      { type: 'assertVisible', selector: "locator('div').filter({ hasText: '查询成功' })" }
    ]);
  });

  it('保留点击打开新标签页后的页面归属', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '采矿设备型号定义' }).click();
  const page1 = await page1Promise;
  await page1.getByRole('button', { name: 'select' }).first().click();
  await expect(page1.locator('#ef_form_head')).toContainText('采矿设备型号定义 > IMEQ09');
});
`;

    const result = parseCodegenSpec(code);

    expect(result.steps).toMatchObject([
      {
        type: 'click',
        selector: "getByRole('link', { name: '采矿设备型号定义' })",
        opensPageAlias: 'page1'
      },
      {
        type: 'click',
        selector: "getByRole('button', { name: 'select' }).first()",
        pageAlias: 'page1'
      },
      {
        type: 'assertText',
        selector: "locator('#ef_form_head')",
        value: '采矿设备型号定义 > IMEQ09',
        pageAlias: 'page1'
      }
    ]);
  });
});
