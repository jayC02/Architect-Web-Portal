import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authEntryPath = path.join(projectRoot, 'src/components/auth/AuthEntryScreen.astro');
const showcasePath = path.join(projectRoot, 'src/components/auth/ProductScreenshotShowcase.astro');
const oldPreviewPath = path.join(projectRoot, 'src/components/auth/AiWorkflowPreview.tsx');
const authEntry = fs.readFileSync(authEntryPath, 'utf8');
const showcase = fs.readFileSync(showcasePath, 'utf8');

assert.match(authEntry, /AI-powered document and application automation/);
assert.match(authEntry, /Upload your project once\. Let AI prepare the application\./);
assert.match(authEntry, /Store and organise every project document, then use Architect Pro AI to prepare planning permission and building warrant applications for review\./);

assert.match(authEntry, /<ProductScreenshotShowcase \/>/, 'the real product screenshot showcase renders');
assert.match(showcase, /aria-current="true"/);
assert.match(showcase, />\s*Application\s*</, 'Application is the default screenshot');
assert.match(showcase, /src="\/product\/sign-in-application\.png"/);
assert.match(showcase, /loading="eager"/);
assert.match(showcase, /Architect Pro planning or building warrant application prepared from project information/);
assert.match(showcase, /Use stored project information and reviewed documents to prepare the application automatically\./);

assert.doesNotMatch(authEntry, /AiWorkflowPreview/);
assert.equal(fs.existsSync(oldPreviewPath), false, 'the fake workflow component is removed');
assert.doesNotMatch(authEntry + showcase, /Proposed Elevations\.pdf|AI analyses the files|Suggested categories|Prepare automation/);

assert.match(authEntry, /data-action="\/api\/auth\/login"/, 'the sign-in form remains rendered');
assert.match(authEntry, /<GoogleAuthButton \/>/, 'Google sign-in remains rendered');
assert.match(authEntry, /href="\/forgot-password"/);
assert.match(authEntry, /href="\/register"/);
assert.match(authEntry, /prefers-reduced-motion: reduce/);

console.log('Sign-in screenshot showcase regression tests passed');
