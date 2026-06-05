import { createRequire } from 'node:module';
import { DocumentSortSource, DocumentType } from '@prisma/client';

type PdfParse = (dataBuffer: Buffer, options?: { max?: number }) => Promise<{ text?: string }>;

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as PdfParse;

type SortInput = {
  filename: string;
  mimeType?: string;
  bytes?: Buffer | Uint8Array;
  pdfText?: string;
  documentId?: string;
};

export type DocumentSortSuggestion = {
  documentId?: string;
  originalFilename: string;
  suggestedDocumentType: DocumentType;
  confidence: number;
  reason: string;
  matchedRules: string[];
  revision: string | null;
  drawingNumber: string | null;
  drawingTitle: string | null;
  source: DocumentSortSource;
  isLikelyCurrent: boolean;
  suitableForPlanning: boolean;
  suitableForBuildingWarrant: boolean;
};

type Rule = {
  type: DocumentType;
  points: number;
  phrases: string[];
  label: string;
  trueLocationPlan?: boolean;
};

type Match = {
  rule: Rule;
  phrase: string;
  points: number;
  source: DocumentSortSource;
};

const RULES: Rule[] = [
  {
    type: DocumentType.LOCATION_PLAN,
    points: 110,
    phrases: ['site location plan', 'location plan', 'ordnance survey', 'ukplanningmaps', 'os extract'],
    label: 'true location plan',
    trueLocationPlan: true,
  },
  { type: DocumentType.BLOCK_PLAN, points: 88, phrases: ['block plan'], label: 'block plan' },
  { type: DocumentType.SITE_PLAN, points: 86, phrases: ['site plan', 'site layout plan'], label: 'site plan' },
  {
    type: DocumentType.PROPOSED_DRAWING,
    points: 90,
    phrases: ['proposed plans', 'proposed plan', 'floor plan as proposed', 'proposed floor', 'proposed drawing', 'proposed layout'],
    label: 'proposed drawing',
  },
  {
    type: DocumentType.EXISTING_DRAWING,
    points: 90,
    phrases: ['existing plans', 'existing plan', 'existing elevations', 'existing drawing', 'existing layout'],
    label: 'existing drawing',
  },
  { type: DocumentType.ELEVATION, points: 85, phrases: ['elevations', 'elevation'], label: 'elevation' },
  { type: DocumentType.SECTION, points: 85, phrases: ['sections', 'section'], label: 'section' },
  { type: DocumentType.DETAILS, points: 84, phrases: ['details', 'detail', 'typical detail', 'drainage', 'suds', 'surface water', 'foul water'], label: 'details' },
  {
    type: DocumentType.CALCULATIONS,
    points: 82,
    phrases: ['structural', 'structure', 'beam calculation', 'engineer calculations', 'calculations', 'calculation'],
    label: 'calculations',
  },
  { type: DocumentType.CALCULATIONS, points: 82, phrases: ['u-value', 'u value', 'sap', 'energy', 'epc', 'thermal'], label: 'calculations' },
  {
    type: DocumentType.SPECIFICATIONS,
    points: 80,
    phrases: ['specification', 'specifications', 'report', 'statement', 'ser', 'certificate', 'certification', 'completion certificate'],
    label: 'specifications',
  },
  { type: DocumentType.PHOTO, points: 75, phrases: ['photo', 'photos', 'image', 'pic'], label: 'photo' },
  {
    type: DocumentType.CORRESPONDENCE,
    points: 72,
    phrases: ['letter', 'email', 'correspondence', 'response', 'consultation'],
    label: 'correspondence',
  },
  {
    type: DocumentType.DETAILS,
    points: 78,
    phrases: ['schedule'],
    label: 'details',
  },
];

const REV_PATTERNS = [
  /\b(?:rev(?:ision)?|r)\s*[-_ ]?\s*([a-z0-9]{1,4})\b/i,
  /\b(P\d{1,3}|C\d{1,3}|T\d{1,3})\b/i,
  /\b(?:revision|rev)\s*[:#]?\s*([A-Z])\b/i,
];

const REF_CANDIDATE_PATTERNS = [
  /\b(?=[A-Z0-9\-_]*\d)[A-Z0-9]{1,6}(?:[-_][A-Z0-9]{1,6}){1,8}\b/i,
  /\b[A-Z]{1,3}[-_ ]?\d{1,4}\b/i,
  /\b(?:SK|GA|DR|DRG|DWG|PL|EX|PR|P)\s*[-_ ]?\s*\d{1,4}\b/i,
];

const TITLE_HINTS = [
  'drawing title',
  'title',
  'project',
  'description',
  'proposed',
  'existing',
  'floor plan',
  'elevation',
  'section',
  'location plan',
  'site plan',
];

const PLANNING_TYPES = new Set<DocumentType>([
  DocumentType.LOCATION_PLAN,
  DocumentType.SITE_PLAN,
  DocumentType.BLOCK_PLAN,
  DocumentType.EXISTING_DRAWING,
  DocumentType.PROPOSED_DRAWING,
  DocumentType.ELEVATION,
  DocumentType.SECTION,
  DocumentType.DETAILS,
  DocumentType.SPECIFICATIONS,
]);

const WARRANT_TYPES = new Set<DocumentType>([
  DocumentType.LOCATION_PLAN,
  DocumentType.SITE_PLAN,
  DocumentType.BLOCK_PLAN,
  DocumentType.EXISTING_DRAWING,
  DocumentType.PROPOSED_DRAWING,
  DocumentType.ELEVATION,
  DocumentType.SECTION,
  DocumentType.DETAILS,
  DocumentType.CALCULATIONS,
  DocumentType.SPECIFICATIONS,
  DocumentType.DRAINAGE,
  DocumentType.STRUCTURAL,
  DocumentType.ENERGY,
  DocumentType.CERTIFICATE,
]);

const normalise = (text: string | null | undefined) =>
  (text ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripExtension = (filename: string) => filename.replace(/\.[^.]+$/, '');

const normaliseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/^[\s\-_.:,;()[\]{}]+|[\s\-_.:,;()[\]{}]+$/g, '');

const cleanFilenameTokens = (raw: string) => {
  let value = raw.replace(/[_\.]+/g, ' ').replace(/-{2,}/g, '-').replace(/-/g, ' ');
  for (const pattern of REV_PATTERNS) value = value.replace(pattern, '');
  value = value.replace(/\b(?:sheet|sh)\s*[-_ ]?\s*\d{1,3}\b/gi, '');
  value = value.replace(/\b20\d{2}[-_ ]?(?:0[1-9]|1[0-2])[-_ ]?(?:0[1-9]|[12]\d|3[01])\b/g, '');
  value = value.replace(/\b(?:scale|1:\s*\d+)\b/gi, '');
  return normaliseSpaces(value);
};

const extractFirstPageText = async (input: SortInput) => {
  if (input.pdfText !== undefined) return input.pdfText;
  if (!input.bytes || input.mimeType !== 'application/pdf') return '';

  try {
    const buffer = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    const parsed = await pdfParse(buffer, { max: 1 });
    return parsed.text ?? '';
  } catch {
    return '';
  }
};

const sourceHasPhrase = (source: string, phrase: string) => normalise(source).includes(phrase);

const collectMatches = (filenameBase: string, pdfText: string) => {
  const name = normalise(filenameBase);
  const text = normalise(pdfText);
  const matches: Match[] = [];

  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      const inName = sourceHasPhrase(name, phrase);
      const inText = sourceHasPhrase(text, phrase);
      if (!inName && !inText) continue;
      matches.push({
        rule,
        phrase,
        points: rule.points + (inName ? 20 : 0),
        source: inText && !inName ? DocumentSortSource.PDF_TEXT : DocumentSortSource.RULES,
      });
      break;
    }
  }

  return matches.sort((a, b) => b.points - a.points);
};

const confidenceFromScore = (score: number) => {
  if (score <= 0) return 0.2;
  return Math.min(0.98, Number((score / 130).toFixed(2)));
};

const extractRevision = (filenameBase: string, pdfText: string) => {
  const source = `${filenameBase}\n${pdfText}`;
  for (const pattern of REV_PATTERNS) {
    const match = pattern.exec(source);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
};

const bestReferenceFromText = (text: string) => {
  const upper = text.toUpperCase();
  for (const pattern of REF_CANDIDATE_PATTERNS) {
    const match = pattern.exec(upper);
    if (match?.[0]) return normaliseSpaces(match[0].toUpperCase());
  }
  return null;
};

const bestDescriptionFromPdfText = (pdfText: string) => {
  if (!pdfText) return null;
  const low = pdfText.toLowerCase();
  if (!TITLE_HINTS.some((hint) => low.includes(hint))) return null;

  const candidates = pdfText
    .split(/\r?\n/)
    .slice(0, 80)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 6 || line.length > 140) return false;
      const digitCount = [...line].filter((char) => /\d/.test(char)).length;
      if (digitCount > line.length * 0.6) return false;
      if (/^[A-Z0-9\-_/ ]{1,10}$/.test(line)) return false;
      return true;
    })
    .sort((a, b) => b.length - a.length);

  return candidates[0] ? normaliseSpaces(candidates[0]) : null;
};

const extractDrawingMetadata = (filenameBase: string, pdfText: string) => {
  const drawingNumber = bestReferenceFromText(filenameBase) ?? bestReferenceFromText(pdfText);
  const pdfTitle = bestDescriptionFromPdfText(pdfText);
  const filenameTitle = cleanFilenameTokens(filenameBase);
  const drawingWords = ['plan', 'elevation', 'section', 'layout', 'details', 'schedule', 'site', 'location'];
  const drawingTitle =
    pdfTitle && drawingWords.some((word) => pdfTitle.toLowerCase().includes(word))
      ? pdfTitle
      : filenameTitle || null;

  return {
    drawingNumber,
    drawingTitle: drawingTitle ? drawingTitle.slice(0, 160) : null,
  };
};

const revisionRank = (revision: string | null) => {
  if (!revision) return 0;
  const upper = revision.toUpperCase();
  const numbered = upper.match(/^[A-Z]?(\d{1,3})$/);
  if (numbered) return Number(numbered[1]);
  if (/^[A-Z]$/.test(upper)) return upper.charCodeAt(0) - 64;
  return 0;
};

const withPackageSuitability = (suggestion: Omit<DocumentSortSuggestion, 'suitableForPlanning' | 'suitableForBuildingWarrant'>): DocumentSortSuggestion => ({
  ...suggestion,
  suitableForPlanning: PLANNING_TYPES.has(suggestion.suggestedDocumentType),
  suitableForBuildingWarrant: WARRANT_TYPES.has(suggestion.suggestedDocumentType),
});

export const classifyDocument = async (input: SortInput): Promise<DocumentSortSuggestion> => {
  const filenameBase = stripExtension(input.filename);
  const pdfText = await extractFirstPageText(input);
  const matches = collectMatches(filenameBase, pdfText);
  const best = matches[0] ?? null;
  const revision = extractRevision(filenameBase, pdfText);
  const metadata = extractDrawingMetadata(filenameBase, pdfText);

  if (!best) {
    return withPackageSuitability({
      documentId: input.documentId,
      originalFilename: input.filename,
      suggestedDocumentType: DocumentType.OTHER,
      confidence: 0.2,
      reason: 'No usable filename or first-page PDF text match; needs manual review.',
      matchedRules: [],
      revision,
      drawingNumber: metadata.drawingNumber,
      drawingTitle: metadata.drawingTitle,
      source: DocumentSortSource.RULES,
      isLikelyCurrent: true,
    });
  }

  return withPackageSuitability({
    documentId: input.documentId,
    originalFilename: input.filename,
    suggestedDocumentType: best.rule.type,
    confidence: confidenceFromScore(best.points),
    reason: `Matched ${best.rule.label} phrase "${best.phrase}".`,
    matchedRules: matches.map((match) => `${match.rule.type}:${match.phrase}:${match.points}`),
    revision,
    drawingNumber: metadata.drawingNumber,
    drawingTitle: metadata.drawingTitle,
    source: best.source,
    isLikelyCurrent: true,
  });
};

const applyLocationPlanPriority = (suggestions: DocumentSortSuggestion[]) => {
  const trueLocationPlans = suggestions.filter(
    (suggestion) =>
      suggestion.suggestedDocumentType === DocumentType.LOCATION_PLAN &&
      suggestion.matchedRules.some((rule) => rule.includes('true location plan') || /LOCATION_PLAN:/.test(rule)),
  );

  if (trueLocationPlans.length > 0) {
    const [bestLocation, ...extraLocations] = trueLocationPlans.sort((a, b) => b.confidence - a.confidence);
    for (const suggestion of extraLocations) {
      suggestion.suggestedDocumentType = DocumentType.OTHER;
      suggestion.confidence = Math.min(suggestion.confidence, 0.54);
      suggestion.reason = `Possible extra location plan left for review because "${bestLocation.originalFilename}" is the strongest true Location Plan.`;
      suggestion.suitableForPlanning = true;
      suggestion.suitableForBuildingWarrant = true;
    }
    return suggestions;
  }

  const fallbackTypes: DocumentType[] = [DocumentType.SITE_PLAN, DocumentType.BLOCK_PLAN];
  const fallback = suggestions
    .filter((suggestion) => fallbackTypes.includes(suggestion.suggestedDocumentType))
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (fallback) {
    fallback.suggestedDocumentType = DocumentType.LOCATION_PLAN;
    fallback.confidence = Math.min(fallback.confidence, 0.72);
    fallback.reason = `${fallback.reason} Used as Location Plan fallback because no obvious true Location Plan was found.`;
    fallback.suitableForPlanning = true;
    fallback.suitableForBuildingWarrant = true;
  }

  return suggestions;
};

const applyCurrentRevisionFlags = (suggestions: DocumentSortSuggestion[]) => {
  const groups = new Map<string, DocumentSortSuggestion[]>();
  for (const suggestion of suggestions) {
    if (!suggestion.drawingNumber) continue;
    const key = suggestion.drawingNumber.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const latest = [...group].sort((a, b) => revisionRank(b.revision) - revisionRank(a.revision))[0];
    for (const suggestion of group) suggestion.isLikelyCurrent = suggestion === latest;
  }
};

export const classifyDocumentBatch = async (inputs: SortInput[]) => {
  const suggestions = await Promise.all(inputs.map((input) => classifyDocument(input)));
  applyLocationPlanPriority(suggestions);
  applyCurrentRevisionFlags(suggestions);
  return suggestions;
};

export const confidenceBand = (confidence: number) => {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
};
