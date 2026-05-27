import { describe, expect, it } from 'vitest';
import {
  buildLocatorSelector,
  createDefaultLocatorState,
  formatLocatorSummary,
  locatorModes,
  parseLocatorSelector,
  renderLocatorExpression,
  roleOptions
} from '../../web/src/pages/locator-builder/locator-builder';

describe('定位器构建器', () => {
  it('会生成常用定位方式 selector', () => {
    expect(buildLocatorSelector({ mode: 'role', role: 'button', value: '保存' })).toBe("getByRole('button', { name: '保存' })");
    expect(buildLocatorSelector({ mode: 'text', value: '提交', exact: true })).toBe("getByText('提交', { exact: true })");
    expect(buildLocatorSelector({ mode: 'label', value: '用户名' })).toBe("getByLabel('用户名')");
    expect(buildLocatorSelector({ mode: 'placeholder', value: '请输入用户名' })).toBe("getByPlaceholder('请输入用户名')");
    expect(buildLocatorSelector({ mode: 'testId', value: 'submit-button' })).toBe("getByTestId('submit-button')");
    expect(buildLocatorSelector({ mode: 'title', value: '关闭' })).toBe("getByTitle('关闭')");
    expect(buildLocatorSelector({ mode: 'altText', value: '公司 Logo' })).toBe("getByAltText('公司 Logo')");
    expect(buildLocatorSelector({ mode: 'css', value: '.dialog .submit' })).toBe("locator('.dialog .submit')");
  });

  it('会转义文本并按固定顺序生成链式增强', () => {
    const selector = buildLocatorSelector({
      mode: 'text',
      value: 'Bob\'s "Save"',
      scope: '.dialog',
      hasText: '订单',
      indexMode: 'nth',
      nth: 2
    });

    expect(selector).toBe('locator(\'.dialog\').getByText(\'Bob\\\'s "Save"\').filter({ hasText: \'订单\' }).nth(2)');
  });

  it('会生成角色状态约束', () => {
    const selector = buildLocatorSelector({
      mode: 'role',
      role: 'checkbox',
      value: '订阅',
      exact: true,
      roleOptions: {
        checked: true,
        disabled: false,
        level: 2
      }
    });

    expect(selector).toBe("getByRole('checkbox', { name: '订阅', exact: true, checked: true, disabled: false, level: 2 })");
  });

  it('会解析常见 selector 并生成摘要', () => {
    expect(parseLocatorSelector("getByRole('button', { name: '保存', exact: true })")).toMatchObject({
      mode: 'role',
      role: 'button',
      value: '保存',
      exact: true
    });
    expect(parseLocatorSelector("locator('.dialog').getByText('保存').first()")).toMatchObject({
      mode: 'text',
      scope: '.dialog',
      value: '保存',
      indexMode: 'first'
    });
    expect(formatLocatorSummary("getByRole('button', { name: '保存' })")).toBe('角色 / button / 保存');
    expect(formatLocatorSummary("getByText('提交', { exact: true })")).toBe('文本 / 提交 / 精确');
  });

  it('无法解析时会进入高级模式并保留原始 selector', () => {
    expect(parseLocatorSelector("getByRole('button').filter({ has: page.locator('.x') })")).toEqual({
      mode: 'advanced',
      value: '',
      indexMode: 'none',
      advancedSelector: "getByRole('button').filter({ has: page.locator('.x') })"
    });
    expect(createDefaultLocatorState("locator('div').findByText('保存')")).toEqual({
      mode: 'advanced',
      value: '',
      indexMode: 'none',
      advancedSelector: "locator('div').findByText('保存')"
    });
    expect(formatLocatorSummary("locator('div').findByText('保存')")).toBe('手写定位');
  });

  it('会提供常用角色选项', () => {
    expect(roleOptions.slice(0, 4).map((item) => item.value)).toEqual(['button', 'textbox', 'checkbox', 'radio']);
  });

  it('会生成正则、description 和过滤条件', () => {
    const selector = buildLocatorSelector({
      mode: 'role',
      role: 'button',
      value: { kind: 'regex', text: '保存|提交', flags: 'i' },
      description: { kind: 'text', text: '订单操作' },
      hasText: { kind: 'regexLiteral', text: '/订单\\d+/' },
      hasNotText: { kind: 'text', text: '已删除' },
      visible: true,
      indexMode: 'first'
    });

    expect(selector).toBe("getByRole('button', { name: /保存|提交/i, description: '订单操作' }).filter({ hasText: /订单\\d+/, hasNotText: '已删除', visible: true }).first()");
  });

  it('会生成 has 和 hasNot 简单子定位器', () => {
    const selector = buildLocatorSelector({
      mode: 'css',
      value: 'tr',
      has: {
        mode: 'role',
        role: 'button',
        value: { kind: 'text', text: '编辑' }
      },
      hasNot: {
        mode: 'text',
        value: { kind: 'regexLiteral', text: '/已删除|停用/' }
      }
    });

    expect(selector).toBe("locator('tr').filter({ has: getByRole('button', { name: '编辑' }), hasNot: getByText(/已删除|停用/) })");
  });

  it('会为测试文件渲染带页面变量的嵌套 Locator 表达式', () => {
    const expression = renderLocatorExpression(
      {
        mode: 'css',
        value: 'tr',
        has: {
          mode: 'role',
          role: 'button',
          value: { kind: 'text', text: '编辑' }
        }
      },
      'page1'
    );

    expect(expression).toBe("page1.locator('tr').filter({ has: page1.getByRole('button', { name: '编辑' }) })");
  });

  it('会把高级模式中的裸 CSS 渲染成 locator 表达式', () => {
    expect(renderLocatorExpression({
      mode: 'advanced',
      value: '',
      indexMode: 'none',
      advancedSelector: "button:has-text('新增')"
    })).toBe("page.locator('button:has-text(\\'新增\\')')");
    expect(renderLocatorExpression({
      mode: 'advanced',
      value: '',
      indexMode: 'none',
      advancedSelector: "getByText('新增')"
    })).toBe("page.getByText('新增')");
  });

  it('会把全量 role 放入下拉并保持常用 role 置顶', () => {
    expect(roleOptions.slice(0, 4).map((item) => item.value)).toEqual(['button', 'textbox', 'checkbox', 'radio']);
    expect(roleOptions.map((item) => item.value)).toContain('navigation');
    expect(roleOptions.map((item) => item.value)).toContain('treeitem');
  });

  it('会把技术定位方式标成更易理解的文案', () => {
    expect(locatorModes.find((item) => item.value === 'css')?.label).toBe('CSS（高级）');
    expect(locatorModes.find((item) => item.value === 'advanced')?.label).toBe('手写定位');
  });
});
