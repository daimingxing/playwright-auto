import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestAsset } from '../../../shared/types';
import { ensureDir, readJson, writeFileAtomic, writeJson } from './fs';
import { conflict } from './http-error';
import { getAssetPath } from './path';
import { getProject } from './project-store';

/**
 * 按 SHA-256 把文件内容写入项目资产库。相同内容只保留一份，不覆盖已有字节。
 */
export async function putProjectAsset(projectKey: string, buffer: Buffer): Promise<TestAsset> {
  await getProject(projectKey);

  const hash = hashBuffer(buffer);
  const dir = getAssetPath(projectKey, hash);
  const contentPath = join(dir, 'content');
  const metaPath = join(dir, 'meta.json');

  if (existsSync(contentPath)) {
    const existing = await readFile(contentPath);
    const existingHash = hashBuffer(existing);

    if (existingHash !== hash) {
      throw conflict('资产内容与摘要不一致');
    }

    if (existsSync(metaPath)) {
      return readJson<TestAsset>(metaPath);
    }
  }

  await ensureDir(dir);
  await writeFileAtomic(contentPath, buffer);

  const meta: TestAsset = existsSync(metaPath)
    ? await readJson<TestAsset>(metaPath)
    : {
        id: hash,
        hash,
        byteSize: buffer.length,
        createdAt: new Date().toISOString()
      };

  if (!existsSync(metaPath)) {
    await writeJson(metaPath, meta);
  }

  return meta;
}

/**
 * 读取项目资产元数据。内容文件必须存在且摘要一致。
 */
export async function getProjectAsset(projectKey: string, assetId: string): Promise<TestAsset> {
  await getProject(projectKey);

  const meta = await readJson<TestAsset>(join(getAssetPath(projectKey, assetId), 'meta.json'));
  const content = await readFile(join(getAssetPath(projectKey, assetId), 'content'));

  if (hashBuffer(content) !== meta.hash) {
    throw conflict('资产内容与摘要不一致');
  }

  return meta;
}

/**
 * 计算缓冲区的 SHA-256 十六进制摘要。
 */
export function hashBuffer(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
