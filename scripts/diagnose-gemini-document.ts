import fs from 'node:fs';
import path from 'node:path';
import { GEMINI_DOCUMENT_RESPONSE_SCHEMA } from '../src/server/services/pdf-classification.service';

const loadLocalEnv = () => {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
};

loadLocalEnv();

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error('Pass a local PDF path or --synthetic to the diagnostic script.');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

const model = process.env.GEMINI_DOCUMENT_MODEL?.trim() || 'gemini-3.5-flash-lite';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const createSyntheticPdf = () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Architect Portal Diagnostic Location Plan) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
};
const synthetic = pdfPath === '--synthetic';
const bytes = synthetic ? createSyntheticPdf() : fs.readFileSync(pdfPath);
const startsWithPdfMagic = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
const approximatePageCount = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
const pdfPart = {
  inlineData: {
    mimeType: 'application/pdf',
    data: bytes.toString('base64'),
  },
};

const minimalSchema = {
  type: 'object',
  required: ['categoryKey', 'detectedTitle'],
  properties: {
    categoryKey: {
      type: 'string',
      enum: [
        'location_plan',
        'site_block_plan',
        'existing_plans',
        'proposed_plans',
        'elevations',
        'sections',
        'drainage',
        'construction_details',
        'specifications',
        'calculations',
        'photographs',
        'supporting_documents',
        'other',
        'unsure',
      ],
    },
    detectedTitle: { type: ['string', 'null'] },
  },
} as const;

type DiagnosticCase = {
  name: string;
  prompt: string;
  generationConfig?: Record<string, unknown>;
};

const cases: DiagnosticCase[] = [
  {
    name: 'A - PDF without structured output',
    prompt: 'Return the main document title as plain text.',
  },
  {
    name: 'B - PDF with minimal structured schema',
    prompt: 'Classify the document and return its main title.',
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: minimalSchema,
    },
  },
  {
    name: 'C - PDF with current complete schema',
    prompt: 'Classify this architecture document using the supplied response schema.',
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: GEMINI_DOCUMENT_RESPONSE_SCHEMA,
    },
  },
];

const sanitiseProviderError = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return payload;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return payload;
  const providerError = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    details?: unknown;
  };
  return {
    code: providerError.code,
    message: providerError.message,
    status: providerError.status,
    details: providerError.details,
  };
};

console.log(JSON.stringify({
  endpoint,
  apiVersion: 'v1beta',
  model,
  requestMode: 'generateContent',
  pdf: {
    filename: synthetic ? 'synthetic-location-plan.pdf' : path.basename(pdfPath),
    byteLength: bytes.length,
    startsWithPdfMagic,
    mimeType: pdfPart.inlineData.mimeType,
    approximatePageCount,
    base64HasDataUrlPrefix: pdfPart.inlineData.data.startsWith('data:'),
  },
  schemaBytes: {
    minimal: Buffer.byteLength(JSON.stringify(minimalSchema)),
    complete: Buffer.byteLength(JSON.stringify(GEMINI_DOCUMENT_RESPONSE_SCHEMA)),
  },
}, null, 2));

for (const diagnostic of cases) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          pdfPart,
          { text: diagnostic.prompt },
        ],
      }],
      ...(diagnostic.generationConfig ? { generationConfig: diagnostic.generationConfig } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  console.log(JSON.stringify({
    test: diagnostic.name,
    structuredOutput: Boolean(diagnostic.generationConfig),
    status: response.status,
    ok: response.ok,
    providerError: response.ok ? undefined : sanitiseProviderError(payload),
  }, null, 2));
}
