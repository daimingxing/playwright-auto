import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDir } from '../lib/fs';
import { getRunPath } from '../lib/path';

/**
 * 导出单次运行目录为压缩包。
 */
export async function exportRun(projectKey: string, runId: string) {
  const runPath = getRunPath(projectKey, runId);
  const zipPath = join(runPath, 'artifacts.zip');

  await ensureDir(runPath);
  await createZip(runPath, zipPath);

  return zipPath;
}

/**
 * 将目录压缩成临时 zip 文件。
 */
export async function zipDir(sourcePath: string, name: string) {
  const tempPath = await mkdtemp(join(tmpdir(), 'playwright-auto-export-'));
  const zipPath = join(tempPath, `${name}.zip`);

  await createZip(sourcePath, zipPath);

  return {
    zipPath,
    dispose: () => rm(tempPath, { recursive: true, force: true })
  };
}

/**
 * 压缩指定目录到 zip 文件。
 */
async function createZip(sourcePath: string, zipPath: string) {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize().catch(reject);
  });
}
