import type { CaseMeta } from '../../../shared/types';

/**
 * 合并用例列表和当前选择，首次加载时默认选中全部用例。
 */
export function mergeSelectedCaseKeys(cases: CaseMeta[], selectedKeys: string[]) {
  if (selectedKeys.length === 0) {
    return cases.map((item) => item.key);
  }

  const caseKeys = new Set(cases.map((item) => item.key));

  return selectedKeys.filter((key) => caseKeys.has(key));
}

/**
 * 判断当前是否可以开始运行测试。
 */
export function canStartRun(hasAuth: boolean, selectedKeys: string[], running: boolean) {
  return hasAuth && selectedKeys.length > 0 && !running;
}

/**
 * 生成运行按钮文案。
 */
export function getRunButtonText(selectedKeys: string[]) {
  return selectedKeys.length > 0 ? `运行已选 ${selectedKeys.length} 条` : '请选择用例';
}

/**
 * 按选中 key 读取用例明细。
 */
export function getSelectedCases(cases: CaseMeta[], selectedKeys: string[]) {
  const selectedSet = new Set(selectedKeys);

  return cases.filter((item) => selectedSet.has(item.key));
}
