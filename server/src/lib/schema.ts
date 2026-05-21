import { z } from 'zod';

export const projectKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

export const urlSchema = z.string().url();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  key: projectKeySchema,
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
