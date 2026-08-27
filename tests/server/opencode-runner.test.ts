import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { FakeAgentRunner } from '../../server/src/services/import/agent-runner';
import {
  ALLOWED_MCP_TOOLS,
  DENIED_MCP_TOOLS,
  buildOpenCodeArgs,
  buildOpenCodeConfigContent,
  buildOpenCodeEnv,
  buildOpenCodeModelEntry,
  buildPlaywrightMcpCommand
} from '../../server/src/services/import/opencode-config';
import { extractCandidateJson, parseOpenCodeJsonl, type SpawnFn } from '../../server/src/services/import/opencode-process';
import {
  OpenCodeAgentRunner,
  createDefaultAgentRunner,
  createOpenCodeAgentRunner,
  joinUrl
} from '../../server/src/services/import/opencode-runner';
import type { ImportTaskCase } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-opencode-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('OpenCode 接入契约', () => {
  it('Chat Completions 与 Responses 使用不同 Provider 包', () => {
    const launch = {
      protocol: 'chat-completions' as const,
      provider: 'corp',
      model: 'test-agent',
      baseUrl: 'https://llm.example/v1',
      opencodePath: 'C:\\app\\opencode.exe',
      playwrightMcpPath: 'C:\\app\\mcp\\cli.js',
      workDir: join(root, 'work'),
      userDataDir: join(root, 'user-data'),
      mcpOutputDir: join(root, 'mcp-output'),
      storageStatePath: join(root, 'auth.json'),
      allowedOrigin: 'https://crm.test.local'
    };

    const chat = buildOpenCodeConfigContent(launch);
    const responses = buildOpenCodeConfigContent({ ...launch, protocol: 'responses' });

    expect(chat.provider.corp.npm).toBe('@ai-sdk/openai-compatible');
    expect(responses.provider.corp.npm).toBe('@ai-sdk/openai');
    expect(chat.permission.bash).toBe('deny');
    expect(chat.permission.edit).toBe('deny');
    expect(chat.permission.external_directory).toBe('deny');
    expect(chat.permission.playwright_browser_evaluate).toBe('deny');
    expect(chat.permission.playwright_browser_navigate).toBe('allow');
    expect(DENIED_MCP_TOOLS).toContain('playwright_browser_evaluate');
    expect(ALLOWED_MCP_TOOLS).toContain('playwright_browser_generate_locator');
    expect(joinUrl('http://10.82.7.5/xmdmpms-imms-f', '/web/IMQM14')).toBe(
      'http://10.82.7.5/xmdmpms-imms-f/web/IMQM14'
    );
    expect(buildOpenCodeArgs({
      workDir: join(root, 'work'),
      provider: 'corp',
      model: 'grok-4.6',
      title: 'ai-import:probe'
    })).toEqual(expect.arrayContaining(['--print-logs', '--log-level', 'INFO', 'run', '--format', 'json']));

    const command = buildPlaywrightMcpCommand(launch);
    expect(command[0]).toBe(process.execPath);
    expect(command.join(' ')).not.toContain('npx');
    expect(command.join(' ')).toContain('--isolated');
    expect(command.join(' ')).toContain(`--storage-state=${launch.storageStatePath}`);
    expect(command.join(' ')).toContain(`--user-data-dir=${launch.userDataDir}`);
    expect(chat.provider.corp.models['test-agent']).toEqual({ name: 'test-agent' });
  });

  it('未填窗口和思考档位时不写入 OpenCode 模型段；Grok 4.6 可声明 500k', () => {
    expect(buildOpenCodeModelEntry({ model: 'grok-4.6' })).toEqual({ name: 'grok-4.6' });
    expect(buildOpenCodeModelEntry({
      model: 'grok-4.6',
      contextLimit: 500000,
      reasoningEffort: 'high'
    })).toEqual({
      name: 'grok-4.6',
      limit: { context: 500000, output: 500000 },
      options: { reasoningEffort: 'high' }
    });
    expect(buildOpenCodeConfigContent({
      protocol: 'chat-completions',
      provider: 'corp',
      model: 'grok-4.6',
      baseUrl: 'https://llm.example/v1',
      opencodePath: 'C:\\app\\opencode.exe',
      playwrightMcpPath: 'C:\\app\\mcp\\cli.js',
      workDir: join(root, 'work'),
      userDataDir: join(root, 'user-data'),
      mcpOutputDir: join(root, 'mcp-output'),
      contextLimit: 500000,
      outputLimit: 500000,
      reasoningEffort: 'medium'
    }).provider.corp.models['grok-4.6']).toEqual({
      name: 'grok-4.6',
      limit: { context: 500000, output: 500000 },
      options: { reasoningEffort: 'medium' }
    });
  });

  it('生产默认 OpenCode，测试可注入 Fake', () => {
    const previous = process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER;
    delete process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER;

    try {
      expect(createDefaultAgentRunner()).toBeInstanceOf(OpenCodeAgentRunner);
      expect(createApp().locals.agentRunner).toBeInstanceOf(OpenCodeAgentRunner);
      expect(createApp({ agentRunner: new FakeAgentRunner() }).locals.agentRunner).toBeInstanceOf(FakeAgentRunner);

      process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER = 'fake';
      expect(createDefaultAgentRunner()).toBeInstanceOf(FakeAgentRunner);
    } finally {
      if (previous === undefined) {
        delete process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER;
      } else {
        process.env.PLAYWRIGHT_AUTO_AGENT_RUNNER = previous;
      }
    }
  });

  it('子进程 API Key 优先环境变量，否则用本地配置', () => {
    const previous = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;

    try {
      expect(buildOpenCodeEnv('{}', { AI_API_KEY: 'file-secret' }).AI_API_KEY).toBe('file-secret');
      process.env.AI_API_KEY = 'env-secret';
      expect(buildOpenCodeEnv('{}', { AI_API_KEY: 'file-secret' }).AI_API_KEY).toBe('env-secret');
    } finally {
      if (previous === undefined) {
        delete process.env.AI_API_KEY;
      } else {
        process.env.AI_API_KEY = previous;
      }
    }
  });

  it('模型地址不回退到项目环境 URL', async () => {
    const previous = process.env.AI_BASE_URL;
    delete process.env.AI_BASE_URL;

    try {
      const env = buildOpenCodeEnv('{}', { PLAYWRIGHT_BROWSERS_PATH: 'vendor' });
      expect(env.AI_BASE_URL).toBe('');
      expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('vendor');

      await writeFile(join(root, 'opencode.exe'), 'fake');
      await writeFile(join(root, 'mcp.js'), 'fake');
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      await createOpenCodeAgentRunner({
        config: { baseUrl: '' },
        resolveOpenCodePath: () => join(root, 'opencode.exe'),
        resolveMcpPath: () => join(root, 'mcp.js'),
        spawn: (_command, _args, options) => {
          capturedEnv = options.env;
          return createSpawnMock({
            stdout: jsonl({
              kind: 'success',
              locators: [
                null,
                {
                  mode: 'role',
                  role: 'button',
                  text: '提交',
                  selector: "getByRole('button', { name: '提交', exact: true })"
                }
              ]
            }),
            exitCode: 0
          })();
        }
      }).run(makeRunInput({ baseUrl: 'https://crm.test.local' }));

      expect(capturedEnv?.AI_BASE_URL).toBe('');
      expect(capturedEnv?.AI_BASE_URL).not.toContain('crm.test.local');
    } finally {
      if (previous === undefined) {
        delete process.env.AI_BASE_URL;
      } else {
        process.env.AI_BASE_URL = previous;
      }
    }
  });

  it('从 JSONL 提取最终候选 JSON', () => {
    const parsed = parseOpenCodeJsonl(
      [
        '{"type":"step_start","sessionID":"ses-1"}',
        '{"type":"text","sessionID":"ses-1","text":"思考中"}',
        '{"type":"text","sessionID":"ses-1","text":"```json\\n{\\"kind\\":\\"success\\",\\"locators\\":[]}\\n```"}'
      ].join('\n')
    );

    expect(parsed.sessionId).toBe('ses-1');
    expect(extractCandidateJson(parsed.events)).toEqual({ kind: 'success', locators: [] });
  });

  it('缺少 OpenCode 或 MCP 时返回进程失败，不假装探索成功', async () => {
    const runner = createOpenCodeAgentRunner({
      resolveOpenCodePath: () => null,
      resolveMcpPath: () => join(root, 'mcp.js')
    });
    const missingOpenCode = await runner.run(makeRunInput());
    expect(missingOpenCode.kind).toBe('process-failed');
    if (missingOpenCode.kind === 'process-failed') {
      expect(missingOpenCode.message).toContain('OpenCode');
    }

    const missingMcp = await createOpenCodeAgentRunner({
      resolveOpenCodePath: () => join(root, 'opencode.exe'),
      resolveMcpPath: () => null
    }).run(makeRunInput());
    expect(missingMcp.kind).toBe('process-failed');
    if (missingMcp.kind === 'process-failed') {
      expect(missingMcp.message).toContain('Playwright MCP');
    }
  });

  it('把登录阻塞、探索失败和模型失败映射为结构化结果', async () => {
    await writeFile(join(root, 'opencode.exe'), 'fake');
    await writeFile(join(root, 'mcp.js'), 'fake');

    const login = await createOpenCodeAgentRunner({
      resolveOpenCodePath: () => join(root, 'opencode.exe'),
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: createSpawnMock({
        stdout: jsonl({ kind: 'login-blocked', message: '需要登录' }),
        exitCode: 0
      })
    }).run(makeRunInput());
    expect(login.kind).toBe('login-blocked');

    const explore = await createOpenCodeAgentRunner({
      resolveOpenCodePath: () => join(root, 'opencode.exe'),
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: createSpawnMock({
        stdout: jsonl({ kind: 'explore-failed' }),
        exitCode: 0
      })
    }).run(makeRunInput());
    expect(explore.kind).toBe('explore-failed');

    const model = await createOpenCodeAgentRunner({
      resolveOpenCodePath: () => join(root, 'opencode.exe'),
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: createSpawnMock({
        stdout: '{"type":"error","error":{"message":"provider timeout"}}\n',
        exitCode: 1
      })
    }).run(makeRunInput());
    expect(model.kind).toBe('model-failed');
  });

  it('成功候选使用探索定位器，并清理 user-data-dir', async () => {
    await writeFile(join(root, 'opencode.exe'), 'fake');
    await writeFile(join(root, 'mcp.js'), 'fake');
    const runner = createOpenCodeAgentRunner({
      resolveOpenCodePath: () => join(root, 'opencode.exe'),
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: createSpawnMock({
        stdout: jsonl({
          kind: 'success',
          locators: [
            null,
            {
              mode: 'role',
              role: 'button',
              text: '提交',
              selector: "getByRole('button', { name: '提交', exact: true })"
            }
          ]
        }),
        exitCode: 0
      })
    });

    const result = await runner.run(
      makeRunInput({
        baseUrl: 'https://crm.test.local',
        storageStatePath: join(root, 'auth.storageState.json')
      })
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }

    expect(result.intent.source.sheet).toBe('用例');
    expect(result.intent.steps[1]?.sourceRefs[0]?.cells['动作类型']).toBe('点击');
    expect(result.exploration?.locators[result.intent.steps[1]?.id ?? '']?.selector).toContain('getByRole');
    expect(existsSync(join(root, 'work', 'user-data'))).toBe(false);
    expect(existsSync(join(root, 'diagnostics', 'stdout.jsonl'))).toBe(true);
  });

  it('真实子进程取消和超时会结束进程并清理', async () => {
    const hang = join(root, 'hang.mjs');
    await writeFile(
      hang,
      [
        'process.stdin.on("data", () => {});',
        'process.stdin.resume();',
        'console.log(JSON.stringify({ type: "text", sessionID: "ses-hang", text: "{}" }));',
        'setInterval(() => {}, 1000);'
      ].join('\n')
    );
    await writeFile(join(root, 'mcp.js'), 'fake');

    const controller = new AbortController();
    const cancelledRun = createOpenCodeAgentRunner({
      resolveOpenCodePath: () => process.execPath,
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: (command, _args, options) => {
        const { spawn } = require('node:child_process') as typeof import('node:child_process');
        return spawn(command, [hang], options);
      }
    }).run(makeRunInput({ signal: controller.signal, timeoutMs: 8000 }));

    setTimeout(() => controller.abort(), 200);
    const cancelled = await cancelledRun;
    expect(cancelled.kind).toBe('cancelled');

    const timedOut = await createOpenCodeAgentRunner({
      resolveOpenCodePath: () => process.execPath,
      resolveMcpPath: () => join(root, 'mcp.js'),
      spawn: (command, _args, options) => {
        const { spawn } = require('node:child_process') as typeof import('node:child_process');
        return spawn(command, [hang], options);
      }
    }).run(makeRunInput({ timeoutMs: 800 }));
    expect(timedOut.kind).toBe('timeout');
    if ('message' in timedOut) {
      expect(timedOut.message).toContain('页面探索超时');
    }
    expect(existsSync(join(root, 'work', 'user-data'))).toBe(false);
  }, 20000);
});

/**
 * 构造 OpenCode runner 输入。
 */
function makeRunInput(
  extra: {
    signal?: AbortSignal;
    timeoutMs?: number;
    baseUrl?: string;
    storageStatePath?: string;
  } = {}
) {
  return {
    projectKey: 'crm',
    taskId: 'imp-20990101-000000-abcd',
    item: makeParsedCase(),
    workDir: join(root, 'work'),
    outputDir: join(root, 'output'),
    diagnosticsDir: join(root, 'diagnostics'),
    timeoutMs: extra.timeoutMs ?? 5000,
    ...extra
  };
}

/**
 * 构造已解析用例。
 */
function makeParsedCase(): ImportTaskCase {
  return {
    id: 'item-20990101-000000-abcd',
    caseNumber: 'TC-001',
    name: '创建订单',
    startPath: '/orders/create',
    preconditions: '已登录',
    expected: '创建成功',
    remark: '',
    status: 'parsed',
    source: {
      sheet: '用例',
      row: 2,
      caseNumber: 'TC-001',
      cells: { 用例编号: 'TC-001', 用例名称: '创建订单' }
    },
    steps: [
      {
        order: 1,
        action: '打开页面',
        target: '/orders/create',
        data: '',
        note: '',
        source: {
          sheet: '步骤',
          row: 2,
          caseNumber: 'TC-001',
          cells: { 用例编号: 'TC-001', 动作类型: '打开页面', 目标: '/orders/create' }
        }
      },
      {
        order: 2,
        action: '点击',
        target: '提交',
        data: '',
        note: '',
        source: {
          sheet: '步骤',
          row: 3,
          caseNumber: 'TC-001',
          cells: { 用例编号: 'TC-001', 动作类型: '点击', 目标: '提交' }
        }
      }
    ],
    errors: []
  };
}

/**
 * 把候选对象包成 OpenCode JSONL 文本事件。
 */
function jsonl(candidate: unknown) {
  return `${JSON.stringify({ type: 'text', sessionID: 'ses-1', text: JSON.stringify(candidate) })}\n`;
}

/**
 * 构造立即退出的假子进程，用于契约测试。
 */
function createSpawnMock(options: { stdout: string; exitCode: number }) {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      exitCode: number | null;
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end: (value?: string) => void };
    };
    child.pid = 1;
    child.killed = false;
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => undefined };

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(options.stdout));
      child.exitCode = options.exitCode;
      child.emit('exit', options.exitCode);
    });

    return child as unknown as ReturnType<SpawnFn>;
  };
}
