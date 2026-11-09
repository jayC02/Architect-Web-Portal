import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { experimental_AstroContainer } from 'astro/container';

const now = new Date();
const defaultProject = { id: 'test-project', name: 'Test project', projectType: 'new_build', buildingUse: 'commercial',
  typeOfWorkKeys: ['new_build', 'domestic_alteration_extension', 'conversion_change_of_use', 'demolition'],
  client: { id: 'test-client', name: 'Saved Client' }, site: { addressLine1: 'Test Street', townCity: 'Test Town', postcode: 'AB1 2CD' } };
const delegates = {
  session: { findUnique: async () => ({ id: 'test-session', expiresAt: new Date(Date.now() + 91 * 86400000), lastSeenAt: now,
    user: { id: 'test-user', name: 'Test user', email: 'test@example.test', createdAt: now, updatedAt: now,
      organisationLinks: [{ role: 'OWNER', organisation: { id: 'test-org', name: 'Test organisation' } }] } }) },
  automationJob: { findMany: async () => [] }, organisationDefaults: { findUnique: async () => null },
  organisationCertifierPreset: { findMany: async () => [] }, projectDocument: { count: async () => 1 },
};
// The Prisma module keeps the first client it sees, so one proxy serves every render.
globalThis.prisma = new Proxy(delegates, { get(target, name) {
  if (name in target) return target[name];
  throw new Error(`Unexpected database delegate in isolated preparation form: ${String(name)}`);
} });

const buildOutput = '.vercel/output/functions/_render.func/dist/server';

const compiledScripts = async (filenames) => {
  const scripts = [];
  for (const filename of filenames) {
    const source = await fs.readFile(filename, 'utf8');
    const code = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
    const compiled = await build({ stdin: { contents: code, sourcefile: filename, resolveDir: path.resolve(path.dirname(filename)), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', alias: { '@': path.resolve('src') }, logLevel: 'silent' });
    scripts.push(compiled.outputFiles[0].text);
  }
  return scripts;
};

const builtCss = async () => {
  const assetDirectory = path.resolve('.vercel/output/static/_astro');
  const cssFiles = (await fs.readdir(assetDirectory)).filter(name => name.endsWith('.css'));
  return (await Promise.all(cssFiles.map(name => fs.readFile(path.join(assetDirectory, name), 'utf8')))).join('\n');
};

const renderPage = async (route, params, url) => {
  const page = await import(pathToFileURL(path.resolve(`${buildOutput}/pages/${route}.astro.mjs`)).href);
  const { renderers } = await import(pathToFileURL(path.resolve(`${buildOutput}/renderers.mjs`)).href);
  const container = await experimental_AstroContainer.create();
  container.addServerRenderer({ name: '@astrojs/react', renderer: renderers[0].ssr });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(page.page().default, { params, request: new Request(url, { headers: { cookie: 'architect_portal_session=isolated-test-session' } }) });
};

// Execute the production pages with isolated delegates. No real database connection is created.
export async function renderWarrantForm({ project = defaultProject, preparationData = { disabledPersonsFacilitiesOnly: false, designCertifierSelected: false, certifierOfDesignCertificateAvailable: false } } = {}) {
  delegates.buildingWarrantApplication = { findFirst: async () => ({ id: 'test-warrant', projectId: project.id, project, description: 'Test conversion, construction and demolition',
    estimatedValue: 35000, currentUse: 'Existing building', proposedUse: 'Proposed building', selectedCertifierPreset: null, preparationData }) };
  const html = await renderPage('building-warrant/_id_/preparation', { id: 'test-warrant' }, 'https://example.test/building-warrant/test-warrant/preparation');
  const form = html.match(/<form\b[^>]*data-action="\/api\/building-warrant\/[^"]*\/certifier-details"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'The production preparation form rendered with the isolated session.');
  const scripts = await compiledScripts(['src/components/forms/WarrantOwnerDetails.astro', 'src/components/forms/WarrantFollowUps.astro', 'src/components/forms/WarrantBranchFields.astro', 'src/pages/building-warrant/[id]/preparation.astro']);
  return { html, form, scripts, css: await builtCss() };
}

export async function renderPlanningForm({ project = defaultProject, preparationData = {} } = {}) {
  delegates.planningApplication = { findFirst: async () => ({ id: 'test-planning', projectId: project.id, project, description: 'Test householder extension', preparationData }) };
  const html = await renderPage('planning/_id_/preparation', { id: 'test-planning' }, 'https://example.test/planning/test-planning/preparation');
  const form = html.match(/<form\b[^>]*data-action="\/api\/planning\/[^"]*\/complete-details"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'The production Planning form rendered with the isolated session.');
  const scripts = await compiledScripts(['src/pages/planning/[id]/preparation.astro']);
  return { html, form, scripts, css: await builtCss() };
}
