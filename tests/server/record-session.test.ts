import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, getCase } from '../../server/src/lib/case-store';
import { readJson, writeJson } from '../../server/src/lib/fs';
import { getProjectPath } from '../../server/src/lib/path';
import { addProjectEnv, createProject } from '../../server/src/lib/project-store';
import { createAuthState, getProjectAuthPath } from '../../server/src/services/auth-session';
import { startRecordSession, stopRecordSession } from '../../server/src/services/record-session';
import type { ProjectMeta } from '../../shared/types';

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
  it('录制启动时保留项目地址中的应用路径', async () => {
    await createProject({
      name: '西昌测试',
      key: 'xcmp',
      baseUrl: 'http://xcmpmstest.baowuresources.info/xcmpms-imms-f'
    });
    const item = await createCase('xcmp', { name: '下拉框选择', startPath: '/web/NGBS03' });

    const session = await startRecordSession('xcmp', item.key);

    expect(session.url).toBe('http://xcmpmstest.baowuresources.info/xcmpms-imms-f/web/NGBS03');
  });

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

  it('真实录制启动时使用指定环境地址和登录态', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    await addProjectEnv('crm', {
      name: '预发环境',
      key: 'pre',
      baseUrl: 'https://pre.crm.test.local'
    });
    await createAuthState('crm', { cookies: [], origins: [] }, 'pre');
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

    const session = await startRecordSession('crm', item.key, { envKey: 'pre' });

    expect(session.url).toBe('https://pre.crm.test.local/orders');
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--load-storage', getProjectAuthPath('crm', 'pre'), 'https://pre.crm.test.local/orders']),
      expect.objectContaining({ shell: false })
    );
  });

  it('未指定环境时兼容项目配置中的默认环境', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    await addProjectEnv('crm', {
      name: '预发环境',
      key: 'pre',
      baseUrl: 'https://pre.crm.test.local'
    });
    await setProjectDefaultEnv('crm', 'pre');
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders' });

    const session = await startRecordSession('crm', item.key);

    expect(session.url).toBe('https://pre.crm.test.local/orders');
  });
});

/**
 * 模拟历史项目配置中已经存在的默认环境。
 */
async function setProjectDefaultEnv(projectKey: string, envKey: string) {
  const path = join(getProjectPath(projectKey), 'project.json');
  const project = await readJson<ProjectMeta>(path);

  await writeJson(path, {
    ...project,
    defaultEnv: envKey
  });
}
