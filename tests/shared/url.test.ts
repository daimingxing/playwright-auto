import { describe, expect, it } from 'vitest';
import { buildStartUrl } from '../../shared/url';

describe('URL 工具', () => {
  it('把以斜杠开头的起始路径拼到项目地址路径后', () => {
    const url = buildStartUrl('http://xcmpmstest.baowuresources.info/xcmpms-imms-f', '/web/NGBS03');

    expect(url).toBe('http://xcmpmstest.baowuresources.info/xcmpms-imms-f/web/NGBS03');
  });

  it('兼容项目地址和起始路径的多余斜杠', () => {
    const url = buildStartUrl('https://crm.test.local/app///', '///orders/list');

    expect(url).toBe('https://crm.test.local/app/orders/list');
  });

  it('完整地址作为起始路径时直接使用', () => {
    const url = buildStartUrl('https://crm.test.local/app', 'https://other.test.local/orders');

    expect(url).toBe('https://other.test.local/orders');
  });

  it('空根路径返回项目地址本身', () => {
    const url = buildStartUrl('https://crm.test.local/app/', '/');

    expect(url).toBe('https://crm.test.local/app');
  });
});
