import { describe, expect, it } from 'vitest';
import type { CaseMeta } from '../../shared/types';
import { generateSpec } from '../../server/src/services/case-generator';

describe('用例生成器', () => {
  it('根据结构化步骤生成 Playwright TypeScript 用例', () => {
    const item: CaseMeta = {
      name: '创建订单',
      key: 'case-1',
      startPath: '/orders/create',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'fill', selector: '#name', value: '测试订单' },
        { id: 's2', type: 'click', selector: 'button[type="submit"]' },
        { id: 's3', type: 'assertText', selector: '.message', value: '创建成功' }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("test('创建订单'");
    expect(code).toContain("await page.goto('/orders/create');");
    expect(code).toContain("await page.locator('#name').fill('测试订单');");
    expect(code).toContain("await expect(page.locator('.message')).toContainText('创建成功');");
  });

  it('生成输入框值断言和精确文本断言', () => {
    const item: CaseMeta = {
      name: '检查编辑结果',
      key: 'case-assert',
      startPath: '/profile',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'assertValue', selector: '#nickname', value: '张三' },
        { id: 's2', type: 'assertText', selector: '.title', value: '个人资料', match: 'equals' }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await expect(page.locator('#nickname')).toHaveValue('张三');");
    expect(code).toContain("await expect(page.locator('.title')).toHaveText('个人资料');");
  });

  it('生成 codegen locator 表达式步骤', () => {
    const item: CaseMeta = {
      name: '保存订单',
      key: 'case-locator',
      startPath: '/orders',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" },
        { id: 's2', type: 'assertVisible', selector: "getByText('保存成功')" }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.getByRole('button', { name: '保存' }).click();");
    expect(code).toContain("await expect(page.getByText('保存成功')).toBeVisible();");
  });

  it('给带等待时间的动作步骤生成 Playwright timeout 参数', () => {
    const item: CaseMeta = {
      name: '等待点击',
      key: 'case-timeout',
      startPath: '/orders',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'goto', value: 'https://crm.test.local/orders', timeout: 5000 },
        { id: 's2', type: 'click', selector: '#save', timeout: 1000 },
        { id: 's3', type: 'fill', selector: '#name', value: '测试订单', timeout: 1000 }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.goto('https://crm.test.local/orders', { timeout: 5000 });");
    expect(code).toContain("await page.locator('#save').click({ timeout: 1000 });");
    expect(code).toContain("await page.locator('#name').fill('测试订单', { timeout: 1000 });");
  });

  it('生成悬停、双击和右键点击步骤', () => {
    const item: CaseMeta = {
      name: '鼠标操作',
      key: 'case-mouse',
      startPath: '/orders',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'hover', selector: "getByRole('link', { name: '售后 QQ' })", timeout: 1000 },
        { id: 's2', type: 'doubleClick', selector: '#more', timeout: 1000 },
        { id: 's3', type: 'rightClick', selector: '.order-row', timeout: 1000 }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.getByRole('link', { name: '售后 QQ' }).hover({ timeout: 1000 });");
    expect(code).toContain("await page.locator('#more').dblclick({ timeout: 1000 });");
    expect(code).toContain("await page.locator('.order-row').click({ button: 'right', timeout: 1000 });");
  });

  it('兼容历史数据中的 codegen 页面别名选择器', () => {
    const item: CaseMeta = {
      name: '历史录制',
      key: 'case-page-alias',
      startPath: '/dashboard',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'click', selector: "page1.getByText('---请选择---').first()", timeout: 1000 },
        {
          id: 's2',
          type: 'assertVisible',
          selector: "page1.locator('div').filter({ hasText: '查询成功' })"
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.getByText('---请选择---').first().click({ timeout: 1000 });");
    expect(code).toContain("await expect(page.locator('div').filter({ hasText: '查询成功' })).toBeVisible();");
  });

  it('生成打开新标签页并在新页面继续操作的步骤', () => {
    const item: CaseMeta = {
      name: '新标签页',
      key: 'case-popup',
      startPath: '/dashboard',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "getByRole('link', { name: '采矿设备型号定义' })",
          timeout: 1000,
          opensPageAlias: 'page1'
        },
        {
          id: 's2',
          type: 'click',
          selector: "getByRole('button', { name: 'select' }).first()",
          timeout: 1000,
          pageAlias: 'page1'
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("const page1Promise = page.waitForEvent('popup');");
    expect(code).toContain("await page.getByRole('link', { name: '采矿设备型号定义' }).click({ timeout: 1000 });");
    expect(code).toContain('const page1 = await page1Promise;');
    expect(code).toContain("await page1.getByRole('button', { name: 'select' }).first().click({ timeout: 1000 });");
  });
});
