import { Router } from 'express';
import { startRecordSession, stopRecordSession } from '../services/record/record-session';

interface RecordParams {
  projectKey: string;
  caseKey: string;
}

export const recordRouter = Router({ mergeParams: true });

recordRouter.post<RecordParams>('/start', async (req, res, next) => {
  try {
    res.status(201).json(await startRecordSession(req.params.projectKey, req.params.caseKey, req.body));
  } catch (error) {
    next(error);
  }
});

recordRouter.post<RecordParams>('/stop', async (req, res, next) => {
  try {
    res.json(await stopRecordSession(req.params.projectKey, req.params.caseKey, req.body.sessionId));
  } catch (error) {
    next(error);
  }
});
