import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { createCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { createRun } from '../../server/src/lib/run-store';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-runs-api-'));
  process.env.DATA_ROOT = root;
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('运行报告接口', () => {
  it('可以通过接口打开 Playwright HTML 报告首页', async () => {
    const app = createApp();
    const run = await createRun('crm', 'default');
    const reportDir = join(root, 'projects', 'crm', 'runs', run.id, 'html-report');
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, 'index.html'), '<html><body>报告</body></html>', 'utf8');

    const res = await request(app).get(`/api/projects/crm/runs/${run.id}/report/`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('报告');
  });

  it('运行失败时返回简短失败信息和报告入口', async () => {
    const app = createApp();
    await createProject({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await createCase('crm', {
      name: '创建订单',
      startPath: '/orders/create'
    });
    spawnMock.mockReturnValue({
      stdout: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('  1) [chromium] › data\\projects\\crm\\cases\\case-1\\case.spec.ts:3:1 › 创建订单\n'));
            callback(Buffer.from('    Error: expect(locator).toBeVisible failed\n'));
          }
        }
      },
      stderr: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('Timeout 1000ms exceeded\n'));
          }
        }
      },
      on(event: string, callback: (code: number) => void) {
        if (event === 'exit') {
          callback(1);
        }
      }
    });

    const res = await request(app).post('/api/projects/crm/runs').send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('用例“创建订单”在断言可见阶段失败：元素在 1000ms 内没有变为可见');
    expect(res.body.reportUrl).toMatch(/^\/api\/projects\/crm\/runs\/\d+\/report\/$/);
  });
});
