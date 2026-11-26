import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentPhoneError } from '../src/lib/validation/client-contact';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';
import { evaluateApplicationDraftReadiness } from '../src/server/services/application-draft.service';
import { evaluateAutomationPreflight } from '../src/server/services/automation-preflight.service';
import { clientReviewFixture } from './fixtures/client-applicant-review';
import { organisationDefaultsSchema } from '../src/lib/validation/domain';

for (const route of ['BUILDING_WARRANT', 'HOUSEHOLDER_PLANNING', 'PLANNING_APPLICATION'] as const) {
  const review = clientReviewFixture().review!;
  review.selectedApplicationType = route;
  for (const phone of [null, '', '   ', 'not a number', '1234']) {
    review.agent.phone = phone;
    // Incomplete drafts can still be saved and corrected.
    assert.ok(applicationDraftReviewSchema.safeParse(review).success);
    for (const evaluate of [evaluateClientApplicationDraftReadiness, evaluateApplicationDraftReadiness]) {
      const issue = evaluate(review).find(issue => issue.key === 'agent.phone');
      assert.ok(issue, `${route} must require agent phone in both readiness checks`);
      assert.equal(issue.section, 'agent');
      assert.match(issue.message, /agent telephone/i);
    }
  }
  for (const phone of ['0141 000 0000', '+44 141 000 0000', '07000000000']) {
    review.agent.phone = phone;
    for (const evaluate of [evaluateClientApplicationDraftReadiness, evaluateApplicationDraftReadiness]) {
      assert.ok(!evaluate(review).some(issue => issue.key === 'agent.phone'));
    }
  }
}

const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
fixture.organisation.agent.buildingNumber = '1';
for (const applicationType of ['BUILDING_WARRANT', 'HOUSEHOLDER_PLANNING', 'PLANNING_APPLICATION']) {
  fixture.metadata.applicationType = applicationType;
  for (const phone of [null, undefined, '', '   ', 'invalid']) {
    fixture.organisation.agent.phone = phone;
    const before = structuredClone(fixture);
    const result = evaluateAutomationPreflight(fixture);
    assert.equal(result.status, 'NEEDS_INPUT', 'an old job cannot remain READY with a missing phone');
    const issue = result.missing.find(issue => issue.field === 'organisation.agent.phone');
    assert.ok(issue);
    assert.equal(issue.code, phone?.trim() ? 'invalid_organisation_agent_phone' : 'missing_organisation_agent_phone');
    assert.deepEqual(fixture, before, 'validation must not invent or change a phone number');
  }
  fixture.organisation.agent.phone = '01410000000';
  assert.ok(!evaluateAutomationPreflight(fixture).missing.some(issue => issue.field === 'organisation.agent.phone'));
}
for (const value of [null, undefined, '', '   ']) assert.match(agentPhoneError(value)!, /required/);
assert.equal(agentPhoneError('0141 000 0000'), null);
assert.ok(agentPhoneError('01410000000'.split('').join('   ')));
for (const agentPhone of [undefined, null, '', '   ', 'invalid']) {
  const result = organisationDefaultsSchema.safeParse({ agentPhone });
  assert.ok(!result.success, 'web settings cannot save agent details without a valid required phone');
  assert.ok(result.error.issues.some(issue => issue.path[0] === 'agentPhone'));
}
assert.ok(organisationDefaultsSchema.safeParse({ agentPhone: '0141 000 0000' }).success);
console.log('Verified agent phone readiness, incomplete-draft saving, old snapshot gating and supported phone formats.');
