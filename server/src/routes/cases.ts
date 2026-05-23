import { rm } from 'node:fs/promises';
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
import { listPracticalReviewRecords, readPracticalReviewRecord } from '../lib/practical-review-store';
import { getCasePath, getPracticalReviewPath } from '../lib/path';
import { practicalReviewInputSchema } from '../lib/schema';
import { zipDir } from '../services/export';
import { runPracticalReview } from '../services/practical-review';
import { badRequest, notFound } from '../lib/http-error';

interface ProjectParams {
  projectKey: string;
}

interface CaseParams extends ProjectParams {
  caseKey: string;
}

interface ReviewParams extends CaseParams {
  reviewId: string;
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

casesRouter.get<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    await getCase(req.params.projectKey, req.params.caseKey);
    res.json(await listPracticalReviewRecords(req.params.projectKey, req.params.caseKey));
  } catch (error) {
    next(error);
  }
});

casesRouter.post<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    const input = parsePracticalReviewInput(req.body);

    res.status(201).json(await runPracticalReview(req.params.projectKey, req.params.caseKey, input));
  } catch (error) {
    next(error);
  }
});

casesRouter.get<ReviewParams>('/:caseKey/practical-reviews/:reviewId', async (req, res, next) => {
  try {
    await getCase(req.params.projectKey, req.params.caseKey);
    const record = await readPracticalReviewRecord(req.params.projectKey, req.params.reviewId);

    if (record.caseKey !== req.params.caseKey) {
      throw notFound('实测检查记录不存在');
    }

    res.json(record);
  } catch (error) {
    next(error);
  }
});

casesRouter.delete<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    await getCase(req.params.projectKey, req.params.caseKey);
    const records = await listPracticalReviewRecords(req.params.projectKey, req.params.caseKey);

    await Promise.all(
      records.map((record) => rm(getPracticalReviewPath(req.params.projectKey, record.id), { recursive: true, force: true }))
    );
    res.status(204).send();
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

/**
 * 校验实测检查请求参数。
 */
function parsePracticalReviewInput(body: unknown) {
  const result = practicalReviewInputSchema.safeParse(body);

  if (!result.success) {
    throw badRequest('请求参数不合法：请检查 envKey 和 testFailure');
  }

  return result.data;
}

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
