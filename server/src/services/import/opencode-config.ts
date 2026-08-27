import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, AgentProtocol, AgentReasoningEffort } from '../../../../shared/types';
import { getChromePath } from '../playwright/vendor-browser';

export const DENIED_MCP_TOOLS = [
  'playwright_browser_evaluate',
  'playwright_browser_run_code',
  'playwright_browser_run_code_unsafe',
  'playwright_browser_storage_state',
  'playwright_browser_set_storage_state',
  'playwright_browser_cookie_list',
  'playwright_browser_cookie_get',
  'playwright_browser_cookie_set',
  'playwright_browser_cookie_delete',
  'playwright_browser_cookie_clear'
] as const;

export const ALLOWED_MCP_TOOLS = [
  'playwright_browser_navigate',
  'playwright_browser_snapshot',
  'playwright_browser_click',
  'playwright_browser_type',
  'playwright_browser_fill_form',
  'playwright_browser_select_option',
  'playwright_browser_press_key',
  'playwright_browser_hover',
  'playwright_browser_wait_for',
  'playwright_browser_take_screenshot',
  'playwright_browser_generate_locator',
  'playwright_browser_verify_element_visible',
  'playwright_browser_verify_text_visible',
  'playwright_browser_tabs',
  'playwright_browser_close',
  'playwright_browser_handle_dialog'
] as const;

export interface OpenCodeLaunchConfig {
  protocol: AgentProtocol;
  provider: string;
  model: string;
  baseUrl: string;
  opencodePath: string;
  playwrightMcpPath: string;
  workDir: string;
  userDataDir: string;
  mcpOutputDir: string;
  storageStatePath?: string;
  allowedOrigin?: string;
  executablePath?: string;
  contextLimit?: number;
  outputLimit?: number;
  reasoningEffort?: AgentReasoningEffort;
}

/**
 * 解析 OpenCode 二进制路径：配置、环境变量，或 PATH 中的 opencode。
 */
export function resolveOpenCodePath(config: Pick<AgentConfig, 'opencodePath'>): string | null {
  const candidates = [
    config.opencodePath,
    process.env.OPENCODE_BIN,
    process.env.PLAYWRIGHT_AUTO_OPENCODE
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 解析官方 Playwright MCP CLI，禁止回退到 npx。
 */
export function resolvePlaywrightMcpPath(config: Pick<AgentConfig, 'playwrightMcpPath'>): string | null {
  const candidates = [
    config.playwrightMcpPath,
    process.env.PLAYWRIGHT_MCP_CLI,
    join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js')
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 构造本次探索的 OpenCode 运行配置：一种协议、官方 MCP、无 Shell / evaluate。
 */
export function buildOpenCodeConfigContent(input: OpenCodeLaunchConfig) {
  const npm = input.protocol === 'responses' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible';
  const permission: Record<string, unknown> = {
    '*': 'deny',
    read: {
      '*': 'allow',
      '*.env': 'deny',
      '*.env.*': 'deny'
    },
    glob: 'allow',
    grep: 'allow',
    edit: 'deny',
    bash: 'deny',
    external_directory: 'deny'
  };

  for (const tool of ALLOWED_MCP_TOOLS) {
    permission[tool] = 'allow';
  }

  for (const tool of DENIED_MCP_TOOLS) {
    permission[tool] = 'deny';
  }

  return {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    snapshot: false,
    enabled_providers: [input.provider],
    provider: {
      [input.provider]: {
        npm,
        name: 'Company Model',
        options: {
          baseURL: '{env:AI_BASE_URL}',
          apiKey: '{env:AI_API_KEY}'
        },
        models: {
          [input.model]: buildOpenCodeModelEntry(input)
        }
      }
    },
    mcp: {
      playwright: {
        type: 'local',
        command: buildPlaywrightMcpCommand(input),
        cwd: input.workDir,
        enabled: true
      }
    },
    permission
  };
}

/**
 * 按 OpenCode 自定义模型规则组装 models 条目。
 * 未填的窗口和思考档位不写入，避免覆盖模型服务默认；只填 context 时 output 与之相同。
 */
export function buildOpenCodeModelEntry(input: Pick<OpenCodeLaunchConfig, 'model' | 'contextLimit' | 'outputLimit' | 'reasoningEffort'>) {
  const entry: {
    name: string;
    limit?: { context: number; output: number };
    options?: { reasoningEffort: Exclude<AgentReasoningEffort, ''> };
  } = {
    name: input.model
  };
  const contextLimit = input.contextLimit ?? 0;
  const outputLimit = input.outputLimit ?? 0;

  if (contextLimit > 0) {
    entry.limit = {
      context: contextLimit,
      output: outputLimit > 0 ? outputLimit : contextLimit
    };
  }

  if (input.reasoningEffort) {
    entry.options = { reasoningEffort: input.reasoningEffort };
  }

  return entry;
}

/**
 * 用绝对 Node 路径启动官方 MCP，注入登录态和隔离目录，不使用 npx。
 */
export function buildPlaywrightMcpCommand(input: OpenCodeLaunchConfig) {
  const command = [
    process.execPath,
    input.playwrightMcpPath,
    '--headless',
    '--isolated',
    `--user-data-dir=${input.userDataDir}`,
    `--output-dir=${input.mcpOutputDir}`
  ];
  const executablePath = input.executablePath ?? (existsSync(getChromePath()) ? getChromePath() : undefined);

  if (executablePath) {
    command.push(`--executable-path=${executablePath}`);
  }

  if (input.storageStatePath) {
    command.push(`--storage-state=${input.storageStatePath}`);
  }

  if (input.allowedOrigin) {
    command.push(`--allowed-origins=${input.allowedOrigin}`);
  }

  return command;
}

/**
 * 构造 `opencode --pure run` 参数，不拼接 shell 字符串。
 */
export function buildOpenCodeArgs(input: {
  workDir: string;
  provider: string;
  model: string;
  title: string;
}) {
  return [
    '--pure',
    '--print-logs',
    '--log-level',
    'INFO',
    'run',
    '--format',
    'json',
    '--dir',
    input.workDir,
    '--model',
    `${input.provider}/${input.model}`,
    '--title',
    input.title
  ];
}

/**
 * 构造给 OpenCode 子进程的干净环境。
 * 凭据只作为子进程环境变量注入；`AI_API_KEY` 优先读进程环境，否则用调用方从本地配置传入的值。
 */
export function buildOpenCodeEnv(configContent: string, extra: Record<string, string | undefined> = {}) {
  const allow = [
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'PLAYWRIGHT_BROWSERS_PATH'
  ];
  const env: Record<string, string> = {};

  for (const key of allow) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  env.OPENCODE_CONFIG_CONTENT = configContent;
  env.AI_API_KEY = process.env.AI_API_KEY || extra.AI_API_KEY || '';
  env.AI_BASE_URL = extra.AI_BASE_URL || process.env.AI_BASE_URL || extra.baseUrl || '';

  for (const [key, value] of Object.entries(extra)) {
    if (value && key !== 'baseUrl' && key !== 'AI_API_KEY' && key !== 'AI_BASE_URL') {
      env[key] = value;
    }
  }

  return env;
}
