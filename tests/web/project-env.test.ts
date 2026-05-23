import { describe, expect, it } from 'vitest';
import type { ProjectMeta } from '../../shared/types';
import { getProjectEnv, setProjectEnv } from '../../web/src/state/project-env';

describe('项目级环境选择状态', () => {
  it('没有本地选择时使用项目默认环境', () => {
    const project = makeProject();
    const storage = makeStorage();

    expect(getProjectEnv(project, storage)?.key).toBe('default');
  });

  it('有本地选择且环境仍存在时使用本地选择', () => {
    const project = makeProject();
    const storage = makeStorage();

    setProjectEnv('crm', 'pre', storage);

    expect(getProjectEnv(project, storage)?.key).toBe('pre');
  });

  it('本地选择已不存在时回退到项目默认环境', () => {
    const project = makeProject();
    const storage = makeStorage();

    setProjectEnv('crm', 'missing', storage);

    expect(getProjectEnv(project, storage)?.key).toBe('default');
  });
});

/**
 * 创建项目环境状态测试数据。
 */
function makeProject(): ProjectMeta {
  return {
    name: 'CRM 系统',
    key: 'crm',
    defaultEnv: 'default',
    envs: [
      {
        name: '默认名称',
        key: 'default',
        baseUrl: 'https://crm.test.local'
      },
      {
        name: '预发环境',
        key: 'pre',
        baseUrl: 'https://pre.test.local'
      }
    ],
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z'
  };
}

/**
 * 创建测试用本地存储。
 */
function makeStorage() {
  const data = new Map<string, string>();

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    }
  };
}
