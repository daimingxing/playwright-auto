import { Router } from 'express';
import {
  addProjectEnv,
  createProject,
  deleteProjectEnv,
  getProject,
  listProjectEnvs,
  listProjects,
  updateProjectEnv
} from '../lib/project-store';

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listProjects());
  } catch (error) {
    next(error);
  }
});

projectsRouter.post('/', async (req, res, next) => {
  try {
    const project = await createProject(req.body);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

projectsRouter.get('/:projectKey/envs', async (req, res, next) => {
  try {
    res.json(await listProjectEnvs(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});

projectsRouter.post('/:projectKey/envs', async (req, res, next) => {
  try {
    res.status(201).json(await addProjectEnv(req.params.projectKey, req.body));
  } catch (error) {
    next(error);
  }
});

projectsRouter.put('/:projectKey/envs/:envKey', async (req, res, next) => {
  try {
    res.json(await updateProjectEnv(req.params.projectKey, req.params.envKey, req.body));
  } catch (error) {
    next(error);
  }
});

projectsRouter.delete('/:projectKey/envs/:envKey', async (req, res, next) => {
  try {
    await deleteProjectEnv(req.params.projectKey, req.params.envKey);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

projectsRouter.get('/:projectKey', async (req, res, next) => {
  try {
    res.json(await getProject(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});
