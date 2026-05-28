import type { ImportStepSource, PageAction, PageActionResult, StepType, TargetType } from '../../../../shared/types';

interface PageActionInput {
  steps: ImportStepSource[];
  maxDepth: number;
}

const dangerWords = ['保存', '提交', '删除', '移除', '审批', '确认', '支付', '发送', '导入', '导出', '批量操作', '启用', '禁用'];
const openWords = ['打开', '展开', '切换', '查看', '选择'];
const safeTargets = new Set<TargetType>(['menu', 'tab', 'dialog', 'select', 'date', 'tree']);
const safeTypes = new Set<StepType>(['click', 'hover', 'select']);

/**
 * 从结构化测试步骤中识别页面地图可探索的安全动作。
 */
export function buildPageActions(input: PageActionInput): PageActionResult {
  const actions: PageAction[] = [];
  const warnings: string[] = [];
  const path: string[] = [];
  const maxDepth = Math.max(0, input.maxDepth);

  for (const step of input.steps) {
    const dangerWord = findDangerWord(step);

    if (dangerWord) {
      warnings.push(`已跳过危险动作：${dangerWord}`);
      continue;
    }

    if (!isSafeStep(step)) {
      continue;
    }

    const targetName = getTargetName(step);
    const nextPath = [...path, targetName];

    if (nextPath.length > maxDepth) {
      warnings.push(`已截断超过 ${maxDepth} 层的动作路径：${nextPath.join(' > ')}`);
      continue;
    }

    path.push(targetName);
    actions.push({
      id: `action-${step.stepNo}`,
      type: step.actionType ?? 'click',
      targetType: step.targetType,
      targetName,
      note: step.note || undefined,
      value: step.inputValue || undefined,
      path: [...path]
    });
  }

  return { actions, warnings };
}

/**
 * 判断步骤是否属于页面地图允许的探索动作。
 */
function isSafeStep(step: ImportStepSource) {
  const actionType = step.actionType ?? 'click';
  const targetType = step.targetType;
  const text = getStepText(step);

  if (!safeTypes.has(actionType)) {
    return false;
  }

  if (targetType && safeTargets.has(targetType)) {
    return true;
  }

  if (actionType === 'hover' && hasAnyWord(text, ['浮层', '提示', '说明'])) {
    return true;
  }

  if (targetType === 'button' && hasAnyWord(text, ['弹窗', '窗口', '下拉', '日期', '折叠', '展开'])) {
    return true;
  }

  if (targetType === 'region' && hasAnyWord(text, ['折叠', '面板', '展开'])) {
    return true;
  }

  // 当结构化 targetType 不够具体时，只允许带有明确探索语义的文本进入页面地图动作。
  return hasAnyWord(text, openWords) && hasAnyWord(text, ['菜单', '页签', '弹窗', '窗口', '下拉', '日期', '折叠', '面板', '树节点', '浮层']);
}

/**
 * 在动作类型、目标类型、目标名和备注中查找危险动作关键词。
 */
function findDangerWord(step: ImportStepSource) {
  const text = getStepText(step);

  return dangerWords.find((word) => text.includes(word));
}

/**
 * 汇总安全判断需要同时观察的结构化字段。
 */
function getStepText(step: ImportStepSource) {
  return [step.actionType, step.targetType, step.targetName, step.note, step.actionText, step.targetText].filter(Boolean).join(' ');
}

/**
 * 获取动作目标名，缺失时退回可读的原始目标文本。
 */
function getTargetName(step: ImportStepSource) {
  return step.targetName?.trim() || step.targetText.trim() || step.actionText.trim() || `步骤${step.stepNo}`;
}

/**
 * 判断文本是否包含任一关键词。
 */
function hasAnyWord(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}
