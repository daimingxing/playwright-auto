import { Router } from 'express';
import { createProject, getProject, listProjects } from '../lib/project-store';

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

projectsRouter.get('/:projectKey', async (req, res, next) => {
  try {
    res.json(await getProject(req.params.projectKey));
  } catch (error) {
    next(error);
  }
});
