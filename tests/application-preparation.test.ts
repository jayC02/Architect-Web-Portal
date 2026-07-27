import assert from 'node:assert/strict';
import {
  documentAnalysisCacheMatches,
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_ANALYSIS_VERSION,
  pdfClassificationResultSchema,
} from '../src/server/services/pdf-classification.service';
import { synthesiseFieldSuggestion } from '../src/server/services/application-preparation.service';
import { documentIntelligenceResultSchema } from '../src/lib/validation/document-intelligence';

const fact = {
  documentId: 'doc-1',
  filename: 'planning-statement.pdf',
  fieldKey: 'site.postcode',
  value: 'G12 3BA',
  page: 2,
  evidence: 'Site address: 8 Trunky Tree, Glasgow, G12 3BA',
  certainty: 'high' as const,
};

const existing = synthesiseFieldSuggestion('site.postcode', 'G12 3AB', [fact]);
assert.equal(existing.suggestion.value, 'G12 3AB', 'existing portal values remain authoritative');
assert.equal(existing.suggestion.status, 'conflict', 'a conflicting document value is retained for review');
assert.equal(existing.conflict?.suggestedValue, 'G12 3BA');

const missing = synthesiseFieldSuggestion('site.postcode', null, [fact]);
assert.equal(missing.suggestion.value, 'G12 3BA', 'high-confidence evidence fills a missing value');
assert.equal(missing.suggestion.status, 'suggested');
assert.equal(missing.suggestion.sources[0]?.page, 2);

assert.doesNotThrow(() => documentIntelligenceResultSchema.parse({
  documentId: 'doc-1',
  classification: {
    categoryKey: 'supporting_documents',
    categoryLabel: 'Supporting Documents',
    certainty: 'high',
    manualReviewRequired: false,
  },
  metadata: { existingOrProposed: 'unknown' },
  extractedFacts: [{
    fieldKey: fact.fieldKey,
    value: fact.value,
    page: fact.page,
    evidence: fact.evidence,
    certainty: fact.certainty,
  }],
  warnings: [],
  mixedDocumentDetected: false,
}));
assert.throws(() => pdfClassificationResultSchema.parse({
  categoryKey: 'location_plan',
  certainty: 'high',
  manualReviewRequired: false,
  warnings: [],
  existingOrProposed: 'unknown',
  mixedDocumentDetected: false,
  extractedFacts: [{
    fieldKey: 'legal.ownerConfirmed',
    value: true,
    evidence: 'Owner is mentioned.',
    certainty: 'high',
  }],
}), 'unsupported legal declarations are rejected by the strict schema');

const cached = {
  fileHash: 'same-hash',
  analysisVersion: DOCUMENT_ANALYSIS_VERSION,
  analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
  analysisStatus: 'SUCCESS',
};
assert.equal(documentAnalysisCacheMatches(cached, 'same-hash'), true);
assert.equal(documentAnalysisCacheMatches(cached, 'changed-hash'), false, 'changed files are reanalysed');
assert.equal(documentAnalysisCacheMatches({ ...cached, analysisPromptVersion: 'new-prompt' }, 'same-hash'), false);

console.log('application preparation tests passed');
