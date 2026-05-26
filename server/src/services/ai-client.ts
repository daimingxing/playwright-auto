import { generateObject, zodSchema } from 'ai';
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
    apiKey: config.apiKey || undefined,
    supportsStructuredOutputs: true
  });
  const result = await generateObject({
    model: provider(config.model),
    system: input.system,
    prompt: input.user,
    schema: zodSchema(input.schema),
    output: 'object',
    temperature: config.temperature,
    // 重试次数由导入 worker 统一控制，避免 SDK 内层重试放大真实模型调用次数。
    maxRetries: 0,
    timeout: config.timeoutMs
  });

  return input.schema.parse(result.object);
}
