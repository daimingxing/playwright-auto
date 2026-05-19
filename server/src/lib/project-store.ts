import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectMeta } from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { getProjectPath, getProjectsRoot } from './path';
import { createProjectSchema } from './schema';

interface CreateProjectInput {
  name: string;
  key: string;
  baseUrl: string;
}

/**
 * 创建项目目录和项目配置。
 */
export async function createProject(input: CreateProjectInput) {
  const value = createProjectSchema.parse(input);
  const basePath = getProjectPath(value.key);

  if (existsSync(basePath)) {
    throw new Error('项目标识已存在');
  }

  const now = new Date().toISOString();
  const project: ProjectMeta = {
    name: value.name,
    key: value.key,
    envs: [
      {
        name: '默认环境',
        key: 'default',
        baseUrl: value.baseUrl
      }
    ],
    defaultEnv: 'default',
    createdAt: now,
    updatedAt: now
  };

  await ensureDir(join(basePath, 'cases'));
  await ensureDir(join(basePath, 'trash'));
  await ensureDir(join(basePath, 'runs'));
  await ensureDir(join(basePath, 'auth'));
  await writeJson(join(basePath, 'project.json'), project);

  return project;
}

/**
 * 读取项目配置。
 */
export async function getProject(projectKey: string) {
  return readJson<ProjectMeta>(join(getProjectPath(projectKey), 'project.json'));
}

/**
 * 读取全部项目配置。
 */
export async function listProjects() {
  const root = getProjectsRoot();
  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const items = await Promise.all(
    names.map((name) => readJson<ProjectMeta>(join(root, name, 'project.json')))
  );

  return items;
}
