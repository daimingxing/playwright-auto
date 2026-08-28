import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportTaskCase, PageArchiveDetail, PageTarget } from '../../../../shared/types';
import { buildPageArchiveRevision } from '../../../../shared/page-archive';
import { getAppConfig } from '../../lib/app-config';
import { ensureDir, writeJson } from '../../lib/fs';
import { badRequest } from '../../lib/http-error';
import {
  getPageArchive,
  getPageArchiveDiagnosticsPath,
  getPageArchiveWorkPath,
  markPageArchiveRefreshFailed,
  markPageArchiveRefreshing,
  publishPageArchive
} from '../../lib/page-archive-store';
import { getProject } from '../../lib/project-store';
import { getProjectAuthPath } from '../auth-session';
import type { AgentRunner } from './agent-runner';
import { createExplorationCoordinator, type ExplorationCoordinator } from './exploration-lease';

const refreshJobs = new Map<string, Promise<void>>();

/**
 * 启动整页刷新并立即返回。成功后原子替换 current；失败保留旧版本。
 */
export async function startRefreshPageArchive(
  projectKey: string,
  archiveId: string,
  runner: AgentRunner,
  coordinator: ExplorationCoordinator = createExplorationCoordinator()
): Promise<PageArchiveDetail> {
  await getPageArchive(projectKey, archiveId);
  const key = `${projectKey}/${archiveId}`;

  if (refreshJobs.has(key)) {
    return getPageArchive(projectKey, archiveId);
  }

  await markPageArchiveRefreshing(projectKey, archiveId);
  const job = refreshPageArchive(projectKey, archiveId, runner, coordinator).finally(() => {
    if (refreshJobs.get(key) === job) {
      refreshJobs.delete(key);
    }
  });
  refreshJobs.set(key, job);
  void job.catch(() => undefined);
  return getPageArchive(projectKey, archiveId);
}

/**
 * 占用租约后重新探索当前档案的全部已知页面目标。
 */
async function refreshPageArchive(
  projectKey: string,
  archiveId: string,
  runner: AgentRunner,
  coordinator: ExplorationCoordinator
) {
  const archive = await getPageArchive(projectKey, archiveId);
  const leaseKey = `${projectKey}/${archive.envKey}/${archive.id}`;
  const workDir = getPageArchiveWorkPath(projectKey, archiveId);
  const outputDir = join(workDir, 'output');
  const diagnosticsDir = getPageArchiveDiagnosticsPath(projectKey, archiveId);

  await ensureDir(workDir);
  await ensureDir(outputDir);
  await ensureDir(diagnosticsDir);

  try {
    await coordinator.withLease(leaseKey, async () => {
      const item = toRefreshCase(archive);
      const project = await getProject(projectKey);
      const env = project.envs.find((entry) => entry.key === archive.envKey) ?? project.envs[0];
      const storageStatePath = env ? getProjectAuthPath(projectKey, env.key) : '';
      const result = await coordinator.withWorker(() =>
        runner.run({
          projectKey,
          taskId: `refresh-${archiveId}`,
          item,
          workDir,
          outputDir,
          diagnosticsDir,
          timeoutMs: getAppConfig().agent.timeoutMs,
          baseUrl: env?.baseUrl,
          storageStatePath: storageStatePath && existsSync(storageStatePath) ? storageStatePath : undefined
        })
      );

      if ('message' in result) {
        await markPageArchiveRefreshFailed(projectKey, archiveId, result.message);
        await writeJson(join(diagnosticsDir, 'result.json'), {
          kind: result.kind,
          message: result.message,
          at: new Date().toISOString()
        });
        return;
      }

      const exploration = result.exploration;
      if (!exploration) {
        throw badRequest('刷新未返回页面探索结果');
      }

      await publishPageArchive(projectKey, {
        envKey: archive.envKey,
        routePattern: archive.routePattern,
        title: archive.title,
        revision: buildPageArchiveRevision({
          revisionId: '',
          capturedAt: new Date().toISOString(),
          envKey: archive.envKey,
          routePattern: archive.routePattern,
          intent: result.intent,
          exploration
        }),
        ...(existsSync(join(workDir, 'mcp-output')) ? { evidenceDir: join(workDir, 'mcp-output') } : {})
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '刷新页面档案失败';
    await markPageArchiveRefreshFailed(projectKey, archiveId, message);
    await writeJson(join(diagnosticsDir, 'result.json'), {
      kind: 'process-failed',
      message,
      at: new Date().toISOString()
    });
  }
}

/**
 * 按当前档案的页面目标构造刷新用的业务用例，不写入导入任务。
 */
function toRefreshCase(archive: PageArchiveDetail): ImportTaskCase {
  const targets = archive.current.states.flatMap((state) => state.targets);
  const source = {
    sheet: '档案',
    row: 1,
    caseNumber: archive.id,
    cells: { 用例编号: archive.id, 起始路径: archive.routePattern }
  };

  return {
    id: `refresh-${archive.id}`,
    caseNumber: archive.id,
    name: `刷新 ${archive.title}`,
    startPath: archive.routePattern,
    preconditions: '',
    expected: '',
    remark: '',
    status: 'parsed',
    source,
    steps: [
      {
        order: 1,
        action: '打开页面',
        target: archive.routePattern,
        data: '',
        note: '',
        source
      },
      ...targets.map((target, index) => toRefreshStep(target, index + 2, source))
    ],
    errors: []
  };
}

/**
 * 把页面目标转成刷新步骤。
 */
function toRefreshStep(
  target: PageTarget,
  order: number,
  source: ImportTaskCase['source']
): ImportTaskCase['steps'][number] {
  return {
    order,
    action: target.action,
    target: target.target,
    data: '',
    note: '',
    source
  };
}