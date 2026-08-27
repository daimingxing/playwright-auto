import { describe, expect, it } from 'vitest';
import { summarizeImportFailure } from '../../shared/import-failure';

describe('导入失败说明', () => {
  it('把 OpenCode 过程日志收成短摘要', () => {
    const dump = [
      'timestamp=2026-08-27T08:33:47.383Z level=WARN message="server unavailable" key=playwright status=failed',
      'timestamp=2026-08-27T08:33:52.262Z level=ERROR message="stream error" error.error="AI_APICallError: Cannot connect to API: The socket connection was closed unexpectedly."'
    ].join('\n');

    expect(summarizeImportFailure('process-failed', dump)).toBe('模型服务连接中断，请稍后重试');
    expect(summarizeImportFailure('process-failed', 'timestamp=2026-08-27T08:33:47.383Z level=WARN message="server unavailable" key=playwright type=local status=failed')).toBe(
      'Playwright 浏览器服务未能启动，无法探索页面'
    );
    expect(summarizeImportFailure('timeout', dump)).toBe('页面探索超时');
    expect(summarizeImportFailure('explore-failed', '当前会话未提供 Playwright MCP 浏览器工具，无法打开或观察目标页面')).toBe(
      'Playwright 浏览器服务未能启动，无法探索页面'
    );
    expect(summarizeImportFailure('process-failed', '未找到官方 Playwright MCP，无法启动页面探索')).toBe(
      '未找到官方 Playwright MCP，无法启动页面探索'
    );
  });
});
