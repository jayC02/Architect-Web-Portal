import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  // Not needed when joining an existing team through an invitation.
  organisationName: z.string().trim().max(100).optional().transform((value) => value || undefined),
  invite: z.string().trim().max(200).optional().transform((value) => value || undefined),
  team: z.string().trim().max(200).optional().transform((value) => value || undefined),
  plan: z.string().trim().max(20).optional(),
  billing: z.string().trim().max(20).optional(),
}).refine((body) => Boolean(body.team) || (body.organisationName?.length ?? 0) >= 2, {
  path: ['organisationName'],
  message: 'Enter your organisation name.',
});

export const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(512),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const completeGoogleSignupSchema = z.object({
  organisationName: z.string().trim().max(100).optional().transform((value) => value || undefined),
  // Set when the verified email has a pending team invitation.
  joinTeam: z.string().max(5).optional(),
}).refine((body) => Boolean(body.joinTeam) || (body.organisationName?.length ?? 0) >= 2, {
  path: ['organisationName'],
  message: 'Enter your organisation name.',
});
