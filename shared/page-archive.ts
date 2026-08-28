import { createHash } from 'node:crypto';
import { isFullUrl } from './url';
import type {
  ExplorationResult,
  ImportActionType,
  IntentStep,
  OperationRecipe,
  PageArchiveRevision,
  PageState,
  PageTarget,
  TestIntent,
  VerifiedLocator
} from './types';

const DEFAULT_STATE_ID = 'default';
const DYNAMIC_ID_PATTERN = /^\d+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BuildPageArchiveRevisionInput {
  revisionId: string;
  capturedAt: string;
  envKey: string;
  routePattern: string;
  intent: Pick<TestIntent, 'steps' | 'startPath'>;
  exploration: ExplorationResult;
}

/**
 * 把起始路径归并为页面档案使用的业务路由模式。
 * 去掉查询参数和哈希，并把数字或 UUID 路径段替换为 `:id`。
 */
export function toRoutePattern(startPath: string): string {
  const raw = startPath.trim() || '/';
  const pathname = pathnameOf(raw);
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const segments = normalized.split('/').map((segment) => {
    if (!segment) {
      return segment;
    }

    if (DYNAMIC_ID_PATTERN.test(segment) || UUID_PATTERN.test(segment)) {
      return ':id';
    }

    return segment;
  });

  return segments.join('/') || '/';
}

/**
 * 按项目环境和路由模式生成页面档案标识。
 */
export function createPageArchiveId(envKey: string, routePattern: string): string {
  const digest = createHash('sha256').update(routePattern).digest('hex').slice(0, 12);
  return `pag-${envKey}-${digest}`;
}

/**
 * 页面目标在档案内的稳定键，按业务动作和目标归并，不使用意图步骤标识。
 */
export function createPageTargetKey(action: ImportActionType, target: string): string {
  return `${action}:${target.trim()}`;
}

/**
 * 从一次探索结果构造不可变页面档案版本。
 */
export function buildPageArchiveRevision(input: BuildPageArchiveRevisionInput): PageArchiveRevision {
  const targets: PageTarget[] = [];
  const recipes: OperationRecipe[] = [];
  const usedRecipeIds = new Set<string>();

  for (const [index, step] of input.intent.steps.entries()) {
    const locator = input.exploration.locators[step.id];

    if (!locator) {
      continue;
    }

    const key = createPageTargetKey(step.action, step.target);
    if (!targets.some((item) => item.key === key)) {
      targets.push({
        key,
        action: step.action,
        target: step.target,
        meaning: step.target,
        locator
      });
    }

    recipes.push({
      id: createRecipeId(usedRecipeIds, index),
      fromStateId: DEFAULT_STATE_ID,
      toStateId: DEFAULT_STATE_ID,
      action: step.action,
      target: step.target,
      ...(step.data ? { data: step.data } : {}),
      locator
    });
  }

  const state: PageState = {
    id: DEFAULT_STATE_ID,
    ...(input.exploration.pageUrl ? { url: input.exploration.pageUrl } : {}),
    entrySteps: [{ action: '打开页面', target: input.intent.startPath || input.routePattern }],
    targets,
    recipes,
    capturedAt: input.capturedAt
  };

  return {
    id: input.revisionId,
    capturedAt: input.capturedAt,
    envKey: input.envKey,
    routePattern: input.routePattern,
    states: [state]
  };
}

/**
 * 把新探索合并进已有版本：同键页面目标以新值为准，操作配方按动作和目标去重。
 */
export function mergePageArchiveRevision(
  current: PageArchiveRevision,
  incoming: PageArchiveRevision
): PageArchiveRevision {
  const currentState = current.states[0];
  const incomingState = incoming.states[0];

  if (!currentState || !incomingState) {
    return incoming;
  }

  const targets = new Map(currentState.targets.map((item) => [item.key, item]));
  for (const target of incomingState.targets) {
    targets.set(target.key, target);
  }

  const recipes = [...currentState.recipes];
  for (const recipe of incomingState.recipes) {
    if (!recipes.some((item) => item.action === recipe.action && item.target === recipe.target)) {
      recipes.push(recipe);
    }
  }

  return {
    ...incoming,
    states: [
      {
        ...incomingState,
        url: incomingState.url ?? currentState.url,
        title: incomingState.title ?? currentState.title,
        entrySteps: incomingState.entrySteps.length > 0 ? incomingState.entrySteps : currentState.entrySteps,
        targets: [...targets.values()],
        recipes,
        snapshotPath: incomingState.snapshotPath ?? currentState.snapshotPath,
        snapshotHash: incomingState.snapshotHash ?? currentState.snapshotHash
      }
    ]
  };
}

/**
 * 判断当前档案是否已覆盖该用例所需的页面目标。
 */
export function archiveCoversSteps(revision: PageArchiveRevision, steps: IntentStep[]): boolean {
  const keys = new Set(revision.states.flatMap((state) => state.targets.map((item) => item.key)));

  return neededTargetKeys(steps).every((key) => keys.has(key));
}

/**
 * 按业务动作和目标，把档案中的定位器对齐到当前意图步骤。
 */
export function explorationFromArchive(
  revision: PageArchiveRevision,
  steps: IntentStep[],
  pageUrl?: string
): ExplorationResult {
  const byKey = new Map(
    revision.states.flatMap((state) => state.targets.map((item) => [item.key, item.locator]))
  );
  const locators: Record<string, VerifiedLocator> = {};

  for (const step of steps) {
    const locator = byKey.get(createPageTargetKey(step.action, step.target));

    if (locator) {
      locators[step.id] = locator;
    }
  }

  const url = pageUrl ?? revision.states[0]?.url;
  return url ? { locators, pageUrl: url } : { locators };
}

/**
 * 收集需要定位器的意图步骤对应的页面目标键。
 */
export function neededTargetKeys(steps: IntentStep[]): string[] {
  return steps
    .filter((step) => step.action !== '打开页面' && step.target.trim())
    .map((step) => createPageTargetKey(step.action, step.target));
}

/**
 * 从路径或完整地址取出用于归并的 pathname。
 */
function pathnameOf(value: string): string {
  const withoutQuery = value.split('?')[0]?.split('#')[0] ?? '/';

  if (isFullUrl(withoutQuery)) {
    try {
      return new URL(withoutQuery).pathname || '/';
    } catch {
      return withoutQuery;
    }
  }

  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

/**
 * 生成版本内唯一的操作配方标识。
 */
function createRecipeId(used: Set<string>, index: number): string {
  let id = `rcp-${index + 1}`;
  let suffix = 2;

  while (used.has(id)) {
    id = `rcp-${index + 1}-${suffix}`;
    suffix += 1;
  }

  used.add(id);
  return id;
}
