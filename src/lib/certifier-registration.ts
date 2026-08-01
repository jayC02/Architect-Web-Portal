import { z } from 'zod';

// These are the only accepted Part 1 registration prefixes in the portal.
export const CERTIFIER_REGISTRATION_PART1_CODES = ['BRE1', 'BRE2', 'RIA1', 'RIA2', 'SER1'] as const;

export type CertifierRegistrationPart1Code = typeof CERTIFIER_REGISTRATION_PART1_CODES[number];

export const certifierRegistrationPart1Schema = z.enum(CERTIFIER_REGISTRATION_PART1_CODES);
