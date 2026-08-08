import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveSoleOwner } from '../src/lib/planning-preparation-defaults';


assert.equal(resolveSoleOwner(undefined), true, 'new applications default sole owner to Yes');
assert.equal(resolveSoleOwner(null), true, 'an unsaved null value defaults sole owner to Yes');
assert.equal(resolveSoleOwner(false), false, 'an explicitly saved No remains No');
assert.equal(resolveSoleOwner(true), true, 'an explicitly saved Yes remains Yes');

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = source('src/pages/planning/[id]/preparation.astro');
const handler = source('src/pages/api/planning/[id]/complete-details.ts');
const snapshotService = source('src/server/services/automation-jobs.service.ts');

assert.match(page, /const soleOwner = resolveSoleOwner\(preparation\.soleOwner\)/);
assert.match(page, /option value="false" selected=\{!soleOwner\}>No/);
assert.match(page, /option value="true" selected=\{soleOwner\}>Yes/);
assert.match(handler, /preparationData:[\s\S]*soleOwner,[\s\S]*agriculturalHolding/);
assert.match(snapshotService, /soleOwner: planningAnswers\.soleOwner \?\? null/);

console.log('planning sole-owner default tests passed');
