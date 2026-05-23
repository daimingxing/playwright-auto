import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson, resolveApiUrl } from '../../web/src/api/http';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('前端 API 地址', () => {
  it('开发环境下把 API 请求指向本地 Node 服务', () => {
    const url = resolveApiUrl('/api/projects');

    expect(url).toBe('http://localhost:3001/api/projects');
  });

  it('外部地址保持不变', () => {
    const url = resolveApiUrl('https://example.com/api');

    expect(url).toBe('https://example.com/api');
  });

  it('请求失败时保留服务端可展示消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'URL 不合法，请输入完整地址' })
      })
    );

    await expect(requestJson('/api/projects')).rejects.toThrow('URL 不合法，请输入完整地址');
  });
});
