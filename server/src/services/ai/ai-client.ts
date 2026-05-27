import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { z } from 'zod';
import { getAppConfig } from '../../lib/app-config';
import { badRequest } from '../../lib/http-error';

export interface AiJsonInput<T> {
  system: string;
  user: string;
  schema?: z.ZodType<T>;
}

export interface AiJsonResult<T> {
  value: T;
  response: string;
  parsed: unknown;
}

/**
 * 表示模型已有原始响应，但响应无法解析或校验为目标 JSON。
 */
export class AiJsonError extends Error {
  response: string;
  parsed?: unknown;

  /**
   * 创建携带模型原始输出的 JSON 解析错误。
   */
  constructor(message: string, response: string, parsed?: unknown) {
    super(message);
    this.name = 'AiJsonError';
    this.response = response;
    this.parsed = parsed;
  }
}

/**
 * 使用项目封装的 AI 客户端生成结构化 JSON。
 */
export async function generateAiJson<T>(input: AiJsonInput<T>): Promise<AiJsonResult<T>> {
  const config = getAppConfig().ai;

  if (!config.enabled || !config.baseUrl || !config.model) {
    throw badRequest('AI 导入未配置模型服务');
  }

  const provider = createOpenAICompatible({
    name: 'playwright-auto-ai',
    baseURL: config.baseUrl,
    apiKey: config.apiKey || undefined
  });
  const result = await generateText({
    model: provider(config.model),
    system: [
      input.system,
      '必须只返回一个 JSON 对象，不要返回 Markdown 代码块，不要返回解释说明。'
    ].join('\n'),
    prompt: input.user,
    temperature: config.temperature,
    // 重试次数由导入 worker 统一控制，避免 SDK 内层重试放大真实模型调用次数。
    maxRetries: 0,
    timeout: config.timeoutMs
  });

  const parsed = parseJsonResult(result.text);

  return {
    value: parseSchemaValue(input, result.text, parsed),
    response: result.text,
    parsed
  };
}

/**
 * 解析模型文本并在失败时保留原始输出。
 */
function parseJsonResult(text: string) {
  try {
    return parseJsonObject(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 返回内容不是 JSON 对象';

    throw new AiJsonError(message, text);
  }
}

/**
 * 按可选 schema 校验模型 JSON。
 */
function parseSchemaValue<T>(input: AiJsonInput<T>, response: string, parsed: unknown): T {
  if (!input.schema) {
    return parsed as T;
  }

  try {
    return input.schema.parse(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 返回结构不符合要求';

    throw new AiJsonError(message, response, parsed);
  }
}

/**
 * 解析模型返回的 JSON 对象文本。
 */
export function parseJsonObject(text: string) {
  const value = text.trim();
  const jsonText = stripJsonFence(value);

  try {
    return JSON.parse(jsonText);
  } catch {
    // 部分 OpenAI 兼容模型会在 JSON 前后附带解释，这里只截取最外层对象作为兜底。
    return JSON.parse(readObjectText(jsonText));
  }
}

/**
 * 去除常见 Markdown JSON 代码块包裹。
 */
function stripJsonFence(text: string) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return match ? match[1].trim() : text;
}

/**
 * 从文本中提取最外层 JSON 对象。
 */
function readObjectText(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw badRequest('AI 返回内容不是 JSON 对象');
  }

  return text.slice(start, end + 1);
}
