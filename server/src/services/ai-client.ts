import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { z } from 'zod';
import { getAppConfig } from '../lib/app-config';
import { badRequest } from '../lib/http-error';

export interface AiJsonInput<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

/**
 * 使用项目封装的 AI 客户端生成结构化 JSON。
 */
export async function generateAiJson<T>(input: AiJsonInput<T>) {
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

  return input.schema.parse(parseJsonObject(result.text));
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
