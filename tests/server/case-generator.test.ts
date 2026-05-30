import { describe, expect, it } from 'vitest';
import type { CaseMeta } from '../../shared/types';
import { generateSpec } from '../../server/src/services/case/case-generator';

describe('用例生成器', () => {
  it('根据结构化步骤生成 Playwright TypeScript 用例', () => {
    const item: CaseMeta = {
      name: '创建订单',
      key: 'case-1',
      status: 'draft',
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

    expect(code).toContain('test("创建订单"');
    expect(code).toContain('await page.goto("/orders/create");');
    expect(code).toContain('await page.locator("#name").fill("测试订单");');
    expect(code).toContain('await expect(page.locator(".message")).toContainText("创建成功");');
  });

  it('生成输入框值断言和精确文本断言', () => {
    const item: CaseMeta = {
      name: '检查编辑结果',
      key: 'case-assert',
      status: 'draft',
      startPath: '/profile',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'assertValue', selector: '#nickname', value: '张三' },
        { id: 's2', type: 'assertText', selector: '.title', value: '个人资料', match: 'equals' }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain('await expect(page.locator("#nickname")).toHaveValue("张三");');
    expect(code).toContain('await expect(page.locator(".title")).toHaveText("个人资料");');
  });

  it('生成 codegen locator 表达式步骤', () => {
    const item: CaseMeta = {
      name: '保存订单',
      key: 'case-locator',
      status: 'draft',
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

  it('优先使用 selectorDraft 生成带内部页面前缀的 Locator 表达式', () => {
    const item: CaseMeta = {
      name: '编辑订单行',
      key: 'case-selector-draft',
      status: 'draft',
      startPath: '/orders',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })",
          selectorDraft: {
            mode: 'css',
            value: 'tr',
            has: {
              mode: 'role',
              role: 'button',
              value: { kind: 'text', text: '编辑' }
            }
          }
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.locator('tr').filter({ has: page.getByRole('button', { name: '编辑' }) }).click();");
  });

  it('selectorDraft 会使用步骤页面别名渲染内部 Locator', () => {
    const item: CaseMeta = {
      name: '弹窗内编辑',
      key: 'case-selector-draft-alias',
      status: 'draft',
      startPath: '/orders',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })",
          pageAlias: 'page1',
          selectorDraft: {
            mode: 'css',
            value: 'tr',
            has: {
              mode: 'role',
              role: 'button',
              value: { kind: 'text', text: '编辑' }
            }
          }
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page1.locator('tr').filter({ has: page1.getByRole('button', { name: '编辑' }) }).click();");
  });

  it('给带等待时间的动作步骤生成 Playwright timeout 参数', () => {
    const item: CaseMeta = {
      name: '等待点击',
      key: 'case-timeout',
      status: 'draft',
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

    expect(code).toContain('await page.goto("https://crm.test.local/orders", { timeout: 5000 });');
    expect(code).toContain('await page.locator("#save").click({ timeout: 1000 });');
    expect(code).toContain('await page.locator("#name").fill("测试订单", { timeout: 1000 });');
  });

  it('生成 goto 和 select 步骤', () => {
    const item: CaseMeta = {
      name: '页面跳转和选择',
      key: 'case-nav-select',
      status: 'draft',
      startPath: '/orders',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'goto', value: '/orders/list' },
        { id: 's2', type: 'select', selector: '#status', value: 'done' }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain('await page.goto("/orders/list");');
    expect(code).toContain('await page.locator("#status").selectOption("done");');
  });

  it('Kendo 下拉生成点击控件和选项文本而不是 selectOption', () => {
    const item: CaseMeta = {
      name: '选择取样类别',
      key: 'case-kendo-select',
      status: 'draft',
      startPath: '/samples',
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'select',
          selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
          value: '采购'
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist').click();");
    expect(code).toContain("await page.getByRole('option', { name: \"采购\" }).or(page.getByText(\"采购\", { exact: true })).first().click();");
    expect(code).not.toContain('.selectOption(');
  });

  it('Kendo data-role 下拉生成点击控件和选项文本', () => {
    const item: CaseMeta = {
      name: '选择客户',
      key: 'case-kendo-data-role',
      status: 'draft',
      startPath: '/customers',
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'select',
          selector: "locator('[data-role=\"combobox\"]')",
          value: '长期客户'
        }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.locator('[data-role=\"combobox\"]').click();");
    expect(code).toContain("await page.getByRole('option', { name: \"长期客户\" }).or(page.getByText(\"长期客户\", { exact: true })).first().click();");
    expect(code).not.toContain('.selectOption(');
  });

  it('原生 select 的 combobox role 和 aria-label locator 保持 selectOption', () => {
    const item: CaseMeta = {
      name: '选择状态',
      key: 'case-native-select-locator',
      status: 'draft',
      startPath: '/orders',
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'select', selector: "getByRole('combobox', { name: '状态' })", value: '启用' },
        { id: 's2', type: 'select', selector: "locator('[aria-label=\"状态\"]')", value: '停用' }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain("await page.getByRole('combobox', { name: '状态' }).selectOption(\"启用\");");
    expect(code).toContain("await page.locator('[aria-label=\"状态\"]').selectOption(\"停用\");");
    expect(code).not.toContain("getByRole('option'");
  });

  it('生成悬停、双击和右键点击步骤', () => {
    const item: CaseMeta = {
      name: '鼠标操作',
      key: 'case-mouse',
      status: 'draft',
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
    expect(code).toContain('await page.locator("#more").dblclick({ timeout: 1000 });');
    expect(code).toContain('await page.locator(".order-row").click({ button: \'right\', timeout: 1000 });');
  });

  it('兼容历史数据中的 codegen 页面别名选择器', () => {
    const item: CaseMeta = {
      name: '历史录制',
      key: 'case-page-alias',
      status: 'draft',
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
      status: 'draft',
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

  it('生成包含单引号文本的合法 TypeScript 字符串', () => {
    const item: CaseMeta = {
      name: "O'Reilly 登录",
      key: 'case-quote',
      status: 'draft',
      startPath: '/login',
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
      steps: [
        { id: 's1', type: 'fill', selector: "#user-name", value: "O'Reilly" },
        { id: 's2', type: 'assertText', selector: '.message', value: "You're logged in" }
      ]
    };

    const code = generateSpec(item);

    expect(code).toContain('test("O\'Reilly 登录"');
    expect(code).toContain('await page.locator("#user-name").fill("O\'Reilly");');
    expect(code).toContain('await expect(page.locator(".message")).toContainText("You\'re logged in");');
  });

  it('遇到未知步骤类型时中止生成测试文件', () => {
    const item: CaseMeta = {
      name: '未知步骤',
      key: 'case-unknown',
      status: 'draft',
      startPath: '/orders',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      steps: [
        {
          id: 's1',
          type: 'drag' as CaseMeta['steps'][number]['type'],
          selector: '#source'
        }
      ]
    };

    expect(() => generateSpec(item)).toThrow('暂不支持的步骤类型：drag');
  });
});
