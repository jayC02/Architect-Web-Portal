import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { prisma } from '../src/lib/db/prisma';
import { PATCH } from '../src/pages/api/documents/[id]';
import { paperSizeFromAudit, reconcilePaperSize } from '../src/lib/document-paper-size';

const originals = { session: prisma.session.findUnique, find: prisma.projectDocument.findFirst, update: prisma.projectDocument.updateMany };
let update: any; let missing = false; let changed = false; let reads = 0;
const current = { updatedAt: new Date('2026-11-15T12:00:00Z'), analysisResult: { classification: {
  evidence: 'Original drawing evidence', extractedFacts: [{ value: 'preserve' }],
  paperSize: reconcilePaperSize({ value: 'A1', certainty: 'high', evidence: 'Title block A1', page: 1, mixedSizes: false }, ['A3']),
} } };
const context = (body: unknown, origin = 'http://localhost') => ({
  params: { id: 'document-one' }, url: new URL('http://localhost/api/documents/document-one'),
  request: new Request('http://localhost/api/documents/document-one', { method: 'PATCH',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }),
  cookies: { get: () => ({ value: 'test-session' }) }, locals: {}, clientAddress: '127.0.0.1',
}) as unknown as APIContext;
try {
  Object.assign(prisma.session, { findUnique: async () => ({ id: 'session', expiresAt: new Date(Date.now() + 90 * 86400000), lastSeenAt: new Date(),
    user: { id: 'user', organisationLinks: [{ role: 'MEMBER', organisation: { id: 'current-org' } }] } }) });
  Object.assign(prisma.projectDocument, {
    findFirst: async (query: any) => { reads++; assert.deepEqual(query.where, { id: 'document-one', organisationId: 'current-org' }); return missing ? null : current; },
    updateMany: async (query: any) => { update = query; return { count: changed ? 0 : 1 }; },
  });
  assert.equal((await PATCH(context({ paperSize: 'A3' }))).status, 200);
  assert.equal(paperSizeFromAudit(update.data.analysisResult)?.value, 'A3');
  assert.equal(update.data.analysisResult.classification.evidence, 'Original drawing evidence');
  assert.equal(update.data.analysisResult.classification.extractedFacts[0].value, 'preserve');
  assert.equal('type' in update.data, false, 'confirming paper size must not reset the category');
  assert.equal('status' in update.data, false, 'confirming paper size must not reset approval');
  assert.equal(update.where.updatedAt.toISOString(), current.updatedAt.toISOString());
  changed = true;
  assert.equal((await PATCH(context({ paperSize: 'A4' }))).status, 409, 'concurrent analysis must not be overwritten');
  changed = false; missing = true;
  assert.equal((await PATCH(context({ paperSize: 'A4' }))).status, 404);
  missing = false;
  const before = reads;
  assert.equal((await PATCH(context({ paperSize: 'GA100' }))).status, 400);
  assert.equal((await PATCH(context({ paperSize: 'A3' }, 'https://untrusted.example'))).status, 403);
  assert.equal(reads, before);
  assert.equal((await PATCH(context({ notes: 'Reviewed' }))).status, 200);
  assert.equal('analysisResult' in update.data, false, 'unrelated metadata changes preserve the analysis');
  console.log('Paper-size review API: organisation scope, confirmation, preserved metadata, concurrency and validation passed.');
} finally {
  Object.assign(prisma.session, { findUnique: originals.session });
  Object.assign(prisma.projectDocument, { findFirst: originals.find, updateMany: originals.update });
}
