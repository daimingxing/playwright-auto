import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from '../../web/src/api/http';

describe('前端 API 地址', () => {
  it('开发环境下把 API 请求指向本地 Node 服务', () => {
    const url = resolveApiUrl('/api/projects');

    expect(url).toBe('http://localhost:3001/api/projects');
  });

  it('外部地址保持不变', () => {
    const url = resolveApiUrl('https://example.com/api');

    expect(url).toBe('https://example.com/api');
  });
});
