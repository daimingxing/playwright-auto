import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProjectAsset, hashBuffer, putProjectAsset } from '../../server/src/lib/asset-store';
import { getAssetsPath } from '../../server/src/lib/path';
import { createProject } from '../../server/src/lib/project-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-asset-'));
  process.env.DATA_ROOT = root;
  await createProject({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('项目测试资产库', () => {
  it('相同 SHA-256 内容只保存一份且保留首次写入时间', async () => {
    const buffer = Buffer.from('same-bytes');
    const first = await putProjectAsset('crm', buffer);
    const second = await putProjectAsset('crm', buffer);

    expect(first.id).toBe(hashBuffer(buffer));
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await readdir(getAssetsPath('crm'))).toEqual([first.id]);
    expect(await readFile(join(getAssetsPath('crm'), first.id, 'content'))).toEqual(buffer);
    expect(await getProjectAsset('crm', first.id)).toMatchObject({
      id: first.id,
      hash: first.hash,
      byteSize: buffer.length
    });
  });

  it('不同内容写入不同目录且互不覆盖', async () => {
    const left = await putProjectAsset('crm', Buffer.from('alpha'));
    const right = await putProjectAsset('crm', Buffer.from('beta'));

    expect(right.id).not.toBe(left.id);
    expect(await readFile(join(getAssetsPath('crm'), left.id, 'content'), 'utf8')).toBe('alpha');
    expect(await readFile(join(getAssetsPath('crm'), right.id, 'content'), 'utf8')).toBe('beta');
    expect((await readdir(getAssetsPath('crm'))).sort()).toEqual([left.id, right.id].sort());
  });

  it('摘要目录内已有不同字节时拒绝覆盖', async () => {
    const buffer = Buffer.from('keep-me');
    const asset = await putProjectAsset('crm', buffer);
    await writeFile(join(getAssetsPath('crm'), asset.id, 'content'), Buffer.from('tampered'));

    await expect(putProjectAsset('crm', buffer)).rejects.toThrow('资产内容与摘要不一致');
    expect(await readFile(join(getAssetsPath('crm'), asset.id, 'content'), 'utf8')).toBe('tampered');
  });
});
