import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfig, ExplorationResult, ImportAgentFailureKind, ImportTaskCase, TestIntent } from '../../../../shared/types';
import { summarizeImportFailure } from '../../../../shared/import-failure';
import { buildStartUrl } from '../../../../shared/url';
import { getAppConfig } from '../../lib/app-config';
import { ensureDir, writeJson } from '../../lib/fs';
import { getVendorEnv } from '../playwright/vendor-browser';
import {
  applyAmbiguityPending,
  toTestIntent,
  type AgentRunInput,
  type AgentRunner,
  type AgentRunResult,
  createFakeAgentRunner
} from './agent-runner';
import {
  buildOpenCodeArgs,
  buildOpenCodeConfigContent,
  buildOpenCodeEnv,
  resolveOpenCodePath,
  resolvePlaywrightMcpPath
} from './opencode-config';
import { extractCandidateJson, readJsonlError, runOpenCodeProcess, type SpawnFn } from './opencode-process';
import { assignLocatorsByOrder, isVerifiedLocator } from './verified-locator';

const FAILURE_MESSAGES: Record<ImportAgentFailureKind, string> = {
  'login-blocked': '探索被登录态阻塞，请更新项目登录态后重试',
  'explore-failed': '页面探索失败，无法生成测试意图',
  'locator-failed': '未能定位到所需页面目标',
  cancelled: '页面探索已取消',
  timeout: '页面探索超时',
  'process-failed': 'OpenCode 进程失败，无法完成页面探索',
  'model-failed': '模型调用失败，无法完成页面探索'
};

export interface OpenCodeRunnerOptions {
  config?: Partial<AgentConfig>;
  spawn?: SpawnFn;
  resolveOpenCodePath?: (config: AgentConfig) => string | null;
  resolveMcpPath?: (config: AgentConfig) => string | null;
}

/**
 * 创建生产默认 AgentRunner：OpenCode；测试可通过环境变量改回 Fake。
 */
export function createDefaultAgentRunner(): AgentRunner {
  if (process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER === 'fake') {
    return createFakeAgentRunner();
  }

  return createOpenCodeAgentRunner();
}

/**
 * 创建 OpenCode + 官方 Playwright MCP 的 AgentRunner。
 */
export function createOpenCodeAgentRunner(options: OpenCodeRunnerOptions = {}): AgentRunner {
  return new OpenCodeAgentRunner(options);
}

/**
 * 在隔离进程中启动 OpenCode 与 Playwright MCP，完成单次页面探索。
 */
export class OpenCodeAgentRunner implements AgentRunner {
  constructor(private readonly options: OpenCodeRunnerOptions = {}) {}

  /**
   * 注入目标 URL 与登录态后探索页面，由宿主校验候选 TestIntent。
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const config = this.readConfig();
    const timeoutMs = input.timeoutMs ?? config.timeoutMs;
    const userDataDir = join(input.workDir, 'user-data');
    const mcpOutputDir = join(input.workDir, 'mcp-output');
    const inputDir = join(input.workDir, 'input');

    await ensureDir(input.workDir);
    await ensureDir(input.outputDir);
    await ensureDir(input.diagnosticsDir);
    await ensureDir(userDataDir);
    await ensureDir(mcpOutputDir);
    await ensureDir(inputDir);

    try {
      if (input.signal?.aborted) {
        return this.fail(input, 'cancelled');
      }

      const opencodePath = (this.options.resolveOpenCodePath ?? resolveOpenCodePath)(config);

      if (!opencodePath) {
        return this.fail(input, 'process-failed', '未找到 OpenCode 二进制，无法启动页面探索');
      }

      const mcpPath = (this.options.resolveMcpPath ?? resolvePlaywrightMcpPath)(config);

      if (!mcpPath) {
        return this.fail(input, 'process-failed', '未找到官方 Playwright MCP，无法启动页面探索');
      }

      const configContent = buildOpenCodeConfigContent({
        protocol: config.protocol,
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        opencodePath,
        playwrightMcpPath: mcpPath,
        workDir: input.workDir,
        userDataDir,
        mcpOutputDir,
        storageStatePath: input.storageStatePath,
        allowedOrigin: originOf(input.baseUrl),
        executablePath: input.executablePath,
        contextLimit: config.contextLimit,
        outputLimit: config.outputLimit,
        reasoningEffort: config.reasoningEffort
      });

      await writeJson(join(inputDir, 'case.json'), {
        caseNumber: input.item.caseNumber,
        name: input.item.name,
        startPath: input.item.startPath,
        preconditions: input.item.preconditions,
        expected: input.item.expected,
        remark: input.item.remark,
        steps: input.item.steps.map((step) => ({
          order: step.order,
          action: step.action,
          target: step.target,
          data: step.data,
          note: step.note,
          source: step.source
        })),
        startUrl: joinUrl(input.baseUrl, input.item.startPath)
      });
      await writeJson(join(inputDir, 'explore-context.json'), {
        baseUrl: input.baseUrl ?? '',
        hasStorageState: Boolean(input.storageStatePath),
        startPath: input.item.startPath
      });

      const result = await runOpenCodeProcess({
        bin: opencodePath,
        args: buildOpenCodeArgs({
          workDir: input.workDir,
          provider: config.provider,
          model: config.model,
          title: `ai-import:${input.taskId}:${input.item.id}`
        }),
        cwd: input.workDir,
        env: buildOpenCodeEnv(JSON.stringify(configContent), {
          AI_BASE_URL: config.baseUrl,
          AI_API_KEY: config.apiKey,
          ...getVendorEnv()
        }),
        stdin: buildExplorePrompt(input),
        stdoutPath: join(input.diagnosticsDir, 'stdout.jsonl'),
        stderrPath: join(input.diagnosticsDir, 'stderr.txt'),
        signal: input.signal,
        timeoutMs,
        spawn: this.options.spawn
      });

      await writeJson(join(input.diagnosticsDir, 'opencode.json'), {
        exitCode: result.exitCode,
        sessionId: result.sessionId,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        eventTypes: result.events.map((event) => event.type)
      });

      if (result.cancelled) {
        return this.fail(input, 'cancelled');
      }

      if (result.timedOut) {
        return this.fail(input, 'timeout', describeTimeout(result));
      }

      if (result.exitCode !== 0) {
        const jsonlError = readJsonlError(result.events);
        return this.fail(input, jsonlError ? 'model-failed' : 'process-failed', jsonlError || result.stderr);
      }

      if (isPlaywrightMcpUnavailable(result.stderr)) {
        return this.fail(input, 'process-failed', result.stderr);
      }

      const candidate = extractCandidateJson(result.events);

      if (!candidate) {
        return this.fail(input, 'model-failed', '未能从 OpenCode 输出提取结构化候选结果');
      }

      return this.acceptCandidate(input, candidate);
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 校验候选 JSON，用解析快照补全来源引用，定位器必须来自探索结果。
   */
  private async acceptCandidate(input: AgentRunInput, candidate: unknown): Promise<AgentRunResult> {
    if (!isRecord(candidate) || typeof candidate.kind !== 'string') {
      return this.fail(input, 'model-failed', '候选结果缺少 kind');
    }

    const kind = candidate.kind;

    if (isFailureKind(kind)) {
      return this.fail(input, kind, typeof candidate.message === 'string' ? candidate.message : undefined);
    }

    if (kind !== 'success' && kind !== 'ambiguity') {
      return this.fail(input, 'model-failed', `不支持的候选结果类型：${kind}`);
    }

    const intent = toTestIntent(input.item);
    const locators = assignLocatorsByOrder(
      intent.steps,
      candidate.locators ?? (isRecord(candidate.intent) ? candidate.intent.locators : undefined)
    );
    const missing = intent.steps.filter(
      (step) => step.action !== '打开页面' && !isVerifiedLocator(locators[step.id])
    );

    if (missing.length > 0) {
      return this.fail(input, 'locator-failed');
    }

    if (kind === 'ambiguity') {
      applyAmbiguityPending(intent, typeof candidate.message === 'string' ? candidate.message : undefined);
    }

    const exploration: ExplorationResult = {
      locators,
      ...(typeof candidate.pageUrl === 'string' ? { pageUrl: candidate.pageUrl } : {})
    };
    await writeJson(join(input.workDir, 'intent-draft.json'), intent);
    await writeJson(join(input.outputDir, 'exploration.json'), exploration);
    return { kind, intent, exploration };
  }

  /**
   * 写入诊断并返回结构化失败。
   */
  private async fail(input: AgentRunInput, kind: ImportAgentFailureKind, message?: string): Promise<AgentRunResult> {
    const result = { kind, message: summarizeImportFailure(kind, message) };
    await writeJson(join(input.diagnosticsDir, 'agent.json'), result);
    return result;
  }

  /**
   * 合并应用配置与 runner 注入项。
   */
  private readConfig(): AgentConfig {
    return { ...getAppConfig().agent, ...this.options.config };
  }
}

/**
 * 构造单次探索提示词：只探索当前用例，禁止 Shell / evaluate，断言值只取用户输入。
 */
export function buildExplorePrompt(input: AgentRunInput) {
  const startUrl = joinUrl(input.baseUrl, input.item.startPath);
  return [
    '你在隔离任务目录中探索真实页面，生成可审阅测试意图。',
    `目标地址：${startUrl || input.item.startPath}`,
    input.storageStatePath ? '已由宿主注入项目登录态，不要读取或输出 Cookie / storageState。' : '未注入登录态。',
    '只使用 Playwright MCP 的导航、快照、填写、点击、选择、生成定位器和可见性/文本验证工具。',
    '禁止调用 evaluate、run_code、通用 Shell，禁止修改 TypeScript 或任务目录外文件。',
    '定位器必须来自真实页面观察，不要凭目标文本猜测。',
    '断言的期望结果只能使用用户提供的自然语言用例，不能把当前页面行为当成正确答案。',
    '若出现登录页、验证码或多因素认证，输出 kind=login-blocked。',
    '若页面无法探索，输出 kind=explore-failed。',
    '若无法为需要定位器的步骤生成已验证定位器，输出 kind=locator-failed。',
    '读取 input/case.json，最终只输出一个 JSON 对象，不要输出其它说明。',
    'JSON 形状：{"kind":"success|ambiguity|login-blocked|explore-failed|locator-failed","locators":{"按步骤顺序的数组或步骤 id 映射":{"mode":"role|text|label","role":"button","text":"提交","selector":"getByRole(...)"}},"pageUrl":"...","message":"..."}',
    'locators 必须覆盖除「打开页面」外的每个步骤。'
  ].join('\n');
}

/**
 * 拼接环境地址与用例起始路径。
 */
export function joinUrl(baseUrl: string | undefined, startPath: string) {
  if (!baseUrl) {
    return startPath;
  }

  return buildStartUrl(baseUrl, startPath);
}

/**
 * 把超时结果转成可定位的失败说明，避免只看到「页面探索超时」。
 */
function describeTimeout(result: { events: Array<{ type: string }>; stderr: string }) {
  if (result.events.length === 0 && !result.stderr.trim()) {
    return '页面探索超时：时限内没有过程输出';
  }

  return '页面探索超时';
}

/**
 * 判断 OpenCode 日志是否表明 Playwright MCP 未能进入会话。
 */
function isPlaywrightMcpUnavailable(stderr: string) {
  return /server unavailable/i.test(stderr) && /playwright/i.test(stderr);
}

/**
 * 读取 URL 的 origin，供 MCP allowed-origins 使用。
 */
function originOf(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * 判断未知值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断候选 kind 是否为失败类型。
 */
function isFailureKind(value: string): value is ImportAgentFailureKind {
  return value in FAILURE_MESSAGES;
}
