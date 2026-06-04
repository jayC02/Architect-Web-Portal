import { z } from 'zod';

export const evidenceUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  }, 'Only http and https URLs are allowed.');
