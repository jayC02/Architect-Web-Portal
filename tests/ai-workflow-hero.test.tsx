import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiWorkflowPreview, { AI_WORKFLOW_STAGES } from '../src/components/auth/AiWorkflowPreview';

const authEntry = fs.readFileSync('src/components/auth/AuthEntryScreen.astro', 'utf8');
const previewSource = fs.readFileSync('src/components/auth/AiWorkflowPreview.tsx', 'utf8');

assert.match(authEntry, /AI-powered practice automation/);
assert.match(authEntry, /Projects, applications and AI-powered automation in one workspace\./);
assert.match(authEntry, /Upload project documents, review AI-generated suggestions and prepare planning and building warrant applications with less manual work\./);
assert.match(authEntry, /data-action="\/api\/auth\/login"/, 'the sign-in form remains rendered');
assert.match(authEntry, /<GoogleAuthButton \/>/, 'Google sign-in remains rendered');

const renderStage = (initialStage?: (typeof AI_WORKFLOW_STAGES)[number]['id']) => renderToStaticMarkup(
  <AiWorkflowPreview initialStage={initialStage} autoAdvance={false} />,
);

const upload = renderStage();
assert.match(upload, /data-active-stage="upload"/);
assert.match(upload, /Proposed Elevations\.pdf/);
assert.match(upload, /3 PDFs selected/);
for (const stage of AI_WORKFLOW_STAGES) {
  assert.match(upload, new RegExp(`type="button"[^>]*>${stage.id === 'upload' ? '[\\s\\S]*?' : '[\\s\\S]*?'}${stage.label}`));
}
assert.equal((upload.match(/aria-pressed="true"/g) ?? []).length, 1, 'only the default stage is active');

const analysis = renderStage('analysis');
assert.match(analysis, /data-active-stage="analysis"/);
assert.match(analysis, /Analysing documents\.\.\./);
assert.equal((analysis.match(/aria-pressed="true"/g) ?? []).length, 1);

const review = renderStage('review');
assert.match(review, /data-active-stage="review"/);
assert.match(review, /Suggested categories/);
assert.match(review, /Elevations/);
assert.match(review, /Location \/ Site Plan/);
assert.match(review, /Review before applying/);
assert.match(review, /Edit suggestion/);
assert.match(review, /Approve/);
assert.equal((review.match(/aria-pressed="true"/g) ?? []).length, 1);

const prepare = renderStage('prepare');
assert.match(prepare, /data-active-stage="prepare"/);
assert.match(prepare, /Application data ready/);
assert.match(prepare, /Ready for desktop automation/);
assert.equal((prepare.match(/aria-pressed="true"/g) ?? []).length, 1);

assert.match(previewSource, /setInterval/);
assert.match(previewSource, /4500/);
assert.match(previewSource, /clearInterval/);
assert.match(previewSource, /onMouseEnter/);
assert.match(previewSource, /prefers-reduced-motion: reduce/);
assert.match(previewSource, /if \(!autoAdvance \|\| reducedMotion \|\| hovered\)/);

console.log('AI workflow hero regression tests passed');
