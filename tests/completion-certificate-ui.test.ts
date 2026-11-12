import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync('src/components/applications/CompletionCertificateForm.tsx', 'utf8');
const page = readFileSync('src/pages/building-warrant/[id]/completion-certificate/preparation.astro', 'utf8');
const card = readFileSync('src/components/projects/ApplicationSummaryCard.astro', 'utf8');
const project = readFileSync('src/pages/projects/[id].astro', 'utf8');

// Registration prefixes come from the shared portal constants, never retyped.
assert.match(form, /registerPart1Codes/);
assert.doesNotMatch(form, /'NIC1'|'SEL1'|'SNP1'|'BRE1'/);
// Both 750-character portal limits are enforced in the browser too.
assert.match(form, /<textarea[^>]*maxLength=\{COMPLETION_TEXT_LIMIT\}/);
assert.equal((form.match(/<LimitedText\b/g) ?? []).length, 2, 'amendment dates and continuing requirements share the limited field');
assert.doesNotMatch(form.replace(/function LimitedText[\s\S]*?\n}\n/, ''), /<textarea/, 'no unlimited textarea');
assert.match(form, /MAX_CERTIFICATE_ENTRIES/);
// Save and queue use the completion endpoints only.
assert.match(form, /const endpoint = `\/api\/building-warrant\/\$\{encodeURIComponent\(warrantId\)\}\/completion-certificate`/);
assert.match(form, /`\$\{endpoint\}\/preparation`/);
assert.match(form, /`\$\{endpoint\}\/run`/);
assert.doesNotMatch(form, /\/api\/projects\/.*automation-jobs/);
// Queueing is blocked while details are missing or unsaved, and cannot be double-submitted.
assert.match(form, /disabled=\{[^}]*issues\.length[^}]*\}/);
assert.match(form, /dirty/);
assert.match(form, /queueInFlight/);
// The architect sees the fixed answers and what is missing.
assert.match(form, /Fixed answers/);
assert.match(form, /Missing information/);
assert.match(form, /Uploaded in a later step/);
// The Agent reports a finished run as COMPLETED; both finished statuses read as Main Details completed.
assert.match(form, /COMPLETED: 'Main Details completed/);
assert.match(form, /AWAITING_PORTAL_REVIEW: 'Main Details completed/);
assert.match(form, /FINISHED_STATUSES/);
// The work-completed date is never defaulted.
assert.doesNotMatch(form, /workCompletedDate:\s*new Date|workCompletedDate\s*\?\?\s*today/);

// The page is organisation-scoped and server-rendered from the completion service.
assert.match(page, /requirePageAuth/);
assert.match(page, /loadCompletionContext/);
assert.match(page, /organisationId: auth\.organisation\.id/);
assert.match(page, /CompletionCertificateForm/);
assert.match(page, /AutomationJobType\.COMPLETION_CERTIFICATE/);

// Entry point on the Building Warrant card, only once the warrant has been submitted.
assert.match(card, /Prepare Completion Certificate/);
assert.match(card, /completionHref/);
assert.match(project, /completionHref=/);
assert.match(project, /completion-certificate\/preparation/);
assert.match(project, /completionWarrantStatuses/);

console.log('completion-certificate-ui: ok');
