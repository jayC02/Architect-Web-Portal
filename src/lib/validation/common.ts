import { z } from 'zod';

export const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const optionalText = (max = 1000) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

export const safeUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'URL must use http or https.')
    .optional(),
);
