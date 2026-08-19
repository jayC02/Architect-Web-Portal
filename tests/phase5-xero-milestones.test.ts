import assert from 'node:assert/strict';
import fs from 'node:fs';
import { XERO_DRAFT_SCOPES, XERO_READ_SCOPES, hasXeroDraftInvoiceScope } from '../src/lib/xero/config';
import { feePlanTemplateSchema } from '../src/lib/validation/fee-plans';
import { buildDraftInvoiceRequest, milestoneIdempotencyKey } from '../src/server/services/xero-draft-invoices.service';

assert.deepEqual(XERO_DRAFT_SCOPES.filter((scope) => !XERO_READ_SCOPES.includes(scope as never)), ['accounting.invoices']);
assert.equal(hasXeroDraftInvoiceScope(XERO_READ_SCOPES.join(' ')), false);
assert.equal(hasXeroDraftInvoiceScope(XERO_DRAFT_SCOPES.join(' ')), true);

const request = buildDraftInvoiceRequest({
  milestoneId: 'milestone-1', xeroContactId: 'contact-1', currency: 'GBP', amount: '1250.00',
  description: 'Planning submission', accountCode: '200', taxType: 'OUTPUT2', dueDays: 14,
  now: new Date('2026-08-19T09:00:00.000Z'),
});
assert.equal(request.Invoices[0].Status, 'DRAFT');
assert.equal(request.Invoices[0].Type, 'ACCREC');
assert.equal(request.Invoices[0].Contact.ContactID, 'contact-1');
assert.equal(request.Invoices[0].LineItems[0].Quantity, 1);
assert.equal(request.Invoices[0].LineItems[0].UnitAmount, 1250);
assert.equal(request.Invoices[0].Reference, 'AP:milestone-1');
assert.equal(milestoneIdempotencyKey('milestone-1'), milestoneIdempotencyKey('milestone-1'));
assert.ok(milestoneIdempotencyKey('x'.repeat(300)).length <= 128);

const duplicateKeys = feePlanTemplateSchema.safeParse({ name: 'Standard', currency: 'GBP', milestones: [
  { milestoneKey: 'submission', label: 'First', triggerEventType: 'PLANNING_SUBMITTED', amount: 100, invoiceDescription: 'First', enabled: true },
  { milestoneKey: 'submission', label: 'Second', triggerEventType: 'PLANNING_APPROVED', amount: 200, invoiceDescription: 'Second', enabled: true },
] });
assert.equal(duplicateKeys.success, false, 'a project snapshot cannot contain ambiguous duplicate milestone keys');

const service = fs.readFileSync('src/server/services/xero-draft-invoices.service.ts', 'utf8');
const route = fs.readFileSync('src/pages/api/finance/milestones/[id]/create-draft.ts', 'utf8');
const lifecycle = fs.readFileSync('src/server/services/lifecycle-events.service.ts', 'utf8');
assert.match(service, /existingAttempt\?\.status === XeroWriteAttemptStatus\.UNCERTAIN[\s\S]*findExistingByReference/, 'uncertain writes reconcile by a stable reference before retrying');
assert.match(service, /'Idempotency-Key': idempotencyKey/, 'provider writes use a stable Xero idempotency key');
assert.match(service, /client\?\.xeroLink/, 'drafts require an exact local client-to-Xero contact link');
assert.match(service, /state: ProjectFeeMilestoneState\.DRAFT_CREATING/, 'durable local state is claimed before the provider call');
assert.match(route, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'members cannot create Xero drafts');
for (const event of ['PROJECT_CREATED', 'PLANNING_SUBMITTED', 'PLANNING_APPROVED', 'BUILDING_WARRANT_SUBMITTED']) {
  assert.match(lifecycle, new RegExp(event), `${event} is available to fee milestone evaluation`);
}

console.log('phase 5 Xero milestone tests passed');
