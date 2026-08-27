import type { ImportAgentFailureKind } from './types';

const FAILURE_MESSAGES: Record<ImportAgentFailureKind, string> = {
  'login-blocked': '探索被登录态阻塞，请更新项目登录态后重试',
  'explore-failed': '页面探索失败，无法生成测试意图',
  'locator-failed': '未能定位到所需页面目标',
  cancelled: '页面探索已取消',
  timeout: '页面探索超时',
  'process-failed': 'OpenCode 进程失败，无法完成页面探索',
  'model-failed': '模型调用失败，无法完成页面探索'
};

const MAX_USER_MESSAGE = 80;

/**
 * 把探索失败整理成页面可见的短说明。完整日志只留在诊断目录。
 */
export function summarizeImportFailure(kind: ImportAgentFailureKind, detail = '') {
  const raw = detail.trim();

  if (kind === 'timeout') {
    if (raw && raw.length <= MAX_USER_MESSAGE && !isProcessDump(raw)) {
      return raw;
    }

    return FAILURE_MESSAGES.timeout;
  }

  if (/Cannot connect to API|socket connection was closed|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return '模型服务连接中断，请稍后重试';
  }

  if (
    (/server unavailable/i.test(raw) && /playwright/i.test(raw)) ||
    /未提供 Playwright MCP/.test(raw) ||
    /无法打开或观察目标页面/.test(raw)
  ) {
    return 'Playwright 浏览器服务未能启动，无法探索页面';
  }

  if (isProcessDump(raw)) {
    return FAILURE_MESSAGES[kind];
  }

  if (raw && raw.length <= MAX_USER_MESSAGE) {
    return raw;
  }

  return FAILURE_MESSAGES[kind];
}

/**
 * 判断文本是否为 OpenCode 过程日志，而不是给用户看的说明。
 */
function isProcessDump(raw: string) {
  return /timestamp=/.test(raw) || /level=(INFO|ERROR|WARN)/.test(raw) || raw.includes('\n');
}
