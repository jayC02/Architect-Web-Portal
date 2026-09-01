import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const shell = source('src/components/layout/AppShell.astro');
const projects = source('src/pages/projects/index.astro');
const clients = source('src/pages/clients.astro');
const sites = source('src/pages/sites.astro');
const projectsSectionNavigation = source('src/components/projects/ProjectsSectionNavigation.astro');

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

assert.match(projects, /<ProjectsSectionNavigation active="projects" \/>/, 'Projects exposes the shared directory navigation with Projects active');
assert.match(clients, /<ProjectsSectionNavigation active="clients" \/>/, 'Clients exposes the shared directory navigation with Clients active');
assert.match(sites, /<ProjectsSectionNavigation active="sites" \/>/, 'Sites exposes the shared directory navigation with Sites active');
assert.match(projectsSectionNavigation, /aria-label="Project directories"/, 'the shared row has an accessible navigation label');
assert.match(projectsSectionNavigation, /href: '\/projects'[\s\S]*href: '\/clients'[\s\S]*href: '\/sites'/, 'all three existing routes remain available');
assert.match(projectsSectionNavigation, /aria-current=\{isActive \? 'page' : undefined\}/, 'the current directory is exposed accessibly');
assert.match(projectsSectionNavigation, /flex flex-wrap gap-2/, 'the secondary row wraps cleanly on small screens');
assert.match(projectsSectionNavigation, /px-4 py-2 text-sm font-medium/, 'the compact tabs have comfortable padding and medium weight');
assert.match(projectsSectionNavigation, /focus-visible:ring-2[\s\S]*hover:border-stone-300/, 'keyboard focus and hover states are explicit');

for (const route of ['clients.astro', 'sites.astro', 'deadlines.astro', 'email-updates.astro', 'dashboard.astro']) {
  assert.equal(existsSync(new URL(`../src/pages/${route}`, import.meta.url)), true, `${route} remains available`);
}
for (const child of ['practice.astro', 'certifiers.astro', 'integrations.astro', 'preferences.astro']) {
  assert.equal(existsSync(new URL(`../src/pages/settings/${child}`, import.meta.url)), true, `Settings child ${child} remains available`);
}

console.log('primary navigation tests passed');
