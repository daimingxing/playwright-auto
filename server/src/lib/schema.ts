import { z } from 'zod';

export const projectKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

/**
 * 归一化路径标识输入。
 */
function normalizeKey(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export const urlSchema = z.string().url();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  key: z.preprocess(normalizeKey, projectKeySchema),
  envName: z.string().max(80).optional(),
  baseUrl: urlSchema
});

export const envKeySchema = projectKeySchema;

export const createEnvSchema = z.object({
  name: z.string().min(1).max(80),
  key: envKeySchema,
  baseUrl: urlSchema
});

export const updateEnvSchema = z.object({
  name: z.string().min(1).max(80),
  baseUrl: urlSchema
});

export const createCaseSchema = z.object({
  name: z.string().min(1).max(120),
  startPath: z.string().min(1).default('/')
});

export const practicalFailureCodeSchema = z.enum([
  'navigation-failed',
  'auth-required',
  'selector-invalid',
  'no-match',
  'multiple-match',
  'hidden',
  'disabled',
  'not-editable',
  'covered',
  'assertion-mismatch',
  'timeout',
  'unknown'
]);

export const practicalReviewInputSchema = z
  .object({
    envKey: envKeySchema.optional(),
    mode: z.enum(['headless', 'headed']).optional(),
    testFailure: z
      .object({
        stepId: z.string().min(1).max(120),
        code: practicalFailureCodeSchema,
        message: z.string().min(1).max(500),
        suggestion: z.string().min(1).max(500)
      })
      .optional()
  })
  .strict();
