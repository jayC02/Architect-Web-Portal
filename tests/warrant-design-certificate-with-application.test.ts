import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { warrantBranchesFromForm, warrantBranchFormFields, warrantBranchSnapshotFields } from '../src/lib/building-warrant-branches';
import { buildingWarrantDraftAnswers } from '../src/lib/building-warrant-draft-answers';
import { evaluateAutomationPreflight } from '../src/server/services/automation-preflight.service';

// "With this application" sends the portal to the register that asks for the
// design certificate's number and both signature dates, so the warrant collects them.
const form = z.object(warrantBranchFormFields);
const answers = (extra: Record<string, unknown>) => warrantBranchesFromForm(form.parse({
  includesServices: 'false', declarationAuthorised: 'true', conversionDescriptions: [], ...extra,
}));

const withApplication = answers({
  designCertificateTiming: 'with_application', designCertificateNumber: ' DC-1234 ',
  designCertifierSignatureDate: '2026-11-02', designApprovedBodySignatureDate: '2026-11-03',
});
assert.deepEqual(withApplication.designCertificate, {
  certificateNumber: 'DC-1234', certifierSignatureDate: '2026-11-02', approvedBodySignatureDate: '2026-11-03',
});
assert.equal(withApplication.designCertificateWithApplication, true);
assert.equal(answers({ designCertificateTiming: 'following_application', designCertificateNumber: 'DC-1' }).designCertificate, null,
  'details are only kept while the certificate accompanies the application');
assert.equal(form.safeParse({ includesServices: 'false', declarationAuthorised: 'true', designCertifierSignatureDate: '02/11/2026' }).success, false,
  'dates are saved as calendar dates');

// The application draft questions save the same details.
const residential = { buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'] };
const draft = buildingWarrantDraftAnswers({
  certifierOfDesignCertificateAvailable: true, designCertificateTiming: 'with_application',
  designCertificateNumber: 'DC-9', designCertifierSignatureDate: '2026-10-01', designApprovedBodySignatureDate: '2026-10-02',
}, residential);
assert.deepEqual(draft.designCertificate, { certificateNumber: 'DC-9', certifierSignatureDate: '2026-10-01', approvedBodySignatureDate: '2026-10-02' });
assert.equal(buildingWarrantDraftAnswers({ certifierOfDesignCertificateAvailable: true, designCertificateTiming: 'following_application', designCertificateNumber: 'DC-9' }, residential).designCertificate, null);

// The snapshot carries them to the Agent.
assert.deepEqual(z.object(warrantBranchSnapshotFields).parse({ designCertificate: withApplication.designCertificate }).designCertificate, withApplication.designCertificate);

// A run is held until the details the portal asks for are complete.
const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
const snapshot = structuredClone(fixture);
snapshot.organisation.agent.buildingNumber = '1';
snapshot.buildingWarrant.typeOfWorkKeys = ['domestic_alteration_extension'];
snapshot.buildingWarrant.unusualAnswers.certifierOfDesignCertificateAvailable = true;
snapshot.buildingWarrant.certifier = {
  registrationAPart1: 'SER1', registrationAPart2: '1234', certifierName: 'A Certifier',
  registrationBPart1: 'RIA2', registrationBPart2: '5678', approvedBody: 'A Body',
};
snapshot.buildingWarrant.designCertificateWithApplication = true;
snapshot.buildingWarrant.designCertificateFollowingApplication = false;
const held = evaluateAutomationPreflight(snapshot);
assert.equal(held.status, 'NEEDS_INPUT');
for (const field of ['certificateNumber', 'certifierSignatureDate', 'approvedBodySignatureDate']) {
  assert.ok(held.missing.some((issue) => issue.field === `buildingWarrant.designCertificate.${field}`), `${field} is required`);
}
snapshot.buildingWarrant.designCertificate = { certificateNumber: 'DC-1', certifierSignatureDate: '2026-11-02', approvedBodySignatureDate: '2026-11-03' };
assert.equal(evaluateAutomationPreflight(snapshot).status, 'READY');
snapshot.buildingWarrant.designCertificateWithApplication = false;
snapshot.buildingWarrant.designCertificateFollowingApplication = true;
snapshot.buildingWarrant.designCertificate = null;
assert.equal(evaluateAutomationPreflight(snapshot).status, 'READY', '"Following this application" needs no certificate details');

// Both question pages ask for them when "With this application" is chosen.
const preparationPage = readFileSync('src/pages/building-warrant/[id]/preparation.astro', 'utf8');
const draftQuestions = readFileSync('src/components/applications/WarrantDraftQuestions.tsx', 'utf8');
for (const name of ['designCertificateNumber', 'designCertifierSignatureDate', 'designApprovedBodySignatureDate']) {
  assert.match(preparationPage, new RegExp(`name="${name}"`), `preparation page asks for ${name}`);
  assert.match(draftQuestions, new RegExp(`name="${name}"`), `draft questions ask for ${name}`);
}
assert.match(preparationPage, /data-design-certificate-details/);
assert.match(preparationPage, /fieldValue\('designCertificateTiming'\) === 'with_application'/, 'shown only for "With this application"');

console.log('warrant design certificate with application tests passed');
