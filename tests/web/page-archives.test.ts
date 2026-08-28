import { describe, expect, it } from 'vitest';
import {
  formatPageArchiveStatus,
  formatPageArchiveSummary,
  formatPageTarget,
  getDeletePageArchiveConfirm,
  getRefreshPageArchiveConfirm
} from '../../web/src/pages/page-archives/page-archives';
import type { PageArchive, PageTarget } from '../../shared/types';

describe('页面档案展示文案', () => {
  it('区分可用、刷新中和刷新失败', () => {
    expect(formatPageArchiveStatus('ready')).toEqual({ label: '可用', type: 'success' });
    expect(formatPageArchiveStatus('refreshing')).toEqual({ label: '刷新中', type: 'warning' });
    expect(formatPageArchiveStatus('failed')).toEqual({ label: '刷新失败', type: 'danger' });
  });

  it('删除和刷新说明不影响已有测试计划', () => {
    expect(getDeletePageArchiveConfirm('订单页')).toContain('已发布的测试计划和测试代码不会被修改');
    expect(getRefreshPageArchiveConfirm('订单页')).toContain('失败时继续使用旧版本');
  });

  it('摘要包含路由模式和环境', () => {
    const archive = { routePattern: '/orders', envKey: 'default' } as PageArchive;
    expect(formatPageArchiveSummary(archive, 2)).toBe('/orders（default），2 个页面目标');
    expect(formatPageTarget(makeTarget())).toContain("getByRole('button'");
  });
});

/**
 * 构造展示用的页面目标。
 */
function makeTarget(): PageTarget {
  return {
    key: '点击:提交',
    action: '点击',
    target: '提交',
    meaning: '提交',
    locator: {
      selector: "getByRole('button', { name: '提交' })",
      selectorDraft: { mode: 'role', role: 'button', value: { kind: 'text', text: '提交' }, exact: true }
    }
  };
}
