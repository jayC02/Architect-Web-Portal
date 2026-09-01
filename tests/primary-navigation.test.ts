import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const shell = source('src/components/layout/AppShell.astro');
const projects = source('src/pages/projects/index.astro');

for (const label of ['Today', 'Projects', 'Calendar', 'Finance']) {
  assert.match(shell, new RegExp(`label: '${label}'`), `primary navigation includes ${label}`);
}
assert.match(shell, /label: 'New application'/, 'New application remains available');
assert.match(shell, /btn btn-primary w-full justify-start/, 'desktop New application is a distinct primary action');
assert.match(shell, /btn btn-primary min-h-10/, 'mobile New application is a distinct primary action');
assert.match(shell, /aria-current=\{isActive\(newApplication\) \? 'page' : undefined\}/, 'the application creation flow exposes its active state');
assert.match(shell, /label: 'Settings'[\s\S]*activePrefixes: \['\/settings', '\/automation-jobs'\]/, 'Settings, its child routes and job history share one active parent');
assert.match(shell, /aria-label="Secondary navigation"[\s\S]*<span>Settings<\/span>/, 'desktop Settings is visually separated from daily navigation');

for (const removedLabel of ['Dashboard', 'Clients', 'Sites', 'Deadlines', 'Email Updates']) {
  assert.doesNotMatch(shell, new RegExp(`label: '${removedLabel}'`), `${removedLabel} is not a primary navigation item`);
}

assert.match(shell, /\['OWNER', 'ADMIN'\]\.includes\(role\)[\s\S]*label: 'Finance'/, 'Finance keeps the existing owner/admin permission gate');
assert.match(shell, /label: 'Today'[\s\S]*activePrefixes: \['\/dashboard', '\/email-updates'\]/, 'Dashboard and Email Updates resolve to Today');
assert.match(shell, /label: 'Projects'[\s\S]*activePrefixes: \['\/projects', '\/clients', '\/sites', '\/planning', '\/building-warrant', '\/automation-job'\]/, 'project, client, site and application detail routes resolve to Projects');
assert.match(shell, /label: 'Calendar'[\s\S]*activePrefixes: \['\/calendar', '\/deadlines'\]/, 'Deadline routes resolve to Calendar');

assert.match(shell, /aria-label="Mobile navigation"[\s\S]*\[\.\.\.primaryNav, settingsNav\]/, 'mobile navigation reuses the simplified hierarchy');
assert.match(shell, /grid grid-cols-3 gap-2 sm:grid-cols-5/, 'mobile navigation wraps into a compact grid');
assert.doesNotMatch(shell, /overflow-x-auto/, 'mobile primary navigation no longer scrolls horizontally');

assert.match(projects, /aria-label="Project directories"/, 'Projects exposes its secondary directories');
assert.match(projects, /href="\/clients"[\s\S]*>Clients<\/a>/, 'Clients remains reachable from Projects');
assert.match(projects, /href="\/sites"[\s\S]*>Sites<\/a>/, 'Sites remains reachable from Projects');

for (const route of ['clients.astro', 'sites.astro', 'deadlines.astro', 'email-updates.astro', 'dashboard.astro']) {
  assert.equal(existsSync(new URL(`../src/pages/${route}`, import.meta.url)), true, `${route} remains available`);
}
for (const child of ['practice.astro', 'certifiers.astro', 'integrations.astro', 'preferences.astro']) {
  assert.equal(existsSync(new URL(`../src/pages/settings/${child}`, import.meta.url)), true, `Settings child ${child} remains available`);
}

console.log('primary navigation tests passed');
