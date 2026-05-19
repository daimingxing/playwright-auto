import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
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

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(runPath, false);
    archive.finalize().catch(reject);
  });

  return zipPath;
}
