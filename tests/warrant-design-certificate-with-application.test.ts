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
}
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
assert.ok(preparationPage.includes(QUESTION), "the preparation page asks the portal's question");
assert.doesNotMatch(preparationPage, /When will the design certificate be provided\?/, 'no longer its own wording');
assert.doesNotMatch(preparationPage, /name="designCertificateFollowingApplication"/, 'the second answer follows from the first');
assert.match(preparationPage, /name="designCertificateWithApplication"/);

// The certificate questions are asked once, in the warrant preparation, not
// again when the application is first created.
const review = readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');
assert.ok(readFileSync('src/components/forms/WarrantBranchFields.astro', 'utf8').includes('Will an approved certifier of construction be used?'));
for (const [name, source] of [['new-application review', review], ['draft questions', draftQuestions]] as const) {
  assert.ok(!source.includes('Will the appropriate Certifier of Design certificate be provided?'), `${name} does not ask about the design certificate`);
  assert.ok(!source.includes('Will an approved certifier of construction be used?'), `${name} does not ask about construction certification`);
  assert.ok(!source.includes('WarrantCertificateQuestions'), `${name} has no certificate questions`);
}

console.log('warrant design certificate with application tests passed');

// ---- "Use a certifier of design?" decides it ------------------------------------------------
// Yes with details means the certificate is provided: the Agent answers Yes in the
// portal and fills the certifier, and the fee discount applies. There is no
// separate "Will the appropriate Certifier of Design certificate be provided?".
import { designCertificateProvided } from '../src/lib/building-warrant-branches';

assert.equal(designCertificateProvided({ designCertifierSelected: true, certifierOfDesignCertificateAvailable: false }), true,
  'choosing a certifier means the certificate is provided');
assert.equal(designCertificateProvided({ designCertifierSelected: false, certifierOfDesignCertificateAvailable: true }), false);
assert.equal(designCertificateProvided({ certifierOfDesignCertificateAvailable: true }), true, 'older warrants keep their saved answer');
assert.equal(designCertificateProvided({}), false);

assert.ok(!preparationPage.includes('Will the appropriate Certifier of Design certificate be provided?'), 'the preparation page does not ask it separately');
assert.doesNotMatch(preparationPage, /name="certifierOfDesignCertificateAvailable"/);
assert.match(jobsService, /certifierOfDesignCertificateAvailable = designCertificateProvided\(warrantAnswers\)/, 'every run derives it');
assert.match(readFileSync('src/pages/api/building-warrant/[id]/preparation.ts', 'utf8'), /certifierOfDesignCertificateAvailable: body\.designCertifierSelected/);
assert.match(readFileSync('src/pages/api/building-warrant/[id]/certifier-details.ts', 'utf8'), /certifierOfDesignCertificateAvailable: designSelected,/);
assert.match(readFileSync('src/server/services/application-draft-commit.service.ts', 'utf8'), /selectedCertifierPresetId \? \{ designCertifierSelected: true, certifierOfDesignCertificateAvailable: true \}/,
  'a certifier chosen when the application is created is used');

console.log('warrant design certificate provided tests passed');

// ---- Ask the timing first, then only what that portal page needs ----------------------------
// "With this application" Yes (71% page): certificate number, registrations and both
// signature dates, no names. No (73% page): registrations and both names, no dates.
const timingAt = preparationPage.indexOf('I will be uploading a certificate of design with this application');
assert.ok(timingAt > 0 && timingAt < preparationPage.indexOf('name="selectedCertifierPresetId"'), 'the timing question comes before the certifier details');
const onlyFor = (name: string) => new RegExp(`data-design-certificate-only="(with|following)"[^>]*>(?:(?!</label>)[\\s\\S])*?name="${name}"`).exec(preparationPage)?.[1];
for (const name of ['designCertificateNumber', 'designCertifierSignatureDate', 'designApprovedBodySignatureDate']) assert.equal(onlyFor(name), 'with', `${name} only for the 71% page`);
for (const name of ['certifierName', 'approvedBody']) assert.equal(onlyFor(name), 'following', `${name} only for the 73% page`);
for (const name of ['registrationAPart1', 'registrationAPart2', 'registrationBPart1', 'registrationBPart2']) assert.equal(onlyFor(name), undefined, `${name} is needed by both pages`);

// Saving: names are needed only for the 73% page; number and dates only for the 71% page.
const { buildingWarrantCertifierDetailsSchema } = await import('../src/lib/validation/domain');
const certifierIssues = (extra: Record<string, unknown>) => {
  const result = buildingWarrantCertifierDetailsSchema.safeParse({
    typeOfWorkKeys: ['domestic_alteration_extension'], description: 'Rear extension', estimatedValue: '50000',
    designCertifierSelected: 'true', registrationAPart1: 'SER1', registrationAPart2: '1', registrationBPart1: 'SER1', registrationBPart2: '2', ...extra,
  });
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
};
assert.ok(certifierIssues({ designCertificateWithApplication: 'false' }).includes('certifierName'), 'the 73% page needs the certifier name');
assert.ok(!certifierIssues({ designCertificateWithApplication: 'true', designCertificateNumber: 'DC', designCertifierSignatureDate: '2026-11-02', designApprovedBodySignatureDate: '2026-11-03' }).includes('certifierName'),
  'the 71% page does not need names');
assert.ok(certifierIssues({ designCertificateWithApplication: 'true' }).includes('designCertificateNumber'), 'the 71% page needs the certificate number');

// Running: the same rule.
const withNoNames = structuredClone(snapshot);
withNoNames.buildingWarrant.designCertificateWithApplication = true;
withNoNames.buildingWarrant.designCertificateFollowingApplication = false;
withNoNames.buildingWarrant.designCertificate = { certificateNumber: 'DC-1', certifierSignatureDate: '2026-11-02', approvedBodySignatureDate: '2026-11-03' };
withNoNames.buildingWarrant.certifier = { ...withNoNames.buildingWarrant.certifier, certifierName: null, approvedBody: null };
assert.equal(evaluateAutomationPreflight(withNoNames).status, 'READY', 'the 71% page runs without names');
const followingNoNames = structuredClone(withNoNames);
followingNoNames.buildingWarrant.designCertificateWithApplication = false;
followingNoNames.buildingWarrant.designCertificateFollowingApplication = true;
assert.ok(evaluateAutomationPreflight(followingNoNames).missing.some((issue) => issue.field === 'buildingWarrant.certifier.certifierName'), 'the 73% page needs names');

console.log('warrant design certificate page-specific fields tests passed');

// ---- Saving complete warrant details sends it to the Agent, as Planning does ----
assert.match(preparationPage, /<button class="btn btn-primary">Save and run application<\/button>/);
assert.match(preparationPage, /data-pending-message="Saving and starting automation\.\.\."/);
const warrantSave = readFileSync('src/pages/api/building-warrant/[id]/certifier-details.ts', 'utf8');
assert.match(warrantSave, /status === AutomationJobStatus\.READY\s*\?\s*await authoriseAutomationJobRun\(/, 'only complete details are sent');
console.log('warrant save and run tests passed');
