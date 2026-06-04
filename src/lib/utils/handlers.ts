import type { APIContext } from 'astro';
import { ZodError, type ZodTypeAny } from 'zod';
import { HttpError, jsonResponse } from '@/lib/utils/http';

export const parseBody = async <T extends ZodTypeAny>(request: Request, schema: T) => {
  const body = await request.json().catch(() => ({}));
  return schema.parse(body);
};

export const parseForm = async <T extends ZodTypeAny>(request: Request, schema: T) => {
  const form = await request.formData();
  return schema.parse(Object.fromEntries(form.entries()));
};

export const withErrorHandling = async (fn: () => Promise<Response>) => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message, details: error.details ?? null });
    }

    if (error instanceof ZodError) {
      return jsonResponse(400, {
        error: error.issues[0]?.message ?? 'Validation failed.',
        details: error.flatten(),
      });
    }

    console.error(error);
    return jsonResponse(500, { error: 'Internal server error.' });
  }
};

export const getNumericLimit = (context: APIContext, defaultLimit = 20, maxLimit = 100) => {
  const limitRaw = context.url.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : defaultLimit;
  if (!Number.isFinite(limit) || limit < 1) return defaultLimit;
  return Math.min(limit, maxLimit);
};
