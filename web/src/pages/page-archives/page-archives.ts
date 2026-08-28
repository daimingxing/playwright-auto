import type { PageArchive, PageArchiveStatus, PageTarget } from '../../../../shared/types';

/**
 * 页面档案状态展示文案。
 */
export function formatPageArchiveStatus(status: PageArchiveStatus) {
  if (status === 'refreshing') {
    return { label: '刷新中', type: 'warning' as const };
  }

  if (status === 'failed') {
    return { label: '刷新失败', type: 'danger' as const };
  }

  return { label: '可用', type: 'success' as const };
}

/**
 * 列表摘要：路由模式和当前版本页面目标数量。
 */
export function formatPageArchiveSummary(archive: PageArchive, targetCount?: number) {
  const countText = targetCount === undefined ? '' : `，${targetCount} 个页面目标`;
  return `${archive.routePattern}（${archive.envKey}）${countText}`;
}

/**
 * 删除确认文案。强调不改已有测试计划。
 */
export function getDeletePageArchiveConfirm(title: string) {
  return `删除页面档案「${title}」后不能恢复。已发布的测试计划和测试代码不会被修改。`;
}

/**
 * 刷新确认文案。
 */
export function getRefreshPageArchiveConfirm(title: string) {
  return `将重新探索「${title}」的全部已知页面状态。成功后替换当前版本并保留上一份；失败时继续使用旧版本。`;
}

/**
 * 展示页面目标的业务含义和定位器。
 */
export function formatPageTarget(target: PageTarget) {
  return `${target.action}「${target.target}」：${target.locator.selector}`;
}
