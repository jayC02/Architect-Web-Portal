// Browser fixture for the production review component. Uses no database or paid APIs.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.mjs';
import { readFileSync } from 'node:fs';
const person = { clientType: 'INDIVIDUAL', displayName: 'Alex Example', title: 'Ms', firstName: 'Alex', lastName: 'Example',
  companyName: null, email: 'alex@example.test', phone: null, buildingNumber: null, addressLine1: null, addressLine2: null,
  townCity: null, postcode: null, country: 'United Kingdom' };
const initialReview = { selectedApplicationType: 'HOUSEHOLDER_PLANNING', projectMode: 'create', existingProjectId: null,
  project: { name: 'Address test', internalReference: null, typeOfWorkKey: null, summary: null }, siteMode: 'create', existingSiteId: null,
  site: { buildingNumber: null, addressLine1: '105 Ralston Avenue', addressLine2: null, townCity: 'Crookston', postcode: null, country: 'United Kingdom', localAuthority: null },
  clientMode: 'create', existingClientId: null, client: person, clientAddressSameAsSite: true, applicantDifferentFromClient: false, applicant: person,
  agent: { practiceName: 'Example', firstName: 'Agent', lastName: 'Example', email: 'agent@example.test', phone: null,
    buildingNumber: '1', addressLine1: 'Practice Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', saveAsOrganisationDefault: false },
  application: { description: 'Construct a rear extension.', currentUse: null, proposedUse: null, estimatedValue: null,
    presetKey: null, typeOfWorkKeys: [], selectedCertifierPresetId: null },
  confirmations: { applicationFee: 325, discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false, soleOwner: true, agriculturalHolding: false }, documents: [] };
const draft = id => ({ id, status: 'NEEDS_REVIEW', notes: null, suggestedApplicationType: 'HOUSEHOLDER_PLANNING', selectedApplicationType: 'HOUSEHOLDER_PLANNING',
  prepared: { version: 1, generatedAt: new Date().toISOString(), summary: { documentCount: 0, analysedCount: 0, fallbackCount: 0, failedCount: 0, preparedFieldCount: 3, attentionCount: 3 }, warnings: [], project: {}, site: {}, client: {}, agent: {}, application: {}, matches: { clients: [], sites: [], projects: [] } },
  review: structuredClone(initialReview), issues: [], analysis: {}, documents: [], result: null });
const drafts = new Map();
const events = [];
const js = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Review from './src/components/applications/ApplicationDraftReview';
fetch('/fixture'+location.search).then(r=>r.json()).then(initialDraft=>createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-4"><Review initialDraft={initialDraft} documentTypes={[]} typeOfWorkOptions={[]} certifierPresets={[]} /></main>));`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = await postcss([tailwindcss(config)]).process(readFileSync('src/styles/global.css', 'utf8'), { from: 'src/styles/global.css' });
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js.outputFiles[0].text); return; }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
  if (url.pathname === '/inspection') { json({ events, drafts: Object.fromEntries(drafts) }); return; }
  if (url.pathname === '/fixture') { const mode = url.searchParams.get('mode') ?? 'verified'; const value = draft(`fixture-${mode}`); drafts.set(value.id, value); json(value); return; }
  if (url.pathname.startsWith('/api/application-drafts/')) {
    const id = url.pathname.split('/')[3]; let body = ''; for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {}; events.push({ id, path: url.pathname, method: req.method, input });
    if (url.pathname.endsWith('/address-lookup')) {
      if (id.endsWith('race')) await new Promise(resolve => setTimeout(resolve, 2500));
      const status = input.buildingNumber !== '105' ? 'not_found' : id.endsWith('ambiguous') ? 'ambiguous' : id.endsWith('unavailable') ? 'unavailable' : 'verified';
      const fields = status === 'verified' ? { ...(input.postcode ? {} : { postcode: 'G52 3QH' }), localAuthority: 'Glasgow City Council' } : {};
      json({ status, fields, sources: {} }); return;
    }
    const value = drafts.get(id); if (input.review) value.review = input.review; json({ draft: value, issues: [] }); return;
  }
  res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}).listen(4330, '127.0.0.1', () => console.log('Address form fixture ready at http://127.0.0.1:4330'));
