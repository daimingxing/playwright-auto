import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPageArchiveId,
  mergePageArchiveRevision,
  toRoutePattern
} from '../../../shared/page-archive';
import type {
  PageArchive,
  PageArchiveDetail,
  PageArchiveFailure,
  PageArchiveRevision
} from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { notFound } from './http-error';
import { getPageArchivePath, getPageArchivesPath } from './path';
import { getProject } from './project-store';

export interface PublishPageArchiveInput {
  envKey: string;
  routePattern: string;
  title?: string;
  revision: Omit<PageArchiveRevision, 'id' | 'capturedAt' | 'envKey' | 'routePattern'> &
    Partial<Pick<PageArchiveRevision, 'id' | 'capturedAt' | 'envKey' | 'routePattern'>>;
  evidenceDir?: string;
}

/**
 * 列出项目下全部页面档案摘要，不含不可变版本正文。
 */
export async function listPageArchives(projectKey: string): Promise<PageArchive[]> {
  await getProject(projectKey);
  const root = getPageArchivesPath(projectKey);

  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const archives: PageArchive[] = [];

  for (const name of names) {
    const metaPath = join(root, name, 'meta.json');

    if (!existsSync(metaPath)) {
      continue;
    }

    archives.push(await readJson<PageArchive>(metaPath));
  }

  return archives.sort((left, right) => left.routePattern.localeCompare(right.routePattern));
}

/**
 * 读取页面档案详情，附带 current 和 previous 版本。
 */
export async function getPageArchive(projectKey: string, archiveId: string): Promise<PageArchiveDetail> {
  await getProject(projectKey);
  const meta = await readArchiveMeta(projectKey, archiveId);
  const current = await readRevision(projectKey, archiveId, meta.currentRevisionId);
  const previous = meta.previousRevisionId
    ? await readRevision(projectKey, archiveId, meta.previousRevisionId)
    : undefined;

  return { ...meta, current, ...(previous ? { previous } : {}) };
}

/**
 * 按环境和起始路径读取当前可用档案版本；没有档案时返回空。
 */
export async function readCurrentPageArchiveRevision(
  projectKey: string,
  envKey: string,
  startPath: string
): Promise<PageArchiveRevision | undefined> {
  const archiveId = createPageArchiveId(envKey, toRoutePattern(startPath));
  const metaPath = join(getPageArchivePath(projectKey, archiveId), 'meta.json');

  if (!existsSync(metaPath)) {
    return undefined;
  }

  const meta = await readJson<PageArchive>(metaPath);
  return readRevision(projectKey, archiveId, meta.currentRevisionId);
}

/**
 * 把候选版本原子发布为 current，原 current 成为 previous，更早版本删除。
 */
export async function publishPageArchive(
  projectKey: string,
  input: PublishPageArchiveInput
): Promise<PageArchiveDetail> {
  await getProject(projectKey);
  const routePattern = input.routePattern;
  const archiveId = createPageArchiveId(input.envKey, routePattern);
  const now = input.revision.capturedAt ?? new Date().toISOString();
  const revisionId = input.revision.id?.trim() || createRevisionId();
  const incoming: PageArchiveRevision = {
    id: revisionId,
    capturedAt: now,
    envKey: input.envKey,
    routePattern,
    states: input.revision.states
  };
  const existingMeta = await readArchiveMetaIfPresent(projectKey, archiveId);
  const current = existingMeta
    ? await readRevision(projectKey, archiveId, existingMeta.currentRevisionId)
    : undefined;
  const revision = current ? mergePageArchiveRevision(current, incoming) : incoming;
  const revisionDir = getRevisionDir(projectKey, archiveId, revision.id);

  await ensureDir(revisionDir);
  if (input.evidenceDir && existsSync(input.evidenceDir)) {
    await copyEvidence(input.evidenceDir, join(revisionDir, 'evidence'), revision);
  }
  await writeJson(join(revisionDir, 'archive.json'), revision);

  const previousRevisionId = existingMeta?.currentRevisionId;
  const meta: PageArchive = {
    id: archiveId,
    envKey: input.envKey,
    routePattern,
    title: input.title ?? existingMeta?.title ?? routePattern,
    status: 'ready',
    currentRevisionId: revision.id,
    ...(previousRevisionId && previousRevisionId !== revision.id ? { previousRevisionId } : {}),
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(join(getPageArchivePath(projectKey, archiveId), 'meta.json'), meta);
  await deleteRetiredRevisions(projectKey, archiveId, meta);

  return getPageArchive(projectKey, archiveId);
}

/**
 * 把档案标为刷新中，供后台刷新作业立即返回。
 */
export async function markPageArchiveRefreshing(projectKey: string, archiveId: string): Promise<PageArchiveDetail> {
  const meta = await readArchiveMeta(projectKey, archiveId);
  const next: PageArchive = {
    ...meta,
    status: 'refreshing',
    updatedAt: new Date().toISOString()
  };
  delete next.refreshFailure;
  await writeJson(join(getPageArchivePath(projectKey, archiveId), 'meta.json'), next);
  return getPageArchive(projectKey, archiveId);
}

/**
 * 刷新失败时保留 current/previous，只记录失败诊断。
 */
export async function markPageArchiveRefreshFailed(
  projectKey: string,
  archiveId: string,
  message: string
): Promise<PageArchiveDetail> {
  const meta = await readArchiveMeta(projectKey, archiveId);
  const failure: PageArchiveFailure = { message, at: new Date().toISOString() };
  const next: PageArchive = {
    ...meta,
    status: 'failed',
    refreshFailure: failure,
    updatedAt: failure.at
  };
  await writeJson(join(getPageArchivePath(projectKey, archiveId), 'meta.json'), next);
  return getPageArchive(projectKey, archiveId);
}

/**
 * 删除页面档案目录，不修改已有测试计划和测试代码。
 */
export async function deletePageArchive(projectKey: string, archiveId: string): Promise<void> {
  await getProject(projectKey);
  const path = getPageArchivePath(projectKey, archiveId);

  if (!existsSync(join(path, 'meta.json'))) {
    throw notFound('页面档案不存在');
  }

  await rm(path, { recursive: true, force: true });
}

/**
 * 读取档案刷新工作目录。
 */
export function getPageArchiveWorkPath(projectKey: string, archiveId: string) {
  return join(getPageArchivePath(projectKey, archiveId), 'work');
}

/**
 * 读取档案刷新诊断目录。
 */
export function getPageArchiveDiagnosticsPath(projectKey: string, archiveId: string) {
  return join(getPageArchivePath(projectKey, archiveId), 'diagnostics');
}

/**
 * 读取档案元数据；目录或文件缺失时视为不存在。
 */
async function readArchiveMeta(projectKey: string, archiveId: string): Promise<PageArchive> {
  const meta = await readArchiveMetaIfPresent(projectKey, archiveId);

  if (!meta) {
    throw notFound('页面档案不存在');
  }

  return meta;
}

/**
 * 尝试读取档案元数据。
 */
async function readArchiveMetaIfPresent(projectKey: string, archiveId: string): Promise<PageArchive | undefined> {
  const metaPath = join(getPageArchivePath(projectKey, archiveId), 'meta.json');

  if (!existsSync(metaPath)) {
    return undefined;
  }

  return readJson<PageArchive>(metaPath);
}

/**
 * 读取一份不可变版本。
 */
async function readRevision(projectKey: string, archiveId: string, revisionId: string): Promise<PageArchiveRevision> {
  return readJson<PageArchiveRevision>(join(getRevisionDir(projectKey, archiveId, revisionId), 'archive.json'));
}

/**
 * 获取版本目录。
 */
function getRevisionDir(projectKey: string, archiveId: string, revisionId: string) {
  return join(getPageArchivePath(projectKey, archiveId), 'revisions', revisionId);
}

/**
 * 只保留 current 和 previous，删除更早版本目录。
 */
async function deleteRetiredRevisions(projectKey: string, archiveId: string, meta: PageArchive) {
  const revisionsRoot = join(getPageArchivePath(projectKey, archiveId), 'revisions');

  if (!existsSync(revisionsRoot)) {
    return;
  }

  const keep = new Set([meta.currentRevisionId, meta.previousRevisionId].filter(Boolean) as string[]);
  const names = await readdir(revisionsRoot);

  for (const name of names) {
    if (!keep.has(name)) {
      await rm(join(revisionsRoot, name), { recursive: true, force: true });
    }
  }
}

/**
 * 把探索证据复制进版本目录，并在默认状态上记录相对路径和内容摘要。
 */
async function copyEvidence(fromDir: string, toDir: string, revision: PageArchiveRevision) {
  await ensureDir(toDir);
  await cp(fromDir, toDir, { recursive: true });
  const files = await readdir(toDir, { recursive: true });
  const snapshot = files.find((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

  if (!snapshot || !revision.states[0]) {
    return;
  }

  const snapshotPath = `evidence/${snapshot.replaceAll('\\', '/')}`;
  revision.states[0].snapshotPath = snapshotPath;
  const content = await readFile(join(toDir, snapshot));
  revision.states[0].snapshotHash = createHash('sha256').update(content).digest('hex');
}

/**
 * 生成不可变版本标识。
 */
function createRevisionId() {
  const now = new Date();
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `rev-${date}-${time}-${randomBytes(2).toString('hex')}`;
}

/**
 * 将数字补齐为两位。
 */
function pad(value: number) {
  return String(value).padStart(2, '0');
}
