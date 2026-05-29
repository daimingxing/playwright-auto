import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAiImport,
  deleteImport,
  listImportItems,
  retryImportItem,
  saveImportItems,
  skipImportItem
} from '../../web/src/api/imports';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI 导入前端 API', () => {
  it('上传 Excel 使用 FormData 且不设置 JSON 请求头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ importId: 'import-20260526-120000-ab12' }));
    vi.stubGlobal('fetch', fetchMock);

    await createAiImport('crm', new File(['demo'], 'cases.xlsx'), { envKey: 'default', uiLibrary: 'kendo' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('envKey')).toBe('default');
    expect((init.body as FormData).get('uiLibrary')).toBe('kendo');
    expect(init.headers).toEqual({});
  });

  it('保存导入项时发送选中项列表', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ saved: [], failed: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await saveImportItems('crm', 'import-1', ['item-1', 'item-2']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/projects/crm/imports/import-1/save');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ itemIds: ['item-1', 'item-2'] }));
  });

  it('封装导入项列表、重试和跳过接口', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await listImportItems('crm', 'import-1');
    await retryImportItem('crm', 'import-1', 'item-1');
    await skipImportItem('crm', 'import-1', 'item-2');
    await deleteImport('crm', 'import-1');

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ['/api/projects/crm/imports/import-1/items', undefined],
      ['/api/projects/crm/imports/import-1/items/item-1/retry', 'POST'],
      ['/api/projects/crm/imports/import-1/items/item-2/skip', 'POST'],
      ['/api/projects/crm/imports/import-1', 'DELETE']
    ]);
  });
});

/**
 * 创建 fetch 响应替身。
 */
function makeResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data)
  };
}
