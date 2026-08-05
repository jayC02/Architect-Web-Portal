import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientReadiness = fs.readFileSync('src/lib/application-draft-readiness.ts', 'utf8');
const serverReadiness = fs.readFileSync('src/server/services/application-draft.service.ts', 'utf8');

for (const source of [clientReadiness, serverReadiness]) {
  assert.doesNotMatch(
    source,
    /key:\s*['"]selectedApplicationType['"][\s\S]{0,180}label:\s*['"]Application route['"]/,
    'automatic application routing must not be presented as a missing user field',
  );
  assert.doesNotMatch(
    source,
    /Choose Building Warrant or Planning \/ Householder\./,
    'the removed application-route prompt must not remain in readiness validation',
  );
}

console.log('application route readiness test passed');
