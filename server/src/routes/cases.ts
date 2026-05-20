import { Router } from 'express';
import {
  createCase,
  deleteCase,
  getCase,
  listCases,
  listTrash,
  removeTrashCase,
  restoreTrashCase,
  updateCase
} from '../lib/case-store';
import { getCasePath } from '../lib/path';
import { zipDir } from '../services/export';

interface ProjectParams {
  projectKey: string;
}

interface CaseParams extends ProjectParams {
  caseKey: string;
}

export const casesRouter = Router({ mergeParams: true });

casesRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listCases(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

casesRouter.post<ProjectParams>('/', async (req, res, next) => {
  try {
    const item = await createCase(req.params.projectKey, req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

casesRouter.get<CaseParams>('/:caseKey', async (req, res, next) => {
  try {
    res.json(await getCase(req.params.projectKey, req.params.caseKey));
  } catch (error) {
    next(error);
  }
});

casesRouter.get<CaseParams>('/:caseKey/export', async (req, res, next) => {
  try {
    const casePath = getCasePath(req.params.projectKey, req.params.caseKey);
    await getCase(req.params.projectKey, req.params.caseKey);
    const file = await zipDir(casePath, `${req.params.projectKey}-${req.params.caseKey}`);

    res.download(file.zipPath, `${req.params.projectKey}-${req.params.caseKey}.zip`, (error) => {
      file.dispose().catch(next);

      if (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

casesRouter.delete<CaseParams>('/:caseKey', async (req, res, next) => {
  try {
    await deleteCase(req.params.projectKey, req.params.caseKey);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

casesRouter.put<CaseParams>('/:caseKey', async (req, res, next) => {
  try {
    res.json(await updateCase(req.params.projectKey, req.params.caseKey, req.body));
  } catch (error) {
    next(error);
  }
});

export const trashRouter = Router({ mergeParams: true });

trashRouter.get<ProjectParams>('/', async (req, res, next) => {
  try {
    res.json(await listTrash(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

trashRouter.post<CaseParams>('/:caseKey/restore', async (req, res, next) => {
  try {
    res.json(await restoreTrashCase(req.params.projectKey, req.params.caseKey));
  } catch (error) {
    next(error);
  }
});

trashRouter.delete<CaseParams>('/:caseKey', async (req, res, next) => {
  try {
    await removeTrashCase(req.params.projectKey, req.params.caseKey);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
