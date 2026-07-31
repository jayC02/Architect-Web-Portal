import { DocumentSortSource, DocumentType } from '@prisma/client';
import { z } from 'zod';
import { APPLICATION_UPLOAD_LIMITS } from '@/lib/application-upload-limits';
import {
  documentFactSchema,
  documentFactFieldKeys,
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

export const DOCUMENT_ANALYSIS_VERSION = 'document-intelligence-v2';
export const DOCUMENT_ANALYSIS_SCHEMA_VERSION = 'document-intelligence-schema-v2';
export const DOCUMENT_ANALYSIS_PROMPT_VERSION = 'document-intelligence-prompt-v2';
const MAX_AI_FILE_BYTES = APPLICATION_UPLOAD_LIMITS.maxFileBytes;
const DEFAULT_TIMEOUT_MS = 45_000;

export const documentAnalysisCacheMatches = (input: {
  fileHash: string | null;
  analysisVersion: string | null;
  analysisProvider?: string | null;
  analysisModel?: string | null;
  analysisSchemaVersion: string | null;
  analysisPromptVersion: string | null;
  analysisStatus: string | null;
}, fileHash: string, expected?: { provider?: string | null; model?: string | null }) =>
  input.fileHash === fileHash
  && input.analysisVersion === DOCUMENT_ANALYSIS_VERSION
  && (!expected?.provider || input.analysisProvider === expected.provider)
  && (!expected?.model || input.analysisModel === expected.model)
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
  required: [
    'categoryKey',
    'certainty',
    'detectedTitle',
    'drawingNumber',
    'revision',
    'pageCount',
    'existingOrProposed',
    'extractedFacts',
    'evidence',
    'manualReviewRequired',
    'warnings',
    'mixedDocumentDetected',
  ],
  properties: {
    categoryKey: { type: 'string', enum: PDF_CATEGORY_KEYS },
    certainty: { type: 'string', enum: ['high', 'medium', 'low'] },
    detectedTitle: { type: ['string', 'null'] },
    drawingNumber: { type: ['string', 'null'] },
    revision: { type: ['string', 'null'] },
    pageCount: { type: ['integer', 'null'] },
    existingOrProposed: { type: 'string', enum: ['existing', 'proposed', 'mixed', 'unknown'] },
    extractedFacts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'value', 'page', 'evidence'],
        properties: {
          key: { type: 'string', enum: [
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
          value: { type: 'string' },
          page: { type: ['integer', 'null'] },
          evidence: { type: 'string' },
        },
      },
    },
    evidence: { type: ['string', 'null'] },
    manualReviewRequired: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    mixedDocumentDetected: { type: 'boolean' },
  },
} as const;

const geminiDocumentResultSchema = z.object({
  categoryKey: z.enum(PDF_CATEGORY_KEYS),
  certainty: certaintySchema,
  detectedTitle: z.string().trim().max(240).nullable(),
  drawingNumber: z.string().trim().max(120).nullable(),
  revision: z.string().trim().max(40).nullable(),
  pageCount: z.number().int().positive().nullable(),
  existingOrProposed: z.enum(['existing', 'proposed', 'mixed', 'unknown']),
  extractedFacts: z.array(z.object({
    key: z.enum(documentFactFieldKeys),
    value: z.string().trim().max(1000),
    page: z.number().int().positive().nullable(),
    evidence: z.string().trim().max(500),
  }).strict()).max(60),
  evidence: z.string().trim().max(500).nullable(),
  manualReviewRequired: z.boolean(),
  warnings: z.array(z.string().trim().max(300)).max(10),
  mixedDocumentDetected: z.boolean(),
}).strict();

export type AiProcessingStatus = 'invalid_request' | 'provider_unavailable' | 'invalid_response';

export class PdfAiProcessingError extends Error {
  constructor(
    public readonly aiStatus: AiProcessingStatus,
    message: string,
    public readonly providerHttpStatus?: number,
    public readonly providerStatus?: string,
  ) {
    super(message);
    this.name = 'PdfAiProcessingError';
  }
}

const schemaDepth = (value: unknown, depth = 0): number => {
  if (!value || typeof value !== 'object') return depth;
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.reduce((maximum, child) => Math.max(maximum, schemaDepth(child, depth + 1)), depth);
};

export const validateGeminiResponseSchema = (schema: unknown) => {
  const encoded = JSON.stringify(schema);
  const byteLength = Buffer.byteLength(encoded);
  if (byteLength > 12_000) throw new Error('Gemini response schema exceeds the local complexity limit.');
  if (schemaDepth(schema) > 12) throw new Error('Gemini response schema is too deeply nested.');
  for (const keyword of ['"$ref"', '"$defs"', '"definitions"', '"oneOf"', '"additionalProperties"']) {
    if (encoded.includes(keyword)) throw new Error(`Gemini response schema contains unsupported keyword ${keyword}.`);
  }
  return { byteLength, depth: schemaDepth(schema) };
};

export const validateGeminiPdfInput = (input: Pick<PdfClassificationInput, 'mimeType' | 'bytes'>) => {
  if (input.mimeType !== 'application/pdf') {
    throw new PdfAiProcessingError('invalid_request', 'The uploaded file is not a PDF.');
  }
  if (!input.bytes.length) throw new PdfAiProcessingError('invalid_request', 'The uploaded PDF is empty.');
  if (input.bytes.length > MAX_AI_FILE_BYTES) {
    throw new PdfAiProcessingError('invalid_request', 'The PDF exceeds the AI classification size limit.');
  }
  const prefix = input.bytes.subarray(0, 32).toString('ascii').trimStart();
  if (/^(?:data:|JVBERi0)/i.test(prefix)) {
    throw new PdfAiProcessingError('invalid_request', 'The PDF payload was encoded more than once.');
  }
  if (/^(?:<!doctype|<html)/i.test(prefix)) {
    throw new PdfAiProcessingError('invalid_request', 'The uploaded file contains HTML rather than PDF data.');
  }
  if (!input.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new PdfAiProcessingError('invalid_request', 'The uploaded file does not have a valid PDF signature.');
  }
  return { byteLength: input.bytes.length, mimeType: input.mimeType, signature: '%PDF-' as const };
};

export const geminiDocumentGenerationConfig = () => {
  validateGeminiResponseSchema(GEMINI_DOCUMENT_RESPONSE_SCHEMA);
  return {
    responseMimeType: 'application/json',
    responseJsonSchema: GEMINI_DOCUMENT_RESPONSE_SCHEMA,
  };
};

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
    throw new PdfAiProcessingError('invalid_response', 'The AI provider returned malformed JSON.');
  }
  const result = geminiDocumentResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new PdfAiProcessingError('invalid_response', 'The AI provider returned an unexpected response.');
  }
  return pdfClassificationResultSchema.parse({
    ...result.data,
    detectedTitle: result.data.detectedTitle ?? undefined,
    drawingNumber: result.data.drawingNumber ?? undefined,
    revision: result.data.revision ?? undefined,
    pageCount: result.data.pageCount ?? undefined,
    evidence: result.data.evidence ?? undefined,
    extractedFacts: result.data.extractedFacts.map((fact) => ({
      fieldKey: fact.key,
      value: fact.value,
      page: fact.page ?? undefined,
      evidence: fact.evidence,
      certainty: result.data.certainty,
    })),
  });
};

const timeoutSignal = () => {
  const configured = Number(process.env.DOCUMENT_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(configured) ? Math.min(Math.max(configured, 5_000), 90_000) : DEFAULT_TIMEOUT_MS;
  return AbortSignal.timeout(timeout);
};

const retryAfterMs = (response: Response) => {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 10_000) : null;
};

const retryDelayMs = (attempt: number, response: Response) => {
  const configured = Number(process.env.DOCUMENT_AI_RETRY_BASE_MS ?? 750);
  const base = Number.isFinite(configured) ? Math.min(Math.max(configured, 50), 5_000) : 750;
  return retryAfterMs(response) ?? Math.min(base * (2 ** attempt), 10_000);
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isTransientProviderStatus = (status: number) =>
  status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

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

const geminiErrorDetails = async (response: Response) => {
  const payload = await response.json().catch(() => null) as {
    error?: {
      message?: unknown;
      status?: unknown;
      details?: Array<{ fieldViolations?: Array<{ field?: unknown; description?: unknown }> }>;
    };
  } | null;
  const message = typeof payload?.error?.message === 'string'
    ? payload.error.message.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
  const providerStatus = typeof payload?.error?.status === 'string' ? payload.error.status : undefined;
  const fieldViolations = payload?.error?.details
    ?.flatMap((detail) => detail.fieldViolations ?? [])
    .map((violation) => ({
      field: typeof violation.field === 'string' ? violation.field.slice(0, 200) : undefined,
      description: typeof violation.description === 'string' ? violation.description.slice(0, 300) : undefined,
    }));
  return { message, providerStatus, fieldViolations };
};

export const buildGeminiGenerateContentRequest = (input: PdfClassificationInput) => {
  const pdf = validateGeminiPdfInput(input);
  const generationConfig = geminiDocumentGenerationConfig();
  return {
    body: {
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: input.bytes.toString('base64') } },
          { text: buildPrompt(input) },
        ],
      }],
      generationConfig,
    },
    diagnostics: {
      apiVersion: 'v1beta',
      requestMode: 'generateContent',
      structuredOutput: true,
      schemaBytes: validateGeminiResponseSchema(GEMINI_DOCUMENT_RESPONSE_SCHEMA).byteLength,
      pdfBytes: pdf.byteLength,
      mimeType: pdf.mimeType,
    },
  };
};

export class GeminiPdfClassificationProvider implements PdfClassificationProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    public model = normalizeGeminiModel(process.env.GEMINI_DOCUMENT_MODEL || 'gemini-3.5-flash-lite'),
  ) {
    this.model = normalizeGeminiModel(this.model);
  }

  async classifyDocument(input: PdfClassificationInput) {
    const request = buildGeminiGenerateContentRequest(input);
    const models = [...new Set([this.model, 'gemini-3.1-flash-lite'])];
    const failures: string[] = [];
    for (const model of models) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const configuredRetries = Number(process.env.DOCUMENT_AI_MAX_RETRIES ?? 2);
      const maxRetries = Number.isFinite(configuredRetries) ? Math.min(Math.max(configuredRetries, 0), 3) : 2;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          signal: timeoutSignal(),
          body: JSON.stringify(request.body),
        });

        if (response.ok) {
          this.model = model;
          const payload = await response.json() as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text ?? '';
          return parseStructuredResult(text);
        }

        const providerError = await geminiErrorDetails(response);
        failures.push(`${model}: HTTP ${response.status}${providerError.message ? `: ${providerError.message}` : ''}`);
        console.error('Gemini document request rejected', {
          endpoint,
          model,
          responseStatus: response.status,
          providerStatus: providerError.providerStatus,
          providerMessage: providerError.message,
          fieldViolations: providerError.fieldViolations,
          attempt: attempt + 1,
          ...request.diagnostics,
        });

        if (isTransientProviderStatus(response.status) && attempt < maxRetries) {
          await wait(retryDelayMs(attempt, response));
          continue;
        }

        const modelUnavailable =
          response.status === 404 ||
          (response.status === 400 && /model.+(?:not found|not supported|unavailable)/i.test(providerError.message));
        const canTryAlias = modelUnavailable && model !== models.at(-1);
        if (canTryAlias) break;

        const status: AiProcessingStatus = response.status === 400
          ? 'invalid_request'
          : 'provider_unavailable';
        throw new PdfAiProcessingError(
          status,
          status === 'invalid_request'
            ? 'The AI request format was rejected. A fallback classification was used.'
            : 'The AI provider was unavailable. A fallback classification was used.',
          response.status,
          providerError.providerStatus,
        );
      }
    }
    throw new PdfAiProcessingError(
      'provider_unavailable',
      `Gemini document classification was unavailable (${failures.join(' | ')}).`,
    );
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

export const configuredDocumentAnalysisIdentity = () => {
  const provider = createConfiguredPdfClassificationProvider();
  return provider ? { provider: provider.name, model: provider.model } : { provider: 'deterministic', model: null };
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
  aiStatus: AiProcessingStatus = 'provider_unavailable',
  providerHttpStatus?: number,
  providerStatus?: string,
): DocumentSortSuggestion => {
  const usedFallback = Boolean(fallbackReason);
  return {
    ...suggestion,
    classificationDetails: {
      aiStatus,
      categoryKey: TYPE_TO_CATEGORY[suggestion.suggestedDocumentType] ?? 'other',
      certainty: suggestion.confidence >= 0.8 ? 'high' : suggestion.confidence >= 0.55 ? 'medium' : 'low',
      evidence: suggestion.reason,
      warnings: [
        ...(suggestion.confidence < 0.55 ? ['The document could not be identified confidently.'] : []),
        ...(usedFallback ? ['A deterministic fallback suggestion was used; please check this document.'] : []),
      ],
      manualReviewRequired: suggestion.confidence < 0.55 || usedFallback,
      promptVersion: 'deterministic-sorter-v1',
      existingOrProposed: 'unknown',
      extractedFacts: [],
      mixedDocumentDetected: false,
      fallbackReason,
      providerHttpStatus,
      providerStatus,
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
    return withFallbackDetails(
      fallback,
      'The document is not an available PDF, so deterministic sorting was used.',
      'invalid_request',
    );
  }
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  try {
    validateGeminiPdfInput({ mimeType: input.mimeType, bytes });
  } catch (error) {
    if (error instanceof PdfAiProcessingError) {
      return withFallbackDetails(
        fallback,
        `${error.message} Deterministic sorting was used.`,
        error.aiStatus,
        error.providerHttpStatus,
        error.providerStatus,
      );
    }
    return withFallbackDetails(fallback, 'The PDF could not be validated. Deterministic sorting was used.', 'invalid_request');
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
        aiStatus: 'succeeded',
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
    if (error instanceof PdfAiProcessingError) {
      return withFallbackDetails(
        fallback,
        error.message,
        error.aiStatus,
        error.providerHttpStatus,
        error.providerStatus,
      );
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return withFallbackDetails(
        fallback,
        'AI analysis timed out. A fallback classification was used.',
        'provider_unavailable',
      );
    }
    return withFallbackDetails(
      fallback,
      'The AI response could not be validated. A fallback classification was used.',
      'invalid_response',
    );
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
  onProgress?: (result: DocumentSortSuggestion, index: number, completed: number, total: number) => void | Promise<void>,
) => {
  const fallbacks = await classifyDocumentBatch(inputs);
  let completed = 0;
  const suggestions = await mapWithConcurrency(inputs, APPLICATION_UPLOAD_LIMITS.analysisConcurrency, async (input, index) => {
    const result = await classifyOne(input, fallbacks[index], provider, projectContext);
    completed += 1;
    await onProgress?.(result, index, completed, inputs.length);
    return result;
  });
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
        ...(suggestion.classificationDetails.aiStatus ? { aiStatus: suggestion.classificationDetails.aiStatus } : {}),
        ...(suggestion.classificationDetails.providerHttpStatus ? { providerHttpStatus: suggestion.classificationDetails.providerHttpStatus } : {}),
        ...(suggestion.classificationDetails.providerStatus ? { providerStatus: suggestion.classificationDetails.providerStatus } : {}),
      }
    : null,
  analysedAt: new Date().toISOString(),
});

export const analysisStatusForSuggestion = (suggestion: DocumentSortSuggestion) => {
  switch (suggestion.classificationDetails?.aiStatus) {
    case 'invalid_request':
      return 'INVALID_REQUEST';
    case 'provider_unavailable':
      return 'PROVIDER_UNAVAILABLE';
    case 'invalid_response':
      return 'INVALID_RESPONSE';
    default:
      return suggestion.classificationDetails?.fallbackReason ? 'PARTIAL' : 'SUCCESS';
  }
};

export const classificationDetailsFromAudit = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const classification = (value as { classification?: unknown }).classification;
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) return null;
  return classification as NonNullable<DocumentSortSuggestion['classificationDetails']>;
};
