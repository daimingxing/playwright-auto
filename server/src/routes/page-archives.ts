import { Router, type Request } from 'express';
import { deletePageArchive, getPageArchive, listPageArchives } from '../lib/page-archive-store';
import type { AgentRunner } from '../services/import/agent-runner';
import { createDefaultAgentRunner } from '../services/import/opencode-runner';
import { createExplorationCoordinator, type ExplorationCoordinator } from '../services/import/exploration-lease';
import { startRefreshPageArchive } from '../services/import/page-archive-refresh';

interface ProjectParams {
  projectKey: string;
}

interface ArchiveParams extends ProjectParams {
  archiveId: string;
}

export const pageArchivesRouter = Router({ mergeParams: true });

pageArchivesRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listPageArchives(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

pageArchivesRouter.get<ArchiveParams>('/:archiveId', async (req, res, next) => {
  try {
    res.json(await getPageArchive(req.params.projectKey, req.params.archiveId));
  } catch (error) {
    next(error);
  }
});

pageArchivesRouter.post<ArchiveParams>('/:archiveId/refresh', async (req, res, next) => {
  try {
    res.json(
      await startRefreshPageArchive(
        req.params.projectKey,
        req.params.archiveId,
        getAgentRunner(req),
        getCoordinator(req)
      )
    );
  } catch (error) {
    next(error);
  }
});

pageArchivesRouter.delete<ArchiveParams>('/:archiveId', async (req, res, next) => {
  try {
    await deletePageArchive(req.params.projectKey, req.params.archiveId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * 读取请求级 AgentRunner。
 */
function getAgentRunner(req: Pick<Request, 'app'>): AgentRunner {
  const runner = req.app.locals.agentRunner as AgentRunner | undefined;
  return runner ?? createDefaultAgentRunner();
}

/**
 * 读取请求级探索租约协调器。
 */
function getCoordinator(req: Pick<Request, 'app'>): ExplorationCoordinator {
  const coordinator = req.app.locals.explorationCoordinator as ExplorationCoordinator | undefined;
  return coordinator ?? createExplorationCoordinator();
}
