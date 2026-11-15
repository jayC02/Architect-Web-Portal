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
assert.doesNotMatch(form.replace(/function LimitedText[\s\S]*?\r?\n}\r?\n/, ''), /<textarea/, 'no unlimited textarea');
// Uploads: several files at once, existing project documents, and a type chooser for each.
assert.match(form, /type="file" multiple/);
assert.match(form, /`\$\{endpoint\}\/documents`/);
assert.match(form, /Add a document already in this project/);
assert.match(form, /COMPLETION_DOCUMENT_ROLES/);
assert.match(form, /applyCompletionDocuments\(preparation\)/, 'answers shown are the ones that will be sent');
assert.match(form, /upload the granted building warrant/);
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
assert.match(form, /notice references', 'N\/A'/, 'the review table matches what the Agent enters');
assert.match(form, /Missing information/);
assert.doesNotMatch(form, /Does a copy of an Energy Performance Certificate/, 'EPC is answered by uploading, not by hand');
// The Agent reports a finished run as COMPLETED; both finished statuses read as ready to submit.
assert.match(form, /COMPLETED: 'Ready to submit/);
assert.match(form, /AWAITING_PORTAL_REVIEW: 'Ready to submit/);
assert.match(form, /FINISHED_STATUSES/);
// The work-completed date is never defaulted.
assert.doesNotMatch(form, /workCompletedDate:\s*new Date|workCompletedDate\s*\?\?\s*today/);

// The page is organisation-scoped and server-rendered from the completion service.
assert.match(page, /requirePageAuth/);
assert.match(page, /loadCompletionContext/);
assert.match(page, /organisationId: auth\.organisation\.id/);
assert.match(page, /CompletionCertificateForm/);
assert.match(page, /AutomationJobType\.COMPLETION_CERTIFICATE/);

// Its own tile on the project page, alongside Planning and Building Warrant,
// available once the warrant has been submitted.
assert.match(project, /<ApplicationSummaryCard\s+id="completion-certificate"/);
assert.match(project, /applicationKind="COMPLETION_CERTIFICATE"/);
assert.match(project, /completion-certificate\/preparation/);
assert.match(project, /completionWarrantStatuses/);
assert.match(project, /types: \[AutomationJobType\.COMPLETION_CERTIFICATE\]/, 'the tile shows the completion run for the warrant');
assert.doesNotMatch(card, /completionHref/, 'the Building Warrant tile no longer carries the completion button');
assert.match(card, /'COMPLETION_CERTIFICATE'/);
const status = readFileSync('src/components/automation/DesktopAutomationStatus.astro', 'utf8');
assert.match(status, /Prepare Completion Certificate/, 'with no run yet the tile offers to prepare one');
assert.match(status, /available once the building warrant has been submitted/i);
const live = readFileSync('src/components/automation/DesktopAutomationLiveCard.tsx', 'utf8');
assert.match(live, /'COMPLETION_CERTIFICATE'/, 'the live card follows completion runs like the others');
assert.match(live, /if \(isCompletion\) \{ window\.location\.assign\(manageHref\); return; \}/, 'a completion certificate is sent again from its own page');
assert.match(live, /!isCompletion && <button ref=\{markSubmittedButtonRef\}/, 'no Mark as submitted for a completion certificate');

// Sending it returns to the project, where the tile shows it queued.
const run = readFileSync('src/pages/api/building-warrant/[id]/completion-certificate/run.ts', 'utf8');
assert.match(run, /redirectTo: `\/projects\/\$\{encodeURIComponent\(queued\.projectId\)\}#completion-certificate`/);
assert.doesNotMatch(run, /preparation\?job=/);
assert.match(readFileSync('src/server/services/completion-certificate.service.ts', 'utf8'), /return \{ jobId: queued\.jobId, projectId: queued\.projectId,/);


// The form runs in the browser: the modules it imports must not load the
// database client at runtime (the production bundle cannot resolve it, and
// the whole form then stops working). Type-only imports are fine.
for (const file of ['src/lib/completion-certificate.ts', 'src/lib/completion-documents.ts', 'src/lib/certifier-registration.ts']) {
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /^import\s+(?!type\b)[^;]*from\s+'@prisma\/client'/m, `${file} must not import @prisma/client at runtime`);
}

// Files can be dropped onto the upload box as well as chosen by clicking it.
assert.match(form, /onDragOver=\{\(event\) => \{ event\.preventDefault\(\)/);
assert.match(form, /onDrop=\{\(event\) => \{ event\.preventDefault\(\);[^}]*uploadFiles\(event\.dataTransfer\.files\)/);
assert.match(form, /Drop files here or click to choose/);

// An upload problem is shown next to the upload box, not only at the foot of the form.
assert.match(form, /uploadError && <p role="alert"/);

// Changes save themselves: no Save button, a short pause after the last change,
// one save at a time, and sending waits for anything not yet saved.
assert.doesNotMatch(form, />\s*\{saving \? 'Saving…' : 'Save'\}/, 'there is no Save button');
assert.match(form, /AUTOSAVE_DELAY_MS = \d+/);
assert.match(form, /saveInFlight/);
assert.match(form, /await flush\(\)/);
assert.match(form, /'All changes saved'/);
assert.match(form, /beforeunload/);

console.log('completion-certificate-ui: ok');
