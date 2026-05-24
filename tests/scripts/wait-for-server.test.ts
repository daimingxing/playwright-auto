import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHealthUrl } from '../../scripts/wait-for-server';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-wait-'));
});

afterEach(async () => {
  delete process.env.PORT;
  await rm(root, { recursive: true, force: true });
});

describe('开发服务健康检查等待脚本', () => {
  it('优先使用环境变量端口生成健康检查地址', () => {
    process.env.PORT = '3100';

    expect(getHealthUrl(join(root, 'missing.json'))).toBe('http://localhost:3100/health');
  });

  it('从项目配置文件读取服务端口生成健康检查地址', async () => {
    const configPath = join(root, 'playwright-auto.config.json');
    await writeFile(configPath, JSON.stringify({ server: { port: 3200 } }), 'utf8');

    expect(getHealthUrl(configPath)).toBe('http://localhost:3200/health');
  });
});
