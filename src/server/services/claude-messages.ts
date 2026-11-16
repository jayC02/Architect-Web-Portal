// Shared helpers for reading PDFs with Claude through the Anthropic Messages API.
// Used by the PDF classifier and the completion document reader.

export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2026-10-21';
export const DEFAULT_ANTHROPIC_DOCUMENT_MODEL = 'claude-haiku-5-5';

// Output budget for one document. Thinking counts towards it, so leave room
// beyond the JSON answer itself.
export const ANTHROPIC_DOCUMENT_MAX_TOKENS = 16_000;

const ANTHROPIC_EFFORTS = ['low', 'medium', 'high'] as const;
export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

/** ANTHROPIC_DOCUMENT_EFFORT, or "medium" (Haiku's default) when unset or not recognised. */
export const configuredAnthropicEffort = (): AnthropicEffort => {
  const configured = process.env.ANTHROPIC_DOCUMENT_EFFORT?.trim().toLowerCase();
  return ANTHROPIC_EFFORTS.find((effort) => effort === configured) ?? 'medium';
};

export const configuredAnthropicModel = () =>
  process.env.ANTHROPIC_DOCUMENT_MODEL?.trim() || DEFAULT_ANTHROPIC_DOCUMENT_MODEL;

export const anthropicHeaders = (apiKey: string) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': ANTHROPIC_API_VERSION,
});

/**
 * Claude's structured outputs require `additionalProperties: false` on every
 * object. Returns a copy of a JSON schema with that added; enum values are left alone.
 */
export const toClaudeJsonSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(toClaudeJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const copy: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, key === 'enum' ? value : toClaudeJsonSchema(value)]),
  );
  return copy.type === 'object' ? { ...copy, additionalProperties: false } : copy;
};

export const pdfDocumentBlock = (bytes: Buffer) => ({
  type: 'document' as const,
  source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: bytes.toString('base64') },
});

export type ClaudeMessageResponse = {
  stop_reason?: string | null;
  content?: Array<{ type?: string; text?: string }>;
};

/** The JSON text of a structured-output reply, or a reason it can't be used. */
export const claudeResponseText = (payload: ClaudeMessageResponse):
  { ok: true; text: string } | { ok: false; reason: 'refusal' | 'max_tokens' | 'empty' } => {
  if (payload.stop_reason === 'refusal') return { ok: false, reason: 'refusal' };
  if (payload.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' };
  const text = payload.content?.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
  return text ? { ok: true, text } : { ok: false, reason: 'empty' };
};

export const claudeErrorDetails = async (response: Response) => {
  const payload = await response.json().catch(() => null) as {
    error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } };
  } | null;
  const message = typeof payload?.error?.message === 'string'
    ? payload.error.message.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
  const errorType = typeof payload?.error?.type === 'string' ? payload.error.type : undefined;
  const errorCode = typeof payload?.error?.details?.error_code === 'string' ? payload.error.details.error_code : undefined;
  return { message, errorType, errorCode };
};

/** Picks the allowed value that matches ignoring case; Claude can vary enum capitalisation. */
export const matchEnumIgnoringCase = <T extends string>(value: unknown, allowed: readonly T[]) =>
  typeof value === 'string'
    ? allowed.find((option) => option.toLowerCase() === value.trim().toLowerCase()) ?? value
    : value;
