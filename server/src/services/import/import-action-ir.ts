import type {
  CaseStep,
  ExplorationResult,
  ImportActionType,
  ImportTaskDetail,
  IntentStep,
  StepType,
  TestIntent,
  VerifiedLocator
} from '../../../../shared/types';
import { hasStepValue } from '../../../../shared/types';
import { badRequest, notFound } from '../../lib/http-error';
import {
  getImportTask,
  persistImportCaseExploration,
  persistImportCaseIntent,
  readImportCaseExploration,
  writeImportCaseExploration,
  writeImportCaseIntent
} from '../../lib/import-store';
import { compileIntentToActions, type ActionCompileIssue } from './intent-compile';
import { isIntentActionType } from './agent-runner';
import { isVerifiedLocator } from './verified-locator';

export interface ImportActionIrPreview {
  ok: boolean;
  steps: CaseStep[];
  issues: ActionCompileIssue[];
}

export interface SaveImportActionIrInput {
  locators?: Record<string, VerifiedLocator>;
  steps?: Array<{ id: string; target?: string; data?: string }>;
}

const EDITABLE: Array<ImportTaskDetail['cases'][number]['status']> = ['pending-review', 'publishable'];

const ACTION_TO_STEP: Record<ImportActionType, StepType> = {
  打开页面: 'goto',
  填写: 'fill',
  选择: 'select',
  点击: 'click',
  检查可见: 'assertVisible',
  检查文本: 'assertText'
};

/**
 * 预览发布用的定位和填写值。校验失败仍返回步骤，方便用户改选择器。
 */
export async function previewImportActionIr(
  projectKey: string,
  taskId: string,
  caseId: string
): Promise<ImportActionIrPreview> {
  const { item } = await getEditableImportCase(projectKey, taskId, caseId, false);

  if (!item.intent) {
    throw badRequest('缺少可审阅的测试意图');
  }

  const exploration = item.exploration ?? (await readImportCaseExploration(projectKey, taskId, item.id));
  const locators = exploration?.locators ?? {};
  const compiled = compileIntentToActions(item.intent, locators);

  if (compiled.ok) {
    return { ok: true, steps: compiled.steps, issues: [] };
  }

  return {
    ok: false,
    steps: toPreviewCaseSteps(item.intent, locators),
    issues: compiled.issues
  };
}

/**
 * 保存用户在高级区改过的定位器和步骤数据。未发布前写入任务工作区，已确认的同时保留到 cases。
 */
export async function saveImportActionIr(
  projectKey: string,
  taskId: string,
  caseId: string,
  input: SaveImportActionIrInput
): Promise<ImportTaskDetail> {
  const { item } = await getEditableImportCase(projectKey, taskId, caseId, true);

  if (!item.intent) {
    throw badRequest('缺少可审阅的测试意图');
  }

  const existing = item.exploration ?? (await readImportCaseExploration(projectKey, taskId, item.id));
  const locators = mergeLocators(existing?.locators ?? {}, input.locators);
  const intent = applyStepEdits(item.intent, input.steps);
  const exploration: ExplorationResult = {
    locators,
    ...(existing?.pageUrl ? { pageUrl: existing.pageUrl } : {})
  };

  await writeImportCaseIntent(projectKey, taskId, item.id, intent);
  await writeImportCaseExploration(projectKey, taskId, item.id, exploration);

  if (item.status === 'publishable') {
    await persistImportCaseIntent(projectKey, taskId, item.id, intent);
    await persistImportCaseExploration(projectKey, taskId, item.id, exploration);
  }

  return getImportTask(projectKey, taskId);
}

/**
 * 读取可预览或可编辑的导入用例。保存时拒绝已发布和没有意图的条目。
 */
async function getEditableImportCase(
  projectKey: string,
  taskId: string,
  caseId: string,
  forSave: boolean
) {
  const task = await getImportTask(projectKey, taskId);
  const item = task.cases.find((entry) => entry.id === caseId);

  if (!item) {
    throw notFound('导入用例不存在');
  }

  if (forSave && !EDITABLE.includes(item.status)) {
    throw badRequest('只有待确认或可发布的用例可以改定位和填写值');
  }

  return { task, item };
}

/**
 * 合并用户提交的定位器，非法项拒绝保存。
 */
function mergeLocators(
  current: Record<string, VerifiedLocator>,
  incoming: Record<string, VerifiedLocator> | undefined
) {
  if (!incoming) {
    return current;
  }

  const next = { ...current };

  for (const [stepId, locator] of Object.entries(incoming)) {
    if (!isVerifiedLocator(locator)) {
      throw badRequest('定位器必须是已验证的结构化定位器');
    }

    next[stepId] = {
      selector: locator.selector.trim(),
      selectorDraft: locator.selectorDraft
    };
  }

  return next;
}

/**
 * 把意图步骤展开为可编辑的发布步骤，校验失败时仍保留选择器和填写值。
 */
function toPreviewCaseSteps(intent: TestIntent, locators: Record<string, VerifiedLocator>): CaseStep[] {
  return intent.steps.map((step) => toPreviewCaseStep(intent, step, locators[step.id]));
}

/**
 * 把单个意图步骤转成发布步骤行。
 */
function toPreviewCaseStep(intent: TestIntent, step: IntentStep, locator: VerifiedLocator | undefined): CaseStep {
  const type = isIntentActionType(step.action) ? ACTION_TO_STEP[step.action] : 'click';
  const row: CaseStep = { id: step.id, type };

  if (locator && isVerifiedLocator(locator)) {
    row.selector = locator.selector;
    row.selectorDraft = locator.selectorDraft;
  }

  if (type === 'goto') {
    row.value = step.target.trim() || step.data.trim() || intent.startPath;
  } else if (hasStepValue(type)) {
    row.value = step.data;
  }

  return row;
}

/**
 * 把改过的填写值写回对应意图步骤。
 */
function applyStepEdits(intent: TestIntent, edits: SaveImportActionIrInput['steps']): TestIntent {
  if (!edits?.length) {
    return intent;
  }

  const byId = new Map(edits.map((item) => [item.id, item]));

  return {
    ...intent,
    steps: intent.steps.map((step) => {
      const edit = byId.get(step.id);

      if (!edit) {
        return step;
      }

      return {
        ...step,
        target: edit.target !== undefined ? edit.target : step.target,
        data: edit.data !== undefined ? edit.data : step.data
      };
    })
  };
}
