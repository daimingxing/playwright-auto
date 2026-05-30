import { describe, expect, it } from 'vitest';
import { isCustomSelect, normalizeSelector, renderOptionLocator } from '../../server/src/services/case/case-step-render';

describe('用例步骤渲染共享工具', () => {
  it('兼容历史页面别名前缀', () => {
    expect(normalizeSelector("page1.getByText('保存')")).toBe("getByText('保存')");
    expect(normalizeSelector("getByText('保存')")).toBe("getByText('保存')");
  });

  it('只把带明确组件证据的下拉识别为自定义下拉', () => {
    expect(isCustomSelect({ id: 's1', type: 'select', selector: "locator('.k-dropdownlist')", value: '启用' })).toBe(true);
    expect(isCustomSelect({ id: 's2', type: 'select', selector: "locator('[data-role=\"combobox\"]')", value: '启用' })).toBe(true);
    expect(isCustomSelect({ id: 's3', type: 'select', selector: "getByRole('combobox', { name: '状态' })", value: '启用' })).toBe(false);
    expect(isCustomSelect({ id: 's4', type: 'select', selector: 'select#status', value: '启用' })).toBe(false);
  });

  it('按页面变量名生成自定义下拉选项定位器', () => {
    expect(renderOptionLocator('采购', 'page1')).toBe(
      'page1.getByRole(\'option\', { name: "采购" }).or(page1.getByText("采购", { exact: true })).first()'
    );
  });
});
