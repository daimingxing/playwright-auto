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
    const error = new Error(data.message ?? '请求失败');
    Object.assign(error, data);
    throw error;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * 下载本地 API 文件。
 */
export async function downloadFile(url: string, fileName: string) {
  const res = await fetch(resolveApiUrl(url));

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: '下载失败' }));
    throw new Error(data.message ?? '下载失败');
  }

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = href;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(href);
}

/**
 * 解析本地 API 地址。
 */
export function resolveApiUrl(url: string, apiBase = import.meta.env.VITE_API_BASE ?? '') {
  if (/^https?:\/\//.test(url)) {
    return url;
  }

  if (url.startsWith('/api') || url === '/health') {
    return apiBase ? `${apiBase.replace(/\/$/, '')}${url}` : url;
  }

  return url;
}
