import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvMeta } from '../../shared/types';
import { useProjectAuth } from '../../web/src/composables/project-auth';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  startLogin: vi.fn(),
  saveLogin: vi.fn(),
  setProjectEnv: vi.fn(),
  message: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../web/src/api/auth', () => ({
  getAuthState: mocks.getAuthState,
  startLogin: mocks.startLogin,
  saveLogin: mocks.saveLogin
}));

vi.mock('../../web/src/state/project-env', () => ({
  setProjectEnv: mocks.setProjectEnv
}));

vi.mock('element-plus', () => ({
  ElMessage: mocks.message
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('项目登录态组合函数', () => {
  it('切换环境时保存项目环境并重新加载登录态', async () => {
    const activeEnv = ref<EnvMeta | null>(makeEnv('default'));
    const selectedEnv = ref('pre');
    const auth = useProjectAuth({
      projectKey: 'crm',
      envs: ref([makeEnv('default'), makeEnv('pre')]),
      activeEnv,
      selectedEnv,
      savedMessage: '登录态已保存'
    });
    auth.sessionId.value = 'old-session';
    mocks.getAuthState.mockResolvedValue({ exists: true, path: 'auth/pre.storageState.json' });

    await auth.changeEnv();

    expect(activeEnv.value?.key).toBe('pre');
    expect(mocks.setProjectEnv).toHaveBeenCalledWith('crm', 'pre');
    expect(mocks.getAuthState).toHaveBeenCalledWith('crm', 'pre');
    expect(auth.sessionId.value).toBe('');
    expect(auth.hasAuth.value).toBe(true);
    expect(auth.authPath.value).toBe('auth/pre.storageState.json');
  });

  it('登录页自动打开失败时保留登录会话', async () => {
    const auth = useProjectAuth({
      projectKey: 'crm',
      envs: ref([makeEnv('default')]),
      activeEnv: ref(makeEnv('default')),
      selectedEnv: ref('default'),
      savedMessage: '登录态已保存'
    });
    mocks.startLogin.mockResolvedValue({
      sessionId: 'session-slow',
      url: 'https://slow.crm.test.local',
      warning: '浏览器已打开，但目标页面自动打开失败'
    });

    await auth.openLogin();

    expect(mocks.startLogin).toHaveBeenCalledWith('crm', { envKey: 'default' });
    expect(auth.sessionId.value).toBe('session-slow');
    expect(mocks.message.warning).toHaveBeenCalledWith('浏览器已打开，但目标页面自动打开失败');
    expect(mocks.message.success).not.toHaveBeenCalled();
  });
});

/**
 * 创建项目环境测试数据。
 */
function makeEnv(key: string): EnvMeta {
  return {
    key,
    name: `${key}环境`,
    baseUrl: `https://${key}.example.test`
  };
}
