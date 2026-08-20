import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const projectPage = source('src/pages/projects/[id].astro');
const editor = source('src/components/projects/ProjectLinkedRecordEditor.tsx');
const shared = source('src/components/live/DirectoryEditor.tsx');
const layout = source('src/layouts/BaseLayout.astro');
const clientRoute = source('src/pages/api/clients/[id].ts');
const siteRoute = source('src/pages/api/sites/[id].ts');
const snapshotService = source('src/server/services/automation-jobs.service.ts');

assert.match(projectPage, /ProjectLinkedRecordEditor client:load client=\{clientEditorRecord\} site=\{siteEditorRecord\}/);
assert.doesNotMatch(projectPage, /href=\{project\.client \? `\/clients/);
assert.doesNotMatch(projectPage, /href=\{project\.site \? `\/sites/);

assert.match(editor, /onClick=\{\(\) => setEditing\('client'\)\}/);
assert.match(editor, /onClick=\{\(\) => setEditing\('site'\)\}/);
assert.match(editor, /<ClientForm client=\{client\} onClose=\{\(\) => setEditing\(null\)\}/);
assert.match(editor, /<SiteForm site=\{site\} onClose=\{\(\) => setEditing\(null\)\}/);
assert.match(editor, /setEditing\(null\)/, 'Cancel closes the editor without changing local record state');
assert.match(editor, /portal:mutation-success/, 'Successful saves close and update the in-place editor');
assert.match(editor, /setClient\(\(current\) => current \? \{ \.\.\.current, \.\.\.values \}/);
assert.match(editor, /setSite\(\(current\) => current \? \{ \.\.\.current, \.\.\.values \}/);
assert.match(shared, /data-api-form data-field-errors/);
assert.match(shared, /data-action=\{editing \? `\/api\/clients/);
assert.match(shared, /data-action=\{editing \? `\/api\/sites/);

assert.match(clientRoute, /requireOrganisation\(context\)/);
assert.match(clientRoute, /where: \{ id, organisationId: organisation\.id \}/);
assert.match(siteRoute, /requireOrganisation\(context\)/);
assert.match(siteRoute, /where: \{ id, organisationId: organisation\.id \}/);
assert.match(layout, /portal:mutation-success.*values/s, 'Form failures do not emit success, so the editor stays open');
assert.match(snapshotService, /snapshot|dataSnapshot|automation/, 'Existing automation snapshot service remains the source of frozen job data');

console.log('project inline edit tests passed');
