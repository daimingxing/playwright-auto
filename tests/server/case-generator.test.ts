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
});
