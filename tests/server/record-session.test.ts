import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, getCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { startRecordSession, stopRecordSession } from '../../server/src/services/record-session';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');

  return {
    ...actual,
    spawn: spawnMock
  };
});

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-record-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('录制会话服务', () => {
  it('停止录制后覆盖当前用例步骤', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders' });

    const session = await startRecordSession('crm', item.key);
    const updated = await stopRecordSession('crm', item.key, session.sessionId);
    const saved = await getCase('crm', item.key);

    expect(updated.steps.length).toBeGreaterThan(0);
    expect(saved.steps).toEqual(updated.steps);
    expect(saved.steps.some((step) => step.type === 'assertVisible')).toBe(true);
  });

  it('拒绝停止其他用例的录制会话', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const first = await createCase('crm', { name: '创建订单', startPath: '/orders' });
    const second = await createCase('crm', { name: '查询订单', startPath: '/orders/search' });

    const session = await startRecordSession('crm', first.key);

    await expect(stopRecordSession('crm', second.key, session.sessionId)).rejects.toThrow('录制会话不存在或已结束');
  });

  it('真实录制启动时不通过 shell 包装 codegen 进程', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders' });
    spawnMock.mockReturnValue({
      pid: 1234,
      killed: false,
      exitCode: null,
      stdin: undefined,
      once() {
        return this;
      },
      kill() {
        return true;
      }
    });

    await startRecordSession('crm', item.key);

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['codegen']),
      expect.objectContaining({ shell: false })
    );
  });
});
