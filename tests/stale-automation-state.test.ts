import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const prepareRoute = source('src/pages/api/automation-jobs/[id]/prepare.ts');
const launchRoute = source('src/pages/api/automation-jobs/[id]/launch.ts');
const snapshotService = source('src/server/services/automation-jobs.service.ts');

assert.match(
  prepareRoute,
  /AutomationJobStatus\.READY,[\s\S]*buildAutomationJobSnapshot/,
  'an unstarted ready job can be re-prepared from canonical records',
);
assert.match(
  launchRoute,
  /currentAutomationSourceUpdatedAt[\s\S]*buildAutomationJobSnapshot[\s\S]*status: AutomationJobStatus\.READY/,
  'launch refreshes a changed unstarted job and scopes the update to READY',
);
assert.match(
  launchRoute,
  /planningApplicationId: previous\.data\.planning\?\.recordId[\s\S]*buildingWarrantApplicationId: previous\.data\.buildingWarrant\?\.recordId/,
  'refresh preserves the exact application identity for Planning and Building Warrant',
);
assert.match(
  launchRoute,
  /documentIds: previous\.data\.documents\.map\(\(document\) => document\.id\)/,
  'refresh preserves the reviewed document selection',
);
assert.doesNotMatch(
  launchRoute,
  /automationJob\.create/,
  'refreshing an unstarted handoff never creates a duplicate automation job',
);

for (const canonicalMapping of [
  /addressLine1: \[project\.site\.buildingNumber, project\.site\.addressLine1\]/,
  /townCity: project\.site\.townCity/,
  /postcode: project\.site\.postcode/,
  /buildingNumber: project\.client\.buildingNumber/,
  /addressLine1: project\.client\.addressLine1 \?\? project\.client\.address/,
  /buildingNumber: defaults\?\.agentBuildingNumber \?\? null/,
]) {
  assert.match(snapshotService, canonicalMapping, 'refreshed snapshots use current canonical Client, Site and Agent data');
}
assert.match(
  snapshotService,
  /project\.client\?\.updatedAt,[\s\S]*project\.site\?\.updatedAt,[\s\S]*defaults\?\.updatedAt/,
  'Client, Site and Agent edits invalidate an older mutable snapshot',
);
assert.doesNotMatch(
  snapshotService,
  /proposalReference/,
  'new web snapshots do not copy desktop portal proposal resume state',
);

console.log('stale automation state regression tests passed');
