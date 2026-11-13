import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  COMPLETION_DOCUMENT_ROLE_KEYS,
  extractCompletionDetailsFromText,
  normaliseCompletionAnalysis,
  recogniseCompletionDocument,
  type CompletionDocumentDetails,
  type CompletionDocumentRoleKey,
} from '@/lib/completion-documents';

// Reads an uploaded completion document: what it is, and the details the
// completion certificate needs from it. An AI reader is used when one is
// configured; otherwise, or if it fails, the first page's text and the
// filename are used. To change AI provider, add a reader below.

export type CompletionDocumentReader = {
  name: string;
  /** Returns the provider's JSON answer, unchecked. */
  read(input: { bytes: Buffer; filename: string; mimeType: string }): Promise<unknown>;
};

export type CompletionDocumentAnalysis = {
  role: CompletionDocumentRoleKey;
  source: 'ai' | 'text';
  details: CompletionDocumentDetails;
};

const readableRoles = COMPLETION_DOCUMENT_ROLE_KEYS.filter((key) => key !== 'UNRECOGNISED');

export const COMPLETION_DOCUMENT_PROMPT = `This document was uploaded for a Scottish building standards Completion Certificate.

Identify what it is, using exactly one of: ${readableRoles.join(', ')}.
- BUILDING_WARRANT: a granted building warrant, or an amendment to one, issued by a local authority.
- ENERGY_PERFORMANCE_CERTIFICATE: an EPC.
- SUSTAINABILITY_STATEMENT: a statement of sustainability (sustainability label).
- FIRE_SAFETY_DESIGN_SUMMARY: a Fire Safety Design Summary.
- CONSTRUCTION_CERTIFICATE: a certificate of construction from an approved certifier of construction.
- DESIGN_CERTIFICATE: a certificate of design or a Notice of Finalisation of Design Details (Form Q).
- OTHER: anything else.

For BUILDING_WARRANT also give warrantReference (as printed, e.g. 26/01234/WARR), warrantDate (date granted, YYYY-MM-DD)
and amendmentDates (YYYY-MM-DD each) if the document lists granted amendments.
For CONSTRUCTION_CERTIFICATE and DESIGN_CERTIFICATE also give certificateNumber; certifierRegistration and
approvedBodyRegistration, each as { part1, part2, number } from a registration such as SEL1/C/12345; and
certifierSignatureDate and approvedBodySignatureDate (YYYY-MM-DD).
Leave out anything that is not printed on the document. Do not guess.`;

const registrationSchema = {
  type: 'object',
  properties: { part1: { type: 'string' }, part2: { type: 'string' }, number: { type: 'string' } },
};
export const COMPLETION_DOCUMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: readableRoles },
    warrantReference: { type: 'string' },
    warrantDate: { type: 'string' },
    amendmentDates: { type: 'array', items: { type: 'string' } },
    certificateNumber: { type: 'string' },
    certifierRegistration: registrationSchema,
    certifierSignatureDate: { type: 'string' },
    approvedBodyRegistration: registrationSchema,
    approvedBodySignatureDate: { type: 'string' },
  },
  required: ['role'],
};

const timeoutSignal = () => {
  const configured = Number(process.env.DOCUMENT_AI_TIMEOUT_MS ?? 45_000);
  return AbortSignal.timeout(Number.isFinite(configured) ? Math.min(Math.max(configured, 5_000), 90_000) : 45_000);
};

const geminiReader = (apiKey: string, model: string): CompletionDocumentReader => ({
  name: 'gemini',
  async read({ bytes }) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal: timeoutSignal(),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } },
            { text: COMPLETION_DOCUMENT_PROMPT },
          ] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: COMPLETION_DOCUMENT_RESPONSE_SCHEMA },
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini completion document read failed with status ${response.status}.`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return JSON.parse(payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text ?? 'null');
  },
});

const openAiReader = (apiKey: string, model: string): CompletionDocumentReader => ({
  name: 'openai',
  async read({ bytes, filename, mimeType }) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: [
          { type: 'input_file', filename, file_data: `data:${mimeType};base64,${bytes.toString('base64')}` },
          { type: 'input_text', text: COMPLETION_DOCUMENT_PROMPT },
        ] }],
        text: { format: { type: 'json_schema', name: 'completion_document', strict: false, schema: COMPLETION_DOCUMENT_RESPONSE_SCHEMA } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI completion document read failed with status ${response.status}.`);
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((part) => part.text)?.text ?? 'null';
    return JSON.parse(text);
  },
});

/** The AI reader chosen by DOCUMENT_AI_PROVIDER, or null when none is configured. */
export const createConfiguredCompletionDocumentReader = (): CompletionDocumentReader | null => {
  const provider = process.env.DOCUMENT_AI_PROVIDER?.trim().toLowerCase();
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    return geminiReader(process.env.GEMINI_API_KEY, process.env.GEMINI_DOCUMENT_MODEL || 'gemini-3.5-flash-lite');
  }
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return openAiReader(process.env.OPENAI_API_KEY, process.env.OPENAI_DOCUMENT_MODEL || 'gpt-4.1-mini');
  }
  return null;
};

const readFirstPageText = async (bytes: Buffer) => {
  try {
    return (await pdfParse(bytes, { max: 1 })).text ?? '';
  } catch {
    return '';
  }
};

export const analyseCompletionDocument = async (
  input: { bytes?: Buffer; filename: string; mimeType: string },
  dependencies: {
    reader?: CompletionDocumentReader | null;
    readText?: (bytes: Buffer) => Promise<string>;
  } = {},
): Promise<CompletionDocumentAnalysis> => {
  const reader = dependencies.reader === undefined ? createConfiguredCompletionDocumentReader() : dependencies.reader;
  const isPdf = input.mimeType === 'application/pdf' && Boolean(input.bytes?.length);
  if (reader && isPdf) {
    try {
      const answer = normaliseCompletionAnalysis(await reader.read({ bytes: input.bytes!, filename: input.filename, mimeType: input.mimeType }));
      if (answer) return { ...answer, source: 'ai' };
    } catch (error) {
      console.warn('Completion document AI read failed; using page text instead.', {
        provider: reader.name, reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  const text = isPdf ? await (dependencies.readText ?? readFirstPageText)(input.bytes!) : '';
  const role = recogniseCompletionDocument({ text, filename: input.filename });
  return { role, source: 'text', details: extractCompletionDetailsFromText(role, text) };
};
