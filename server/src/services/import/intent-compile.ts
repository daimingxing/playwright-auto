import {
  hasStepSelector,
  type CaseMeta,
  type CaseStep,
  type IntentStep,
  type TestIntent,
  type VerifiedLocator
} from '../../../../shared/types';
import { generateSpec } from '../case/case-generator';
import { isReviewPassed, reviewCase } from '../case-review';
import { isIntentActionType } from './agent-runner';
import { isVerifiedLocator } from './verified-locator';

const MAIN_PAGE_ALIAS = 'page';

export interface ActionGroup {
  intentStepId: string;
  actions: CaseStep[];
}

export interface ActionCompileIssue {
  code:
    | 'unresolved-ambiguity'
    | 'empty-steps'
    | 'unstable-id'
    | 'missing-source-ref'
    | 'invalid-action'
    | 'missing-param'
    | 'unverified-locator'
    | 'invalid-page-ref'
    | 'locator-risk'
    | 'not-executable';
  stepId?: string;
  message: string;
}

export type ActionCompileResult =
  | { ok: true; groups: ActionGroup[]; steps: CaseStep[] }
  | { ok: false; issues: ActionCompileIssue[] };

/**
 * 把线性 TestIntent 转成 Action Group / Action IR，并执行发布前校验。
 * 交互步骤的定位器必须来自页面探索结果，不再对目标文本做启发式猜测。
 */
export function compileIntentToActions(
  intent: TestIntent,
  locators: Record<string, VerifiedLocator> = {}
): ActionCompileResult {
  if (intent.pendingItems.length > 0) {
    return {
      ok: false,
      issues: [
        {
          code: 'unresolved-ambiguity',
          message: '存在未解决的待确认项，不能生成可发布的 Action IR'
        }
      ]
    };
  }

  const issues: ActionCompileIssue[] = [];

  if (intent.steps.length === 0) {
    issues.push({ code: 'empty-steps', message: '测试意图至少需要一个步骤' });
  }

  const usedIds = new Set<string>();
  const groups: ActionGroup[] = [];
  const knownPages = new Set([MAIN_PAGE_ALIAS]);

  for (const step of intent.steps) {
    const compiled = compileIntentStep(intent, step, locators[step.id], usedIds);
    issues.push(...compiled.issues);

    if (!compiled.action) {
      continue;
    }

    const pageAlias = compiled.action.pageAlias ?? MAIN_PAGE_ALIAS;

    if (!knownPages.has(pageAlias)) {
      issues.push({
        code: 'invalid-page-ref',
        stepId: step.id,
        message: `页面引用「${pageAlias}」尚未建立`
      });
    }

    if (compiled.action.opensPageAlias) {
      knownPages.add(compiled.action.opensPageAlias);
    }

    groups.push({
      intentStepId: step.id,
      actions: [compiled.action]
    });
  }

  const steps = groups.flatMap((group) => group.actions);
  issues.push(...validateCompiledActions(intent, steps));

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, groups, steps };
}

/**
 * 把单个意图步骤编译为一个 Action IR 动作。
 */
function compileIntentStep(
  intent: TestIntent,
  step: IntentStep,
  locator: VerifiedLocator | undefined,
  usedIds: Set<string>
): { action?: CaseStep; issues: ActionCompileIssue[] } {
  const issues: ActionCompileIssue[] = [];

  if (!step.id?.trim()) {
    issues.push({ code: 'unstable-id', message: '意图步骤缺少稳定标识' });
  } else if (usedIds.has(step.id)) {
    issues.push({ code: 'unstable-id', stepId: step.id, message: '意图步骤标识重复' });
  } else {
    usedIds.add(step.id);
  }

  if (!step.sourceRefs?.length) {
    issues.push({
      code: 'missing-source-ref',
      stepId: step.id || undefined,
      message: '意图步骤缺少来源引用'
    });
  }

  if (!isIntentActionType(step.action)) {
    issues.push({
      code: 'invalid-action',
      stepId: step.id || undefined,
      message: '测试意图必须使用业务动作类型'
    });
    return { issues };
  }

  const action = toActionIr(intent, step, locator);

  if ('issue' in action) {
    issues.push(action.issue);
    return { issues };
  }

  return { action: action.step, issues };
}

/**
 * 按业务动作类型生成封闭 Playwright 原语。断言值只取自意图中的用户输入。
 */
function toActionIr(
  intent: TestIntent,
  step: IntentStep,
  locator: VerifiedLocator | undefined
): { step: CaseStep } | { issue: ActionCompileIssue } {
  switch (step.action) {
    case '打开页面': {
      const value = readGotoPath(step, intent);

      if (!value) {
        return missingParam(step, '打开页面缺少相对路径');
      }

      return { step: { id: step.id, type: 'goto', value } };
    }
    case '填写': {
      if (!isVerifiedLocator(locator)) {
        return unverifiedLocator(step);
      }

      const value = step.data.trim();

      if (!value) {
        return missingParam(step, '填写步骤缺少输入值');
      }

      return { step: { id: step.id, type: 'fill', ...locator, value } };
    }
    case '选择': {
      if (!isVerifiedLocator(locator)) {
        return unverifiedLocator(step);
      }

      const value = step.data.trim();

      if (!value) {
        return missingParam(step, '选择步骤缺少选项值');
      }

      return { step: { id: step.id, type: 'select', ...locator, value } };
    }
    case '点击': {
      if (!isVerifiedLocator(locator)) {
        return unverifiedLocator(step);
      }

      return { step: { id: step.id, type: 'click', ...locator } };
    }
    case '检查可见': {
      if (!isVerifiedLocator(locator)) {
        return unverifiedLocator(step);
      }

      return { step: { id: step.id, type: 'assertVisible', ...locator } };
    }
    case '检查文本': {
      if (!isVerifiedLocator(locator)) {
        return unverifiedLocator(step);
      }

      const value = step.data.trim();

      if (!value) {
        return missingParam(step, '检查文本缺少期望文本');
      }

      return { step: { id: step.id, type: 'assertText', ...locator, value, match: 'contains' } };
    }
  }
}

/**
 * 校验编译后的 Action IR：定位器可验证、页面引用合法、可确定性生成代码。
 */
function validateCompiledActions(intent: TestIntent, steps: CaseStep[]): ActionCompileIssue[] {
  const issues: ActionCompileIssue[] = [];

  for (const step of steps) {
    if (hasStepSelector(step.type) && !isVerifiedLocator(step)) {
      issues.push({
        code: 'unverified-locator',
        stepId: step.id,
        message: '步骤缺少已验证的结构化定位器'
      });
    }
  }

  if (issues.length > 0 || steps.length === 0) {
    return issues;
  }

  const draftCase: CaseMeta = {
    name: intent.name || intent.caseNumber || '导入用例',
    key: 'case-compile',
    status: 'draft',
    startPath: intent.startPath || '/',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  draftCase.review = reviewCase(draftCase);

  if (!isReviewPassed(draftCase.review)) {
    for (const item of draftCase.review.items) {
      if (item.level === 'error' || item.level === 'danger') {
        issues.push({
          code: 'locator-risk',
          stepId: item.stepId || undefined,
          message: item.message
        });
      }
    }
  }

  try {
    generateSpec(draftCase);
  } catch (error) {
    issues.push({
      code: 'not-executable',
      message: error instanceof Error ? error.message : '无法生成可执行测试代码'
    });
  }

  return issues;
}

/**
 * 读取打开页面路径：优先步骤中的相对路径，否则使用用例起始路径。
 */
function readGotoPath(step: IntentStep, intent: TestIntent) {
  const target = step.target.trim();
  const data = step.data.trim();

  if (isRelativePath(target)) {
    return target;
  }

  if (isRelativePath(data)) {
    return data;
  }

  return intent.startPath.trim();
}

/**
 * 判断文本是否为用例起始所用的相对路径。
 */
function isRelativePath(value: string) {
  return value.startsWith('/');
}

/**
 * 构造缺少参数的校验问题。
 */
function missingParam(step: IntentStep, message: string): { issue: ActionCompileIssue } {
  return { issue: { code: 'missing-param', stepId: step.id, message } };
}

/**
 * 构造未验证定位器的校验问题。
 */
function unverifiedLocator(step: IntentStep): { issue: ActionCompileIssue } {
  return {
    issue: {
      code: 'unverified-locator',
      stepId: step.id,
      message: '步骤缺少已验证的结构化定位器'
    }
  };
}
