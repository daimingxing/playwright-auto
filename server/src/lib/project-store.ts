import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta, EnvMeta, ProjectMeta } from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { getProjectPath, getProjectsRoot } from './path';
import { expirePracticalReviewIfNeeded } from './practical-review-store';
import { createEnvSchema, createProjectSchema, updateEnvSchema } from './schema';

interface CreateProjectInput {
  name: string;
  key: string;
  baseUrl: string;
}

type CreateEnvInput = EnvMeta;
type UpdateEnvInput = Pick<EnvMeta, 'baseUrl' | 'name'>;

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
 * 读取项目环境配置。
 */
export async function listProjectEnvs(projectKey: string) {
  const project = await getProject(projectKey);

  return {
    envs: project.envs,
    defaultEnv: project.defaultEnv
  };
}

/**
 * 新增项目环境。
 */
export async function addProjectEnv(projectKey: string, input: CreateEnvInput) {
  const value = createEnvSchema.parse(input);
  const project = await getProject(projectKey);

  if (project.envs.some((env) => env.key === value.key)) {
    throw new Error('环境标识已存在');
  }

  return writeProject({
    ...project,
    envs: [...project.envs, value]
  });
}

/**
 * 更新项目环境名称和地址。
 */
export async function updateProjectEnv(projectKey: string, envKey: string, input: UpdateEnvInput) {
  const value = updateEnvSchema.parse(input);
  const project = await getProject(projectKey);
  const index = project.envs.findIndex((env) => env.key === envKey);

  if (index < 0) {
    throw new Error('环境不存在');
  }

  const envs = [...project.envs];
  envs[index] = {
    ...envs[index],
    ...value
  };

  const nextProject = await writeProject({
    ...project,
    envs
  });

  if (project.envs[index].baseUrl !== value.baseUrl) {
    await expirePracticalReviewsForEnv(projectKey, envKey, value.baseUrl);
  }

  return nextProject;
}

/**
 * 删除非默认项目环境。
 */
export async function deleteProjectEnv(projectKey: string, envKey: string) {
  const project = await getProject(projectKey);

  if (envKey === 'default') {
    throw new Error('默认环境不允许删除');
  }

  if (!project.envs.some((env) => env.key === envKey)) {
    throw new Error('环境不存在');
  }

  await writeProject({
    ...project,
    envs: project.envs.filter((env) => env.key !== envKey)
  });
  // 删除环境后同步清理同名登录态，避免以后重建同 key 环境时误用旧账号。
  await rm(join(getProjectPath(projectKey), 'auth', `${envKey}.storageState.json`), { force: true });
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
  const projectNames = names.filter((name) => existsSync(join(root, name, 'project.json')));
  const items = await Promise.all(
    projectNames.map((name) => readJson<ProjectMeta>(join(root, name, 'project.json')))
  );

  return items;
}

/**
 * 写回项目配置并更新时间。
 */
async function writeProject(project: ProjectMeta) {
  const nextProject: ProjectMeta = {
    ...project,
    updatedAt: new Date().toISOString()
  };

  await writeJson(join(getProjectPath(project.key), 'project.json'), nextProject);

  return nextProject;
}

/**
 * 环境地址变化后，把该环境下不再匹配的实测检查摘要标记为过期。
 */
async function expirePracticalReviewsForEnv(projectKey: string, envKey: string, baseUrl: string) {
  const casesPath = join(getProjectPath(projectKey), 'cases');
  if (!existsSync(casesPath)) {
    return;
  }

  const names = await readdir(casesPath);

  await Promise.all(
    names.map(async (name) => {
      const item = await readJson<CaseMeta>(join(casesPath, name, 'case.json'));

      if (item.practicalReview?.envKey === envKey) {
        await expirePracticalReviewIfNeeded(projectKey, item, baseUrl);
      }
    })
  );
}
