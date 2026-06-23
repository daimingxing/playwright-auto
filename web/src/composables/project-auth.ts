import { ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { EnvMeta } from '../../../shared/types';
import { getAuthState, saveLogin, startLogin } from '../api/auth';
import { setProjectEnv } from '../state/project-env';
import { getErrorMessage } from '../utils/error';

export interface ProjectAuthOptions {
  /** 当前项目标识。 */
  projectKey: string;
  /** 项目环境列表。 */
  envs: Ref<EnvMeta[]>;
  /** 当前生效环境。 */
  activeEnv: Ref<EnvMeta | null>;
  /** 页面上选中的环境标识。 */
  selectedEnv: Ref<string>;
  /** 保存登录态成功后的提示文案。 */
  savedMessage: string;
}

/**
 * 管理项目级环境登录态。
 */
export function useProjectAuth(options: ProjectAuthOptions) {
  const hasAuth = ref(false);
  const authPath = ref('');
  const sessionId = ref('');
  const loading = ref(false);
  const saving = ref(false);

  /**
   * 加载当前环境登录态。
   */
  async function loadAuthState() {
    if (!options.activeEnv.value) {
      hasAuth.value = false;
      authPath.value = '';
      return;
    }

    const state = await getAuthState(options.projectKey, options.activeEnv.value.key);
    hasAuth.value = state.exists;
    authPath.value = state.path;
  }

  /**
   * 切换项目当前环境并刷新登录态状态。
   */
  async function changeEnv() {
    const nextEnv = options.envs.value.find((env) => env.key === options.selectedEnv.value) ?? null;
    options.activeEnv.value = nextEnv;
    sessionId.value = '';

    if (nextEnv) {
      setProjectEnv(options.projectKey, nextEnv.key);
    }

    await loadAuthState();
  }

  /**
   * 打开浏览器创建手动登录会话。
   */
  async function openLogin() {
    if (!options.activeEnv.value) {
      ElMessage.warning('请先配置项目环境');
      return;
    }

    loading.value = true;

    try {
      const session = await startLogin(options.projectKey, { envKey: options.activeEnv.value.key });
      sessionId.value = session.sessionId;

      if (session.warning) {
        ElMessage.warning(session.warning);
        return;
      }

      ElMessage.success('已打开浏览器，请完成登录后返回本页面保存登录态');
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    } finally {
      loading.value = false;
    }
  }

  /**
   * 保存当前浏览器会话的登录态。
   */
  async function saveAuth() {
    if (!sessionId.value) {
      ElMessage.warning('请先打开浏览器完成登录');
      return;
    }

    saving.value = true;

    try {
      const auth = await saveLogin(options.projectKey, sessionId.value);
      authPath.value = auth.path;
      hasAuth.value = true;
      sessionId.value = '';
      ElMessage.success(options.savedMessage);
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  return {
    hasAuth,
    authPath,
    sessionId,
    loading,
    saving,
    loadAuthState,
    changeEnv,
    openLogin,
    saveAuth
  };
}
