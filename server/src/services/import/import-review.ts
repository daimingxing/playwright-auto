import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExplorationResult, ImportCaseStatus, ImportTaskCase, ImportTaskDetail, TestIntent } from '../../../../shared/types';
import { getAppConfig } from '../../lib/app-config';
import { ensureDir, writeJson } from '../../lib/fs';
import { badRequest, notFound } from '../../lib/http-error';
import {
  getImportParseSnapshot,
  getImportTask,
  persistImportCaseExploration,
  persistImportCaseIntent,
  readImportCaseExploration,
  updateImportCaseStatus,
  writeImportCaseExploration,
  writeImportCaseIntent
} from '../../lib/import-store';
import {
  getImportCaseDiagnosticsPath,
  getImportCaseOutputPath,
  getImportCaseWorkPath
} from '../../lib/path';
import { getProject } from '../../lib/project-store';
import { getProjectAuthPath } from '../auth-session';
import type { AgentRunner, AgentRunResult } from './agent-runner';
import { isIntentActionType } from './agent-runner';

const REVIEW_ELIGIBLE: ImportCaseStatus[] = ['parsed', 'exploring', 'generating'];
const RETRY_BLOCKED: ImportCaseStatus[] = ['publishable', 'published', 'parse-failed'];

/**
 * 对已解析且尚未确认的用例运行 Agent，生成可审阅 TestIntent。
 */
export async function reviewImportTask(
  projectKey: string,
  taskId: string,
  runner: AgentRunner,
  options: { signal?: AbortSignal } = {}
): Promise<ImportTaskDetail> {
  const task = await getImportTask(projectKey, taskId);
  const parseSnapshot = await getImportParseSnapshot(projectKey, taskId);

  if (!parseSnapshot) {
    throw badRequest('解析快照缺失，无法审阅');
  }

  for (const parsed of parseSnapshot.cases) {
    const current = task.cases.find((item) => item.id === parsed.id) ?? parsed;

    if (!REVIEW_ELIGIBLE.includes(current.status)) {
      continue;
    }

    await processImportCase(projectKey, taskId, { ...parsed, id: current.id }, runner, options.signal);
  }

  return getImportTask(projectKey, taskId);
}

/**
 * 确认一条待确认用例。只更新任务内状态，不发布正式用例。
 */
export async function confirmImportCase(
  projectKey: string,
  taskId: string,
  caseId: string
): Promise<ImportTaskDetail> {
  const { item } = await getImportCaseContext(projectKey, taskId, caseId);

  if (item.status === 'publishable') {
    throw badRequest('该用例已确认');
  }

  if (item.status !== 'pending-review') {
    throw badRequest('只有待确认的用例可以确认');
  }

  if (!item.intent) {
    throw badRequest('缺少可审阅的测试意图');
  }

  await persistImportCaseIntent(projectKey, taskId, item.id, item.intent);
  const exploration = item.exploration ?? (await readImportCaseExploration(projectKey, taskId, item.id));

  if (exploration) {
    await persistImportCaseExploration(projectKey, taskId, item.id, exploration);
  }

  await updateImportCaseStatus(projectKey, taskId, item, 'publishable');
  return getImportTask(projectKey, taskId);
}

/**
 * 只重试目标用例，不影响已确认条目。
 */
export async function retryImportCase(
  projectKey: string,
  taskId: string,
  caseId: string,
  runner: AgentRunner,
  options: { signal?: AbortSignal } = {}
): Promise<ImportTaskDetail> {
  const { item, parsed } = await getImportCaseContext(projectKey, taskId, caseId);

  if (RETRY_BLOCKED.includes(item.status)) {
    throw badRequest(retryBlockedMessage(item.status));
  }

  await processImportCase(projectKey, taskId, parsed, runner, options.signal);
  return getImportTask(projectKey, taskId);
}

/**
 * 读取任务中的目标用例及其解析快照，缺少解析快照时拒绝继续。
 */
async function getImportCaseContext(projectKey: string, taskId: string, caseId: string) {
  const task = await getImportTask(projectKey, taskId);
  const item = task.cases.find((entry) => entry.id === caseId);

  if (!item) {
    throw notFound('导入用例不存在');
  }

  const parseSnapshot = await getImportParseSnapshot(projectKey, taskId);

  if (!parseSnapshot) {
    throw badRequest('解析快照缺失，无法审阅');
  }

  const parsed = parseSnapshot.cases.find((entry) => entry.id === caseId);

  if (!parsed) {
    throw notFound('导入用例不存在');
  }

  return { task, item, parsed };
}

/**
 * 推进单条用例的探索/生成状态，并把 Agent 候选结果写入任务工作区。
 */
async function processImportCase(
  projectKey: string,
  taskId: string,
  item: ImportTaskCase,
  runner: AgentRunner,
  signal?: AbortSignal
) {
  const workDir = getImportCaseWorkPath(projectKey, taskId, item.id);
  const outputDir = getImportCaseOutputPath(projectKey, taskId, item.id);
  const diagnosticsDir = getImportCaseDiagnosticsPath(projectKey, taskId, item.id);
  const stages: ImportCaseStatus[] = [];
  const explore = await readExploreContext(projectKey);

  await ensureDir(workDir);
  await ensureDir(outputDir);
  await ensureDir(diagnosticsDir);
  await recordCaseStage(projectKey, taskId, item, 'exploring', stages);
  await recordCaseStage(projectKey, taskId, item, 'generating', stages);

  const result = await runner.run({
    projectKey,
    taskId,
    item,
    workDir,
    outputDir,
    diagnosticsDir,
    signal,
    timeoutMs: getAppConfig().agent.timeoutMs,
    baseUrl: explore.baseUrl,
    storageStatePath: explore.storageStatePath
  });

  // 失败结果带 message；成功/歧义带 intent。用 in 收窄，避免联合 kind 无法互斥。
  if ('message' in result) {
    await updateImportCaseStatus(projectKey, taskId, item, 'failed', {
      failure: { kind: result.kind, message: result.message }
    });
    stages.push('failed');
  } else {
    const intent = assertReviewIntent(result.intent);
    await writeImportCaseIntent(projectKey, taskId, item.id, intent);
    await writeExplorationIfPresent(projectKey, taskId, item.id, result.exploration);
    await recordCaseStage(projectKey, taskId, item, 'pending-review', stages);
  }

  await writeJson(join(diagnosticsDir, 'result.json'), {
    kind: result.kind,
    stages,
    at: new Date().toISOString(),
    message: getResultMessage(result)
  });
}

/**
 * 写入中间或终态审阅状态，并记录到阶段列表。
 */
async function recordCaseStage(
  projectKey: string,
  taskId: string,
  item: ImportTaskCase,
  status: ImportCaseStatus,
  stages: ImportCaseStatus[]
) {
  await updateImportCaseStatus(projectKey, taskId, item, status);
  stages.push(status);
}

/**
 * 校验 Agent 返回的 TestIntent：必须带业务动作和来源引用，不得使用 Playwright 步骤类型。
 */
function assertReviewIntent(intent: TestIntent): TestIntent {
  if (!intent.caseNumber || !intent.source?.sheet) {
    throw badRequest('Agent 返回的测试意图缺少来源引用');
  }

  for (const step of intent.steps) {
    if (!isIntentActionType(step.action)) {
      throw badRequest('测试意图必须使用业务动作类型');
    }

    if (step.sourceRefs.length === 0) {
      throw badRequest('意图步骤缺少来源引用');
    }
  }

  return intent;
}

/**
 * 读取 Agent 结果中的可读说明。
 */
function getResultMessage(result: AgentRunResult) {
  return 'message' in result ? result.message : result.kind;
}

/**
 * 读取项目默认环境地址和已保存登录态路径，供 Agent 注入；不把 storageState 复制进任务目录。
 */
async function readExploreContext(projectKey: string) {
  const project = await getProject(projectKey);
  const env = project.envs.find((item) => item.key === project.defaultEnv) ?? project.envs[0];
  const storageStatePath = env ? getProjectAuthPath(projectKey, env.key) : '';

  return {
    baseUrl: env?.baseUrl,
    storageStatePath: storageStatePath && existsSync(storageStatePath) ? storageStatePath : undefined
  };
}

/**
 * 把单次探索定位器写入任务 output，确认前不进入正式用例。
 */
async function writeExplorationIfPresent(
  projectKey: string,
  taskId: string,
  caseId: string,
  exploration: ExplorationResult | undefined
) {
  if (!exploration) {
    return;
  }

  await writeImportCaseExploration(projectKey, taskId, caseId, exploration);
}

/**
 * 已确认或已发布、以及解析失败的条目不能重试。
 */
function retryBlockedMessage(status: ImportCaseStatus) {
  if (status === 'parse-failed') {
    return '解析失败的用例不能重试';
  }

  if (status === 'published') {
    return '已发布的用例不能重试';
  }

  return '已确认的用例不能重试';
}
