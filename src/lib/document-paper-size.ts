import { z } from 'zod';

export const PAPER_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Not Applicable'] as const;
export const paperSizeValueSchema = z.enum(PAPER_SIZES);
export const paperSizeAnalysisSchema = z.object({
  value: paperSizeValueSchema.nullable(),
  source: z.enum(['ai', 'pdf_dimensions', 'manual', 'unknown']),
  certainty: z.enum(['high', 'medium', 'low']),
  evidence: z.string().max(500),
  page: z.number().int().positive().nullable(),
  physicalSize: paperSizeValueSchema.nullable(),
  mixedSizes: z.boolean(),
  reviewRequired: z.boolean(),
}).strict();
export type PaperSizeAnalysis = z.infer<typeof paperSizeAnalysisSchema>;
export const aiPaperSizeSchema = z.object({
  value: paperSizeValueSchema.nullable(), certainty: z.enum(['high', 'medium', 'low']),
  evidence: z.string().max(500), page: z.number().int().positive().nullable(), mixedSizes: z.boolean(),
}).strict();
export type AiPaperSize = z.infer<typeof aiPaperSizeSchema>;

const dimensions = [[841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210], [105, 148]];
export const paperSizeFromPoints = (width: number, height: number) => {
  const actual = [Math.abs(width), Math.abs(height)].sort((a, b) => a - b).map(value => value * 25.4 / 72);
  const index = dimensions.findIndex(target => target.every((value, axis) => Math.abs(value - actual[axis]) <= 3));
  return index < 0 ? null : PAPER_SIZES[index];
};

export const reconcilePaperSize = (ai: AiPaperSize | null | undefined, physical: Array<string | null>): PaperSizeAnalysis => {
  const known = new Set(physical.filter((value): value is string => value !== null));
  const physicalSize = physical.length > 0 && !physical.includes(null) && known.size === 1
    ? paperSizeValueSchema.parse([...known][0]) : null;
  const unrecognisedPages = physical.includes(null);
  const mixedSizes = known.size > 1 || (known.size > 0 && unrecognisedPages) || Boolean(ai?.mixedSizes);
  const unverifiedDimensions = unrecognisedPages && ai?.value !== 'Not Applicable';
  const conflict = Boolean(ai?.value && physicalSize && ai.value !== physicalSize);
  const trustedAi = ai?.value && ai.certainty === 'high' && ai.evidence.trim() && ai.page;
  const value = mixedSizes || conflict || unverifiedDimensions ? null : physicalSize ?? (trustedAi ? ai!.value : null);
  return {
    value, source: conflict || mixedSizes || !value ? 'unknown' : trustedAi ? 'ai' : 'pdf_dimensions',
    certainty: value ? 'high' : 'low',
    evidence: conflict ? `Title block says ${ai!.value}; PDF page dimensions are ${physicalSize}. Confirm the upload size.`
      : mixedSizes ? 'This PDF contains different paper sizes. Confirm the upload size.'
      : unverifiedDimensions ? 'PDF page dimensions do not match a supported paper size. Confirm the upload size.'
      : ai?.evidence || (physicalSize ? `PDF page dimensions match ${physicalSize}.` : 'Paper size could not be confirmed.'),
    page: ai?.page ?? (physical.length ? 1 : null), physicalSize, mixedSizes,
    reviewRequired: !value || mixedSizes || conflict,
  };
};

export const paperSizeFromAudit = (audit: unknown): PaperSizeAnalysis | null => {
  const candidate = (audit as { classification?: { paperSize?: unknown } } | null)?.classification?.paperSize;
  const parsed = paperSizeAnalysisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
};

export const withManualPaperSize = (audit: unknown, value: z.infer<typeof paperSizeValueSchema>) => {
  const previous = audit && typeof audit === 'object' && !Array.isArray(audit) ? audit as Record<string, unknown> : {};
  const classification = previous.classification && typeof previous.classification === 'object' ? previous.classification as Record<string, unknown> : {};
  const old = paperSizeFromAudit(audit);
  return { ...previous, classification: { ...classification, ...(old ? { paperSizeDetected: classification.paperSizeDetected ?? old } : {}), paperSize: {
    value, source: 'manual', certainty: 'high', evidence: 'Paper size confirmed during document review.',
    page: old?.page ?? null, physicalSize: old?.physicalSize ?? null, mixedSizes: old?.mixedSizes ?? false, reviewRequired: false,
  } satisfies PaperSizeAnalysis } };
};
