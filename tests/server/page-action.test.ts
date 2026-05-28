import { describe, expect, it } from 'vitest';
import { buildPageActions } from '../../server/src/services/ai/page-action';
import type { ImportStepSource } from '../../shared/types';

function step(input: Partial<ImportStepSource>): ImportStepSource {
  return {
    caseNo: 'TC001',
    stepNo: input.stepNo ?? 1,
    actionType: input.actionType,
    targetType: input.targetType,
    targetName: input.targetName,
    inputValue: input.inputValue,
    matchType: input.matchType,
    actionText: input.actionText ?? '',
    targetText: input.targetText ?? '',
    dataKeys: input.dataKeys ?? [],
    note: input.note ?? ''
  };
}

describe('页面安全动作识别', () => {
  it('识别菜单、页签、下拉和弹窗为安全探索动作', () => {
    const result = buildPageActions({
      steps: [
        step({ stepNo: 1, actionType: 'click', targetType: 'menu', targetName: '系统管理' }),
        step({ stepNo: 2, actionType: 'click', targetType: 'tab', targetName: '角色权限' }),
        step({ stepNo: 3, actionType: 'click', targetType: 'select', targetName: '状态下拉' }),
        step({ stepNo: 4, actionType: 'click', targetType: 'dialog', targetName: '高级筛选弹窗' })
      ],
      maxDepth: 8
    });

    expect(result.warnings).toEqual([]);
    expect(result.actions).toHaveLength(4);
    expect(result.actions.map((item) => item.targetName)).toEqual(['系统管理', '角色权限', '状态下拉', '高级筛选弹窗']);
    expect(result.actions.map((item) => item.path)).toEqual([['系统管理'], ['系统管理', '角色权限'], ['系统管理', '角色权限', '状态下拉'], ['系统管理', '角色权限', '状态下拉', '高级筛选弹窗']]);
  });

  it('识别打开弹窗、日期控件、折叠面板、树节点和悬停浮层为安全探索动作', () => {
    const result = buildPageActions({
      steps: [
        step({ stepNo: 1, actionType: 'click', targetType: 'button', targetName: '打开详情弹窗', note: '只打开弹窗查看内容' }),
        step({ stepNo: 2, actionType: 'click', targetType: 'date', targetName: '创建日期' }),
        step({ stepNo: 3, actionType: 'click', targetType: 'region', targetName: '更多筛选折叠面板' }),
        step({ stepNo: 4, actionType: 'click', targetType: 'tree', targetName: '组织树节点' }),
        step({ stepNo: 5, actionType: 'hover', targetType: 'text', targetName: '库存说明浮层' })
      ],
      maxDepth: 8
    });

    expect(result.warnings).toEqual([]);
    expect(result.actions.map((item) => item.targetName)).toEqual(['打开详情弹窗', '创建日期', '更多筛选折叠面板', '组织树节点', '库存说明浮层']);
  });

  it('保存、删除、提交和支付等关键词命中后被禁止', () => {
    const result = buildPageActions({
      steps: [
        step({ stepNo: 1, actionType: 'click', targetType: 'menu', targetName: '系统管理' }),
        step({ stepNo: 2, actionType: 'click', targetType: 'button', targetName: '保存' }),
        step({ stepNo: 3, actionType: 'click', targetType: 'button', targetName: '订单', note: '删除订单' }),
        step({ stepNo: 4, actionType: 'click', targetType: 'button', targetName: '提交审批' }),
        step({ stepNo: 5, actionType: 'click', targetType: 'button', targetName: '付款', actionText: '支付订单' })
      ],
      maxDepth: 8
    });

    expect(result.actions.map((item) => item.targetName)).toEqual(['系统管理']);
    expect(result.warnings).toEqual([
      '已跳过危险动作：保存',
      '已跳过危险动作：删除',
      '已跳过危险动作：提交',
      '已跳过危险动作：支付'
    ]);
  });

  it('同一动作路径超过 maxDepth 时截断并记录 warning', () => {
    const result = buildPageActions({
      steps: [
        step({ stepNo: 1, actionType: 'click', targetType: 'menu', targetName: '一级菜单' }),
        step({ stepNo: 2, actionType: 'click', targetType: 'menu', targetName: '二级菜单' }),
        step({ stepNo: 3, actionType: 'click', targetType: 'tab', targetName: '三级页签' })
      ],
      maxDepth: 2
    });

    expect(result.actions).toHaveLength(2);
    expect(result.actions.map((item) => item.targetName)).toEqual(['一级菜单', '二级菜单']);
    expect(result.warnings).toEqual(['已截断超过 2 层的动作路径：一级菜单 > 二级菜单 > 三级页签']);
  });
});
