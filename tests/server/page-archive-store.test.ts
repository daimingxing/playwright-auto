import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPageArchiveId, toRoutePattern } from '../../shared/page-archive';
import type { PageArchiveRevision, VerifiedLocator } from '../../shared/types';
import { readJson } from '../../server/src/lib/fs';
import {
  deletePageArchive,
  getPageArchive,
  markPageArchiveRefreshFailed,
  publishPageArchive,
  readCurrentPageArchiveRevision
} from '../../server/src/lib/page-archive-store';
import { createCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-page-archive-'));
  process.env.DATA_ROOT = root;
  await createProject({ name: 'CRM 系统', key: 'crm', baseUrl: 'https://crm.test.local' });
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('页面档案版本替换', () => {
  it('成功发布采用原子替换：current 换成新版本并保留 previous', async () => {
    const first = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('提交')])
    });
    const second = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('保存')])
    });

    expect(second.id).toBe(first.id);
    expect(second.currentRevisionId).not.toBe(first.currentRevisionId);
    expect(second.previousRevisionId).toBe(first.currentRevisionId);
    expect(second.current.states[0]?.targets[0]?.locator.selector).toContain('保存');
    expect(second.previous?.id).toBe(first.currentRevisionId);
    expect(existsSync(join(root, 'projects', 'crm', 'page-archives', first.id, 'revisions', first.currentRevisionId, 'archive.json'))).toBe(
      true
    );
  });

  it('第三次发布后删除更早版本，只保留 current 和 previous', async () => {
    const first = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('一')])
    });
    await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('二')])
    });
    const third = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('三')])
    });

    const revisions = await readdir(join(root, 'projects', 'crm', 'page-archives', first.id, 'revisions'));
    expect(revisions.sort()).toEqual([third.currentRevisionId, third.previousRevisionId].sort());
    expect(revisions).not.toContain(first.currentRevisionId);
  });

  it('刷新失败保留旧档案并记录失败诊断', async () => {
    const published = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('提交')])
    });
    const failed = await markPageArchiveRefreshFailed('crm', published.id, '页面探索失败');

    expect(failed.status).toBe('failed');
    expect(failed.refreshFailure?.message).toBe('页面探索失败');
    expect(failed.currentRevisionId).toBe(published.currentRevisionId);
    expect((await getPageArchive('crm', published.id)).current.states[0]?.targets[0]?.locator.selector).toContain('提交');
  });

  it('删除页面档案不修改已有测试计划', async () => {
    const published = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      revision: makeRevision([makeLocator('提交')])
    });
    const created = await createCase('crm', { name: '创建订单', startPath: '/orders' });
    const casePath = join(root, 'projects', 'crm', 'cases', created.key, 'case.json');
    const before = await readJson<unknown>(casePath);

    await deletePageArchive('crm', published.id);

    expect(existsSync(join(root, 'projects', 'crm', 'page-archives', published.id))).toBe(false);
    expect(await readJson<unknown>(casePath)).toEqual(before);
  });

  it('可按环境和起始路径读到当前档案，查询参数不拆分页面', async () => {
    await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: toRoutePattern('/web/IMQM14'),
      revision: makeRevision([makeLocator('新增')])
    });

    const revision = await readCurrentPageArchiveRevision('crm', 'default', '/web/IMQM14?tab=1');
    expect(revision?.routePattern).toBe('/web/IMQM14');
    expect(createPageArchiveId('default', '/web/IMQM14')).toBe(revision && createPageArchiveId('default', revision.routePattern));
  });

  it('发布时保存探索证据路径和摘要', async () => {
    const evidenceDir = join(root, 'mcp-output');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'page.yml'), 'role: button\n');
    const published = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      evidenceDir,
      revision: makeRevision([makeLocator('提交')])
    });

    expect(published.current.states[0]?.snapshotPath).toBe('evidence/page.yml');
    expect(published.current.states[0]?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(published.current.states[0]?.snapshotHash).not.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('有空快照时引用最新的非空证据，不把空文件当页面证据', async () => {
    const evidenceDir = join(root, 'mcp-output');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'page-2026-08-28T03-17-58-217Z.yml'), '');
    await writeFile(join(evidenceDir, 'page-2026-08-28T03-18-06-425Z.yml'), '- role: button\n  name: 新增\n');
    const published = await publishPageArchive('crm', {
      envKey: 'default',
      routePattern: '/orders',
      evidenceDir,
      revision: makeRevision([makeLocator('提交')])
    });

    expect(published.current.states[0]?.snapshotPath).toBe('evidence/page-2026-08-28T03-18-06-425Z.yml');
    expect(published.current.states[0]?.snapshotHash).not.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

/**
 * 构造只含一个页面目标的版本正文。
 */
function makeRevision(locators: VerifiedLocator[]): Pick<PageArchiveRevision, 'states'> {
  const locator = locators[0];
  return {
    states: [
      {
        id: 'default',
        entrySteps: [{ action: '打开页面', target: '/orders' }],
        targets: locator
          ? [
              {
                key: '点击:提交',
                action: '点击',
                target: '提交',
                meaning: '提交',
                locator
              }
            ]
          : [],
        recipes: locator
          ? [
              {
                id: 'rcp-1',
                fromStateId: 'default',
                toStateId: 'default',
                action: '点击',
                target: '提交',
                locator
              }
            ]
          : [],
        capturedAt: '2026-08-28T00:00:00.000Z'
      }
    ]
  };
}

/**
 * 构造可验证语义定位器。
 */
function makeLocator(text: string): VerifiedLocator {
  return {
    selector: `getByRole('button', { name: '${text}' })`,
    selectorDraft: { mode: 'role', role: 'button', value: { kind: 'text', text }, exact: true }
  };
}
