import { describe, expect, it } from 'vitest';
import {
  archiveCoversSteps,
  buildPageArchiveRevision,
  createPageArchiveId,
  createPageTargetKey,
  explorationFromArchive,
  mergePageArchiveRevision,
  toRoutePattern
} from '../../shared/page-archive';
import type { IntentStep, PageArchiveRevision, VerifiedLocator } from '../../shared/types';

describe('页面档案路由归并', () => {
  it('去掉查询参数和哈希，并把数字或 UUID 路径段归并为同一页面', () => {
    expect(toRoutePattern('/web/IMQM14?tab=1#top')).toBe('/web/IMQM14');
    expect(toRoutePattern('/orders/123')).toBe('/orders/:id');
    expect(toRoutePattern('/orders/456/edit')).toBe('/orders/:id/edit');
    expect(toRoutePattern('/orders/550e8400-e29b-41d4-a716-446655440000')).toBe('/orders/:id');
    expect(toRoutePattern('https://crm.test.local/web/IMQM14?x=1')).toBe('/web/IMQM14');
  });

  it('同一环境同一路由模式得到同一档案标识，不同环境不合并', () => {
    const pattern = toRoutePattern('/web/IMQM14?x=1');
    expect(createPageArchiveId('default', pattern)).toBe(createPageArchiveId('default', '/web/IMQM14'));
    expect(createPageArchiveId('default', pattern)).not.toBe(createPageArchiveId('staging', pattern));
  });
});

describe('页面档案版本合并与复用', () => {
  it('按动作和目标保存页面目标，并把定位器对齐到另一条用例的步骤', () => {
    const locator = makeLocator('提交');
    const holderSteps = [makeStep('stp-a', '点击', '提交')];
    const waiterSteps = [makeStep('stp-b', '点击', '提交'), makeStep('stp-c', '填写', '名称')];
    const revision = buildPageArchiveRevision({
      revisionId: 'rev-1',
      capturedAt: '2026-08-28T00:00:00.000Z',
      envKey: 'default',
      routePattern: '/orders/create',
      intent: { startPath: '/orders/create', steps: holderSteps },
      exploration: { locators: { 'stp-a': locator }, pageUrl: 'https://crm.test.local/orders/create' }
    });

    expect(revision.states[0]?.targets).toEqual([
      expect.objectContaining({ key: createPageTargetKey('点击', '提交'), target: '提交', locator })
    ]);
    expect(revision.states[0]?.entrySteps).toEqual([{ action: '打开页面', target: '/orders/create' }]);
    expect(archiveCoversSteps(revision, holderSteps)).toBe(true);
    expect(archiveCoversSteps(revision, waiterSteps)).toBe(false);
    expect(explorationFromArchive(revision, waiterSteps).locators).toEqual({ 'stp-b': locator });
  });

  it('增量合并时保留旧目标并用新探索覆盖同键定位器', () => {
    const first = makeRevision('rev-1', [makeTarget('点击', '提交', makeLocator('提交'))]);
    const second = makeRevision('rev-2', [
      makeTarget('点击', '提交', makeLocator('保存')),
      makeTarget('填写', '名称', makeLocator('名称'))
    ]);
    const merged = mergePageArchiveRevision(first, second);
    const keys = merged.states[0]?.targets.map((item) => item.key);

    expect(merged.id).toBe('rev-2');
    expect(keys).toEqual([createPageTargetKey('点击', '提交'), createPageTargetKey('填写', '名称')]);
    expect(merged.states[0]?.targets[0]?.locator.selector).toContain('保存');
  });
});

/**
 * 构造一条意图步骤，供归并和复用测试使用。
 */
function makeStep(id: string, action: IntentStep['action'], target: string): IntentStep {
  return {
    id,
    action,
    target,
    data: '',
    note: '',
    sourceRefs: [{ sheet: '步骤', row: 2, caseNumber: 'TC-001', cells: {} }]
  };
}

/**
 * 构造可验证的语义定位器。
 */
function makeLocator(text: string): VerifiedLocator {
  return {
    selector: `getByRole('button', { name: '${text}' })`,
    selectorDraft: { mode: 'role', role: 'button', value: { kind: 'text', text }, exact: true }
  };
}

/**
 * 构造只含默认状态的档案版本。
 */
function makeRevision(id: string, targets: PageArchiveRevision['states'][0]['targets']): PageArchiveRevision {
  return {
    id,
    capturedAt: '2026-08-28T00:00:00.000Z',
    envKey: 'default',
    routePattern: '/orders',
    states: [
      {
        id: 'default',
        entrySteps: [{ action: '打开页面', target: '/orders' }],
        targets,
        recipes: [],
        capturedAt: '2026-08-28T00:00:00.000Z'
      }
    ]
  };
}

/**
 * 构造页面目标。
 */
function makeTarget(
  action: IntentStep['action'],
  target: string,
  locator: VerifiedLocator
): PageArchiveRevision['states'][0]['targets'][0] {
  return {
    key: createPageTargetKey(action, target),
    action,
    target,
    meaning: target,
    locator
  };
}
