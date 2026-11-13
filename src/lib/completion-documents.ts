// Type-only: this module runs in the browser, which cannot load the database client.
import type { DocumentType } from '@prisma/client';
import { z } from 'zod';
import { CERTIFIER_REGISTRATION_PART1_CODES } from '@/lib/certifier-registration';

// Documents uploaded on the Completion Certificate page. Each upload is a
// normal project document; its role here says what it is for this
// certificate, which answers it drives and whether it goes to the portal.

export const COMPLETION_DOCUMENT_ROLES = [
  { key: 'BUILDING_WARRANT', label: 'Building warrant', portalDescription: 'Building Warrant',
    documentType: 'CORRESPONDENCE' as DocumentType, sentToPortal: false },
  { key: 'ENERGY_PERFORMANCE_CERTIFICATE', label: 'Energy Performance Certificate', portalDescription: 'Energy Performance Certificate',
    documentType: 'ENERGY' as DocumentType, sentToPortal: true },
  { key: 'SUSTAINABILITY_STATEMENT', label: 'Statement of Sustainability', portalDescription: 'Statement of Sustainability',
    documentType: 'CERTIFICATE' as DocumentType, sentToPortal: true },
  { key: 'FIRE_SAFETY_DESIGN_SUMMARY', label: 'Fire Safety Design Summary', portalDescription: 'Fire Safety Design Summary',
    documentType: 'SUPPORTING_DOCUMENT' as DocumentType, sentToPortal: true },
  { key: 'CONSTRUCTION_CERTIFICATE', label: 'Certificate of Construction', portalDescription: 'Certificate of Construction',
    documentType: 'CERTIFICATE' as DocumentType, sentToPortal: true },
  { key: 'DESIGN_CERTIFICATE', label: 'Certificate of Design (Form Q)', portalDescription: 'Notice of Finalisation of Design Details (Form Q)',
    documentType: 'CERTIFICATE' as DocumentType, sentToPortal: true },
  { key: 'OTHER', label: 'Other supporting document', portalDescription: 'Supporting Document',
    documentType: 'SUPPORTING_DOCUMENT' as DocumentType, sentToPortal: true },
  { key: 'UNRECOGNISED', label: 'Not recognised', portalDescription: 'Supporting Document',
    documentType: 'SUPPORTING_DOCUMENT' as DocumentType, sentToPortal: true },
] as const;

export type CompletionDocumentRoleKey = typeof COMPLETION_DOCUMENT_ROLES[number]['key'];
export const COMPLETION_DOCUMENT_ROLE_KEYS = COMPLETION_DOCUMENT_ROLES.map((role) => role.key) as [
  CompletionDocumentRoleKey, ...CompletionDocumentRoleKey[],
];
export const MAX_COMPLETION_DOCUMENTS = 40;

export const completionDocumentRole = (key: CompletionDocumentRoleKey) =>
  COMPLETION_DOCUMENT_ROLES.find((role) => role.key === key) ?? COMPLETION_DOCUMENT_ROLES[COMPLETION_DOCUMENT_ROLES.length - 1];

const CONSTRUCTION_CODES = ['NIC1', 'SEL1', 'SNP1'] as const;
const registerCodes = (role: CompletionDocumentRoleKey): readonly string[] =>
  role === 'CONSTRUCTION_CERTIFICATE' ? CONSTRUCTION_CODES : CERTIFIER_REGISTRATION_PART1_CODES;
const registerPart2 = (role: CompletionDocumentRoleKey) =>
  role === 'CONSTRUCTION_CERTIFICATE' ? { certifier: 'C', approvedBody: 'CB' } : { certifier: 'D', approvedBody: 'DB' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

const registration = z.object({ part1: z.string().max(10), part2: z.string().max(4), number: z.string().max(40) });
export const certificateDetailsSchema = z.object({
  certificateNumber: z.string().max(80),
  certifierRegistration: registration,
  certifierSignatureDate: isoDate.nullable(),
  approvedBodyRegistration: registration,
  approvedBodySignatureDate: isoDate.nullable(),
});
export type CertificateDetails = z.infer<typeof certificateDetailsSchema>;

/** Details read from a document. Every field is a suggestion for the architect to check. */
export const completionDocumentDetailsSchema = z.object({
  warrantReference: z.string().max(120).optional(),
  warrantDate: isoDate.optional(),
  amendmentDates: z.string().max(750).optional(),
  certificate: certificateDetailsSchema.optional(),
});
export type CompletionDocumentDetails = z.infer<typeof completionDocumentDetailsSchema>;

export const completionDocumentSchema = z.object({
  documentId: z.string().min(1).max(120),
  filename: z.string().max(255),
  role: z.enum(COMPLETION_DOCUMENT_ROLE_KEYS),
  // How the role was decided: by the AI, from the page text/filename, or by the architect.
  source: z.enum(['ai', 'text', 'manual']).default('manual'),
  details: completionDocumentDetailsSchema.default({}),
});
export type CompletionDocument = z.infer<typeof completionDocumentSchema>;

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** Best guess from the first page's text and the filename, when no AI is available. */
export const recogniseCompletionDocument = (input: { text: string; filename: string }): CompletionDocumentRoleKey => {
  const text = `${input.text}\n${input.filename.replace(/[_.-]+/g, ' ')}`.toLowerCase();
  // Most specific first: certificates often mention the building warrant they relate to.
  if (has(text, /fire safety design summary|\bfsds\b/)) return 'FIRE_SAFETY_DESIGN_SUMMARY';
  if (has(text, /energy performance certificate|\bepc\b/)) return 'ENERGY_PERFORMANCE_CERTIFICATE';
  if (has(text, /statement of sustainability|sustainability (label|statement)/)) return 'SUSTAINABILITY_STATEMENT';
  if (has(text, /notice of finalisation of design|\bform q\b|certificate of design|certifier of design/)) return 'DESIGN_CERTIFICATE';
  if (has(text, /certificate of construction|certifier of construction/)) return 'CONSTRUCTION_CERTIFICATE';
  if (has(text, /(grant|approval|amendment) of (a )?building warrant|building warrant (granted|approval|decision)|\bwarrant\b.*\b\d{2}\/\d{3,6}\/(warr|bw)\b/s)) {
    return 'BUILDING_WARRANT';
  }
  return 'UNRECOGNISED';
};

const dayMonthYear = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;
const isoFromParts = (day: string, month: string, year: string) => {
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isoDate.safeParse(value).success ? value : null;
};
const datesIn = (text: string) =>
  [...text.matchAll(dayMonthYear)].map((match) => isoFromParts(match[1], match[2], match[3])).filter((value): value is string => Boolean(value));
const portalDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

const certificateFromText = (role: CompletionDocumentRoleKey, text: string): CertificateDetails => {
  const codes = registerCodes(role).join('|');
  const part2 = registerPart2(role);
  const registrations = [...text.matchAll(new RegExp(`\\b(${codes})\\s*[/\\- ]\\s*(C|CB|D|DB)\\s*[/\\- ]\\s*(\\d{1,10})\\b`, 'gi'))]
    .map((match) => ({ part1: match[1].toUpperCase(), number: match[3] }));
  const number = /certificate\s*(?:no\.?|number|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{1,40})/i.exec(text)?.[1] ?? '';
  const dates = datesIn(text);
  return {
    certificateNumber: number,
    certifierRegistration: { part1: registrations[0]?.part1 ?? '', part2: part2.certifier, number: registrations[0]?.number ?? '' },
    certifierSignatureDate: dates[0] ?? null,
    approvedBodyRegistration: { part1: registrations[1]?.part1 ?? '', part2: part2.approvedBody, number: registrations[1]?.number ?? '' },
    approvedBodySignatureDate: dates[1] ?? null,
  };
};

/** Details that can be read from plain page text, when no AI is available. */
export const extractCompletionDetailsFromText = (role: CompletionDocumentRoleKey, text: string): CompletionDocumentDetails => {
  if (role === 'BUILDING_WARRANT') {
    const reference = /\b(\d{2}\/\d{3,6}\/[A-Z]{2,6})\b/i.exec(text)?.[1]?.toUpperCase();
    const granted = /date\s+of\s+(?:grant|decision|issue|warrant)\s*[:-]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i.exec(text);
    const warrantDate = granted ? isoFromParts(granted[1], granted[2], granted[3]) ?? undefined : undefined;
    return { ...(reference ? { warrantReference: reference } : {}), ...(warrantDate ? { warrantDate } : {}) };
  }
  if (role === 'CONSTRUCTION_CERTIFICATE' || role === 'DESIGN_CERTIFICATE') return { certificate: certificateFromText(role, text) };
  return {};
};

const text = (value: unknown, limit: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined);
const validIso = (value: unknown) => (typeof value === 'string' && isoDate.safeParse(value).success ? value : undefined);

/** Check an AI answer and keep only what is valid for the role it names. */
export const normaliseCompletionAnalysis = (value: unknown): { role: CompletionDocumentRoleKey; details: CompletionDocumentDetails } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  const role = COMPLETION_DOCUMENT_ROLE_KEYS.find((key) => key === answer.role);
  if (!role) return null;
  if (role === 'BUILDING_WARRANT') {
    const amendments = Array.isArray(answer.amendmentDates) ? answer.amendmentDates.map(validIso).filter((date): date is string => Boolean(date)) : [];
    const details: CompletionDocumentDetails = {};
    const reference = text(answer.warrantReference, 120);
    const warrantDate = validIso(answer.warrantDate);
    if (reference) details.warrantReference = reference;
    if (warrantDate) details.warrantDate = warrantDate;
    if (amendments.length) details.amendmentDates = amendments.map(portalDate).join('\n');
    return { role, details };
  }
  if (role === 'CONSTRUCTION_CERTIFICATE' || role === 'DESIGN_CERTIFICATE') {
    const codes = registerCodes(role);
    const part2 = registerPart2(role);
    const reg = (raw: unknown, fixed: string) => {
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const part1 = text(item.part1, 10)?.toUpperCase() ?? '';
      return { part1: codes.includes(part1) ? part1 : '', part2: fixed, number: text(item.number, 40) ?? '' };
    };
    return { role, details: { certificate: {
      certificateNumber: text(answer.certificateNumber, 80) ?? '',
      certifierRegistration: reg(answer.certifierRegistration, part2.certifier),
      certifierSignatureDate: validIso(answer.certifierSignatureDate) ?? null,
      approvedBodyRegistration: reg(answer.approvedBodyRegistration, part2.approvedBody),
      approvedBodySignatureDate: validIso(answer.approvedBodySignatureDate) ?? null,
    } } };
  }
  return { role, details: {} };
};
