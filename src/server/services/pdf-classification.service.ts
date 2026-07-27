import { DocumentSortSource, DocumentType } from '@prisma/client';
import { z } from 'zod';
import {
  documentFactSchema,
  DOCUMENT_INTELLIGENCE_CATEGORY_KEYS,
} from '@/lib/validation/document-intelligence';
import {
  classifyDocumentBatch,
  type DocumentSortSuggestion,
  type SortInput,
} from '@/server/services/document-sorter.service';

export const PDF_CATEGORY_KEYS = DOCUMENT_INTELLIGENCE_CATEGORY_KEYS;

const certaintySchema = z.enum(['high', 'medium', 'low']);

export const pdfClassificationResultSchema = z.object({
  categoryKey: z.enum(PDF_CATEGORY_KEYS),
  certainty: certaintySchema,
  detectedTitle: z.string().trim().max(240).optional(),
  drawingNumber: z.string().trim().max(120).optional(),
  revision: z.string().trim().max(40).optional(),
  pageCount: z.number().int().positive().optional(),
  existingOrProposed: z.enum(['existing', 'proposed', 'mixed', 'unknown']).default('unknown'),
  extractedFacts: z.array(documentFactSchema).max(60).default([]),
  evidence: z.string().trim().max(500).optional(),
  manualReviewRequired: z.boolean(),
  warnings: z.array(z.string().trim().max(300)).max(10),
  mixedDocumentDetected: z.boolean().default(false),
}).strict();

export type PdfClassificationResult = z.infer<typeof pdfClassificationResultSchema>;

export type PdfClassificationInput = {
  filename: string;
  fileReference: string;
  mimeType: string;
  bytes: Buffer;
  extractedText?: string;
  projectContext?: {
    projectName?: string;
    typeOfWork?: string;
    applicationType?: string;
    siteAddress?: string;
    localAuthority?: string;
    clientName?: string;
    projectNotes?: string;
  };
};

export interface PdfClassificationProvider {
  readonly name: string;
  readonly model: string;
  classifyDocument(input: PdfClassificationInput): Promise<PdfClassificationResult>;
}

export type ProjectClassificationContext = PdfClassificationInput['projectContext'];

export const DOCUMENT_ANALYSIS_VERSION = 'document-intelligence-v1';
export const DOCUMENT_ANALYSIS_SCHEMA_VERSION = 'document-intelligence-schema-v1';
export const DOCUMENT_ANALYSIS_PROMPT_VERSION = 'document-intelligence-prompt-v1';
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;

export const documentAnalysisCacheMatches = (input: {
  fileHash: string | null;
  analysisVersion: string | null;
  analysisSchemaVersion: string | null;
  analysisPromptVersion: string | null;
  analysisStatus: string | null;
}, fileHash: string) =>
  input.fileHash === fileHash
  && input.analysisVersion === DOCUMENT_ANALYSIS_VERSION
  && input.analysisSchemaVersion === DOCUMENT_ANALYSIS_SCHEMA_VERSION
  && input.analysisPromptVersion === DOCUMENT_ANALYSIS_PROMPT_VERSION
  && input.analysisStatus === 'SUCCESS';

const CATEGORY_TO_DOCUMENT_TYPE: Record<PdfClassificationResult['categoryKey'], DocumentType> = {
  location_plan: DocumentType.LOCATION_PLAN,
  site_block_plan: DocumentType.SITE_PLAN,
  existing_plans: DocumentType.EXISTING_DRAWING,
  proposed_plans: DocumentType.PROPOSED_DRAWING,
  elevations: DocumentType.ELEVATION,
  sections: DocumentType.SECTION,
  drainage: DocumentType.DRAINAGE,
  construction_details: DocumentType.DETAILS,
  specifications: DocumentType.SPECIFICATIONS,
  calculations: DocumentType.CALCULATIONS,
  photographs: DocumentType.PHOTO,
  supporting_documents: DocumentType.SUPPORTING_DOCUMENT,
  other: DocumentType.OTHER,
  unsure: DocumentType.OTHER,
};

const TYPE_TO_CATEGORY: Partial<Record<DocumentType, PdfClassificationResult['categoryKey']>> = {
  [DocumentType.LOCATION_PLAN]: 'location_plan',
  [DocumentType.SITE_PLAN]: 'site_block_plan',
  [DocumentType.BLOCK_PLAN]: 'site_block_plan',
  [DocumentType.EXISTING_DRAWING]: 'existing_plans',
  [DocumentType.PROPOSED_DRAWING]: 'proposed_plans',
  [DocumentType.ELEVATION]: 'elevations',
  [DocumentType.SECTION]: 'sections',
  [DocumentType.DRAINAGE]: 'drainage',
  [DocumentType.DETAILS]: 'construction_details',
  [DocumentType.SPECIFICATIONS]: 'specifications',
  [DocumentType.CALCULATIONS]: 'calculations',
  [DocumentType.PHOTO]: 'photographs',
  [DocumentType.SUPPORTING_DOCUMENT]: 'supporting_documents',
  [DocumentType.OTHER]: 'other',
};

const PLANNING_TYPES = new Set<DocumentType>([
  DocumentType.LOCATION_PLAN,
  DocumentType.SITE_PLAN,
  DocumentType.EXISTING_DRAWING,
  DocumentType.PROPOSED_DRAWING,
  DocumentType.ELEVATION,
  DocumentType.SECTION,
  DocumentType.DETAILS,
  DocumentType.SPECIFICATIONS,
  DocumentType.PHOTO,
  DocumentType.SUPPORTING_DOCUMENT,
]);

const WARRANT_TYPES = new Set<DocumentType>([
  ...PLANNING_TYPES,
  DocumentType.DRAINAGE,
  DocumentType.CALCULATIONS,
]);

export const GEMINI_DOCUMENT_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['categoryKey', 'certainty', 'manualReviewRequired', 'warnings'],
  properties: {
    categoryKey: { type: 'string', enum: PDF_CATEGORY_KEYS },
    certainty: { type: 'string', enum: ['high', 'medium', 'low'] },
    detectedTitle: { type: 'string' },
    drawingNumber: { type: 'string' },
    revision: { type: 'string' },
    pageCount: { type: 'integer', minimum: 1 },
    existingOrProposed: { type: 'string', enum: ['existing', 'proposed', 'mixed', 'unknown'] },
    extractedFacts: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        required: ['fieldKey', 'value', 'evidence', 'certainty'],
        properties: {
          fieldKey: { type: 'string', enum: [
            'project.title', 'project.typeOfWork',
            'site.addressLine1', 'site.addressLine2', 'site.townCity', 'site.postcode', 'site.localAuthority',
            'applicant.clientType', 'applicant.title', 'applicant.firstName', 'applicant.lastName',
            'applicant.companyName', 'applicant.email', 'applicant.phone', 'applicant.addressLine1',
            'applicant.addressLine2', 'applicant.townCity', 'applicant.postcode', 'applicant.country',
            'agent.practiceName', 'agent.firstName', 'agent.lastName', 'agent.email', 'agent.phone',
            'agent.addressLine1', 'agent.addressLine2', 'agent.townCity', 'agent.postcode', 'agent.country',
            'application.descriptionOfWork', 'application.currentUse', 'application.proposedUse',
            'application.buildingType', 'application.numberOfStoreys', 'application.estimatedValue',
            'application.planningReference', 'evidence.listedOrConservation', 'evidence.ownership',
            'evidence.certifier',
          ] },
          value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
          page: { type: 'integer', minimum: 1 },
          evidence: { type: 'string' },
          certainty: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    evidence: { type: 'string' },
    manualReviewRequired: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    mixedDocumentDetected: { type: 'boolean' },
  },
} as const;

const buildPrompt = (input: PdfClassificationInput) => {
  const context = [
    input.projectContext?.projectName && `Project: ${input.projectContext.projectName}`,
    input.projectContext?.typeOfWork && `Type of work: ${input.projectContext.typeOfWork}`,
    input.projectContext?.applicationType && `Application: ${input.projectContext.applicationType}`,
    input.projectContext?.siteAddress && `Known site: ${input.projectContext.siteAddress}`,
    input.projectContext?.localAuthority && `Known local authority: ${input.projectContext.localAuthority}`,
    input.projectContext?.clientName && `Linked client: ${input.projectContext.clientName}`,
    input.projectContext?.projectNotes && `Project notes: ${input.projectContext.projectNotes.slice(0, 1000)}`,
  ].filter(Boolean).join('\n');

  return `Classify this architecture-practice PDF using exactly one permitted category.

Inspect the visible title block or document heading first, then actual page content and layout, embedded text, and finally the filename. The filename must not override contradictory visible content.

Permitted categories:
${PDF_CATEGORY_KEYS.join(', ')}

Rules:
- Use "unsure" rather than guessing.
- A map is not automatically a location plan.
- Distinguish existing and proposed drawings carefully.
- Keep calculations separate from specifications.
- If the PDF contains mixed document types, choose the best overall category, require manual review, and add a warning.
- Do not invent a title, drawing number, or revision.
- Keep evidence to one short, human-readable sentence.
- Extract only facts supported by visible evidence, using only the permitted field keys in the schema.
- Never convert a mention of ownership, listing, certification, or legal status into a confirmed declaration.
- Include a short evidence excerpt and page number when visible.

Filename: ${input.filename}
${context || 'No additional project context.'}`;
};

const responseTextFromOpenAi = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return '';
  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === 'string') return outputText;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  for (const item of output) {
    if (!item || typeof item !== 'object' || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
        return (content as { text: string }).text;
      }
    }
  }
  return '';
};

const parseStructuredResult = (text: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI provider returned malformed JSON.');
  }
  return pdfClassificationResultSchema.parse(parsed);
};

const timeoutSignal = () => {
  const configured = Number(process.env.DOCUMENT_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(configured) ? Math.min(Math.max(configured, 5_000), 90_000) : DEFAULT_TIMEOUT_MS;
  return AbortSignal.timeout(timeout);
};

const normalizeGeminiModel = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/^models\//, '');
  const compact = normalized.replace(/[^a-z0-9.]+/g, '');
  if (compact.includes('3.5') && compact.includes('flash') && compact.includes('lite')) {
    return 'gemini-3.5-flash-lite';
  }
  if (compact.includes('3.1') && compact.includes('flash') && compact.includes('lite')) {
    return 'gemini-3.1-flash-lite';
  }
  if (compact.includes('flash') && compact.includes('lite') && compact.includes('latest')) {
    return 'gemini-flash-lite-latest';
  }
  return normalized.replace(/[\s_]+/g, '-');
};

const geminiErrorMessage = async (response: Response) => {
  const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
  const message = payload?.error?.message;
  if (typeof message !== 'string') return '';
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
};

class GeminiPdfClassificationProvider implements PdfClassificationProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    public model = normalizeGeminiModel(process.env.GEMINI_DOCUMENT_MODEL || 'gemini-3.5-flash-lite'),
  ) {
    this.model = normalizeGeminiModel(this.model);
  }

  async classifyDocument(input: PdfClassificationInput) {
    const models = [...new Set([this.model, 'gemini-3.1-flash-lite'])];
    const failures: string[] = [];
    for (const model of models) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          signal: timeoutSignal(),
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inlineData: { mimeType: input.mimeType, data: input.bytes.toString('base64') } },
                { text: buildPrompt(input) },
              ],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: GEMINI_DOCUMENT_RESPONSE_SCHEMA,
            },
          }),
        },
      );

      if (response.ok) {
        this.model = model;
        const payload = await response.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text ?? '';
        return parseStructuredResult(text);
      }
      const providerMessage = await geminiErrorMessage(response);
      failures.push(`${model}: HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`);
      const modelUnavailable =
        response.status === 404 ||
        (response.status === 400 && /model.+(?:not found|not supported|unavailable)/i.test(providerMessage));
      const canRetryAlias = modelUnavailable && model !== models.at(-1);
      if (!canRetryAlias) {
        throw new Error(`Gemini request failed (${failures.join(' | ')}).`);
      }
    }
    throw new Error('Gemini document classification was unavailable.');
  }
}

class OpenAiPdfClassificationProvider implements PdfClassificationProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model = process.env.OPENAI_DOCUMENT_MODEL || 'gpt-4.1-mini',
  ) {}

  async classifyDocument(input: PdfClassificationInput) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model: this.model,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: input.filename,
              file_data: `data:${input.mimeType};base64,${input.bytes.toString('base64')}`,
            },
            { type: 'input_text', text: buildPrompt(input) },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'pdf_classification',
            strict: false,
            schema: GEMINI_DOCUMENT_RESPONSE_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI classification failed with status ${response.status}.`);
    return parseStructuredResult(responseTextFromOpenAi(await response.json()));
  }
}

export const createConfiguredPdfClassificationProvider = (): PdfClassificationProvider | null => {
  const configured = process.env.DOCUMENT_AI_PROVIDER?.trim().toLowerCase();
  if (!configured) return null;
  if (configured === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    return key ? new GeminiPdfClassificationProvider(key) : null;
  }
  if (configured === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAiPdfClassificationProvider(key) : null;
  }
  return null;
};

const certaintyConfidence = (certainty: PdfClassificationResult['certainty']) =>
  certainty === 'high' ? 0.9 : certainty === 'medium' ? 0.68 : 0.35;

const cleanOptional = (value: string | undefined) => value?.trim() || null;

const humanEvidence = (result: PdfClassificationResult) => {
  if (result.evidence) return result.evidence;
  if (result.detectedTitle) return `The document title identifies this as ${result.detectedTitle}.`;
  return 'The document content supports this suggested type.';
};

const withFallbackDetails = (
  suggestion: DocumentSortSuggestion,
  fallbackReason: string | undefined,
): DocumentSortSuggestion => {
  const aiFailure = Boolean(fallbackReason && /failed|timed out/i.test(fallbackReason));
  return {
    ...suggestion,
    classificationDetails: {
      categoryKey: TYPE_TO_CATEGORY[suggestion.suggestedDocumentType] ?? 'other',
      certainty: suggestion.confidence >= 0.8 ? 'high' : suggestion.confidence >= 0.55 ? 'medium' : 'low',
      evidence: suggestion.reason,
      warnings: [
        ...(suggestion.confidence < 0.55 ? ['The document could not be identified confidently.'] : []),
        ...(aiFailure ? ['AI analysis was unavailable for this document; the fallback result needs checking.'] : []),
      ],
      manualReviewRequired: suggestion.confidence < 0.55 || aiFailure,
      promptVersion: 'deterministic-sorter-v1',
      existingOrProposed: 'unknown',
      extractedFacts: [],
      mixedDocumentDetected: false,
      fallbackReason,
    },
  };
};

const classifyOne = async (
  input: SortInput,
  fallback: DocumentSortSuggestion,
  provider: PdfClassificationProvider | null,
  projectContext: ProjectClassificationContext,
): Promise<DocumentSortSuggestion> => {
  if (!provider) return withFallbackDetails(fallback, 'No AI document provider is configured.');
  if (input.mimeType !== 'application/pdf' || !input.bytes) {
    return withFallbackDetails(fallback, 'The document is not an available PDF, so deterministic sorting was used.');
  }
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (bytes.length > MAX_AI_FILE_BYTES) {
    return withFallbackDetails(fallback, 'The PDF exceeds the AI classification size limit.');
  }

  try {
    const result = pdfClassificationResultSchema.parse(await provider.classifyDocument({
      filename: input.filename,
      fileReference: input.documentId || input.filename,
      mimeType: input.mimeType,
      bytes,
      extractedText: input.pdfText,
      projectContext,
    }));
    const documentType = CATEGORY_TO_DOCUMENT_TYPE[result.categoryKey];
    const warnings = [...result.warnings];
    const rulesStronglyDisagree = fallback.confidence >= 0.8 && fallback.suggestedDocumentType !== documentType;
    if (rulesStronglyDisagree) warnings.push('The filename or extracted text suggests a different document type.');

    return {
      ...fallback,
      suggestedDocumentType: documentType,
      confidence: certaintyConfidence(result.certainty),
      reason: humanEvidence(result),
      revision: cleanOptional(result.revision),
      drawingNumber: cleanOptional(result.drawingNumber),
      drawingTitle: cleanOptional(result.detectedTitle),
      source: DocumentSortSource.AI,
      suitableForPlanning: PLANNING_TYPES.has(documentType),
      suitableForBuildingWarrant: WARRANT_TYPES.has(documentType),
      classificationDetails: {
        categoryKey: result.categoryKey,
        certainty: result.certainty,
        evidence: humanEvidence(result),
        warnings,
        manualReviewRequired:
          result.manualReviewRequired ||
          result.categoryKey === 'unsure' ||
          result.certainty === 'low' ||
          rulesStronglyDisagree ||
          warnings.length > 0,
        provider: provider.name,
        model: provider.model,
        promptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
        pageCount: result.pageCount,
        existingOrProposed: result.existingOrProposed,
        extractedFacts: result.extractedFacts,
        mixedDocumentDetected: result.mixedDocumentDetected,
      },
    };
  } catch (error) {
    const fallbackReason = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'AI classification timed out.'
      : error instanceof Error && /^(Gemini|OpenAI)/.test(error.message)
        ? error.message
        : 'AI classification failed or returned an invalid response.';
    return withFallbackDetails(fallback, fallbackReason);
  }
};

const mapWithConcurrency = async <T, R>(values: T[], limit: number, mapper: (value: T, index: number) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const addLocationPlanConflicts = (suggestions: DocumentSortSuggestion[]) => {
  const locations = suggestions.filter((item) => item.suggestedDocumentType === DocumentType.LOCATION_PLAN);
  if (locations.length <= 1) return;
  for (const item of locations) {
    if (!item.classificationDetails) continue;
    item.classificationDetails.warnings = [
      ...item.classificationDetails.warnings,
      'More than one document in this upload was identified as a location plan.',
    ];
    item.classificationDetails.manualReviewRequired = true;
  }
};

export const classifyProjectDocumentBatch = async (
  inputs: SortInput[],
  projectContext: ProjectClassificationContext = {},
  provider: PdfClassificationProvider | null = createConfiguredPdfClassificationProvider(),
) => {
  const fallbacks = await classifyDocumentBatch(inputs);
  const suggestions = await mapWithConcurrency(inputs, 4, (input, index) =>
    classifyOne(input, fallbacks[index], provider, projectContext));
  addLocationPlanConflicts(suggestions);
  return suggestions;
};

export const classificationAuditForSuggestion = (suggestion: DocumentSortSuggestion) => ({
  rules: suggestion.matchedRules,
  classification: suggestion.classificationDetails
    ? {
        categoryKey: suggestion.classificationDetails.categoryKey,
        certainty: suggestion.classificationDetails.certainty,
        ...(suggestion.classificationDetails.evidence ? { evidence: suggestion.classificationDetails.evidence } : {}),
        warnings: suggestion.classificationDetails.warnings,
        manualReviewRequired: suggestion.classificationDetails.manualReviewRequired,
        ...(suggestion.classificationDetails.provider ? { provider: suggestion.classificationDetails.provider } : {}),
        ...(suggestion.classificationDetails.model ? { model: suggestion.classificationDetails.model } : {}),
        promptVersion: suggestion.classificationDetails.promptVersion,
        ...(suggestion.classificationDetails.pageCount ? { pageCount: suggestion.classificationDetails.pageCount } : {}),
        ...(suggestion.classificationDetails.existingOrProposed ? { existingOrProposed: suggestion.classificationDetails.existingOrProposed } : {}),
        extractedFacts: suggestion.classificationDetails.extractedFacts ?? [],
        mixedDocumentDetected: suggestion.classificationDetails.mixedDocumentDetected ?? false,
        ...(suggestion.classificationDetails.fallbackReason ? { fallbackReason: suggestion.classificationDetails.fallbackReason } : {}),
      }
    : null,
  analysedAt: new Date().toISOString(),
});

export const classificationDetailsFromAudit = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const classification = (value as { classification?: unknown }).classification;
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) return null;
  return classification as NonNullable<DocumentSortSuggestion['classificationDetails']>;
};
