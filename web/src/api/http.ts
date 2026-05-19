/**
 * 发送本地 API 请求。
 */
export async function requestJson<T>(url: string, init?: RequestInit) {
  const res = await fetch(resolveApiUrl(url), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    }
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: '请求失败' }));
    throw new Error(data.message ?? '请求失败');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * 解析本地 API 地址。
 */
export function resolveApiUrl(url: string) {
  if (/^https?:\/\//.test(url)) {
    return url;
  }

  if (url.startsWith('/api') || url === '/health') {
    return `http://localhost:3001${url}`;
  }

  return url;
}
