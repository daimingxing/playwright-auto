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
});
