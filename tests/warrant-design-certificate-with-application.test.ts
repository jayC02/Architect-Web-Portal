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

// Both question pages ask for them when the certificate accompanies the application.
const preparationPage = readFileSync('src/pages/building-warrant/[id]/preparation.astro', 'utf8');
const draftQuestions = readFileSync('src/components/applications/WarrantDraftQuestions.tsx', 'utf8');
for (const name of ['designCertificateNumber', 'designCertifierSignatureDate', 'designApprovedBodySignatureDate']) {
  assert.match(preparationPage, new RegExp(`name="${name}"`), `preparation page asks for ${name}`);
  assert.match(draftQuestions, new RegExp(`name="${name}"`), `draft questions ask for ${name}`);
}
assert.match(preparationPage, /data-design-certificate-details/);
assert.match(preparationPage, /fieldValue\('designCertificateWithApplication'\) === 'true'/, 'shown only while the certificate is uploaded with the application');

// ---- One question: "I will be uploading a certificate of design with this application" ----
// No (the default) means the certificate follows the application, so the portal's
// second answer is Yes and the 73% register opens. Yes means No to the second
// question and the 71% register, which asks for the certificate number and dates.
import { designCertificateTiming } from '../src/lib/building-warrant-branches';

const NO_YES = { designCertificateWithApplication: false, designCertificateFollowingApplication: true };
const YES_NO = { designCertificateWithApplication: true, designCertificateFollowingApplication: false };
assert.deepEqual(designCertificateTiming({}), NO_YES, 'no answer yet means No / Yes');
assert.deepEqual(designCertificateTiming({ designCertificateWithApplication: false }), NO_YES);
assert.deepEqual(designCertificateTiming({ designCertificateWithApplication: true }), YES_NO);
assert.deepEqual(designCertificateTiming({ designCertificateWithApplication: true, designCertificateFollowingApplication: true }), YES_NO,
  'the second answer always follows from the first');
assert.deepEqual(designCertificateTiming({ designCertificateWithApplication: false, designCertificateFollowingApplication: false }), NO_YES,
  'No / No cannot happen');

// A run built before this change with No / No is still held, not sent to the portal.
const neither = structuredClone(snapshot);
neither.buildingWarrant.designCertificateWithApplication = false;
neither.buildingWarrant.designCertificateFollowingApplication = false;
assert.ok(evaluateAutomationPreflight(neither).missing.some((issue) => issue.code === 'missing_design_certificate_timing'));

// Saved from the form as the one answer.
const asked = answers({ designCertificateWithApplication: 'true', designCertificateNumber: 'DC-5',
  designCertifierSignatureDate: '2026-11-02', designApprovedBodySignatureDate: '2026-11-03' });
assert.equal(asked.designCertificateWithApplication, true);
assert.equal(asked.designCertificateFollowingApplication, false);
assert.equal(asked.designCertificate?.certificateNumber, 'DC-5');
const following = answers({ designCertificateWithApplication: 'false' });
assert.equal(following.designCertificateWithApplication, false);
assert.equal(following.designCertificateFollowingApplication, true);
assert.equal(following.designCertificate, null);

const defaulted = buildingWarrantDraftAnswers({ certifierOfDesignCertificateAvailable: true }, residential);
assert.equal(defaulted.designCertificateWithApplication, false);
assert.equal(defaulted.designCertificateFollowingApplication, true);
assert.equal(defaulted.designCertificate, null);
assert.equal(buildingWarrantDraftAnswers({ certifierOfDesignCertificateAvailable: true, designCertificateWithApplication: true }, residential).designCertificateFollowingApplication, false);

const jobsService = readFileSync('src/server/services/automation-jobs.service.ts', 'utf8');
assert.match(jobsService, /\.\.\.designCertificateTiming\(/, 'every new run applies the default');

const QUESTION = 'I will be uploading a certificate of design with this application';
for (const [page, source] of [['preparation page', preparationPage], ['draft questions', draftQuestions]] as const) {
  assert.ok(source.includes(QUESTION), `${page} asks the portal's question`);
  assert.doesNotMatch(source, /When will the design certificate be provided\?/, `${page} no longer uses its own wording`);
  assert.doesNotMatch(source, /name="designCertificateFollowingApplication"/, `${page} does not ask the second question`);
}
assert.match(preparationPage, /name="designCertificateWithApplication"/);
assert.match(draftQuestions, /name="designCertificateWithApplication"/);

console.log('warrant design certificate with application tests passed');
