import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()
  .transform((value) => value || null);

// Matches the /demo form on the marketing site.
export const accessRequestSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(100),
  email: z.string().trim().email('Please enter a valid email address.').max(200).transform((value) => value.toLowerCase()),
  practiceName: z.string().trim().min(2, 'Please enter your practice name.').max(150),
  role: optionalText(100),
  practiceSize: optionalText(50),
  phone: optionalText(40),
  message: optionalText(2000),
  interest: optionalText(200),
  plan: optionalText(20),
  // Honeypot: real visitors never fill this in.
  website: z.string().max(500).optional(),
});

export const accessRequestReviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'resend']),
});

export const organisationAccessSchema = z.object({
  action: z.enum(['comp', 'suspend', 'extend_trial', 'require_payment']),
  days: z.coerce.number().int().min(1).max(90).optional(),
});
