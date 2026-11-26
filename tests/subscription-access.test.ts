import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolveEntitlement, PERIOD_END_TOLERANCE_MS } from '../src/server/billing/entitlement';
import { classifyPath } from '../src/lib/server/access-paths';
import { encodeStripeForm, signStripePayloadForTest, verifyStripeWebhook } from '../src/server/billing/stripe';
import { subscriptionDataFromStripe } from '../src/server/billing/subscription-sync';
import { buildLicenceClaims, signLicence, verifyLicence, LICENCE_TTL_SECONDS } from '../src/server/billing/licence';
import { postSignupRedirect, subscriptionCreateFor } from '../src/server/billing/onboarding';
import { intervalFor, planForStripePrice, PLANS } from '../src/config/plans';
import { classifyUsage, usagePeriodMonth } from '../src/server/billing/usage';
import { checkoutLineItems } from '../src/server/billing/checkout';
import { accessRequestSchema, organisationAccessSchema } from '../src/lib/validation/access';

const read = (path: string) => readFileSync(path, 'utf8');
const now = new Date('2026-12-01T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

// --- Entitlement rules -------------------------------------------------------
assert.equal(resolveEntitlement(null, now).allowed, false, 'no subscription, no access');
assert.equal(resolveEntitlement({ status: 'PENDING_PAYMENT' }, now).allowed, false);
assert.equal(resolveEntitlement({ status: 'CANCELED' }, now).allowed, false);
assert.equal(resolveEntitlement({ status: 'SUSPENDED', currentPeriodEndsAt: days(30) }, now).allowed, false);
assert.equal(resolveEntitlement({ status: 'COMPLIMENTARY' }, now).allowed, true);
assert.equal(resolveEntitlement({ status: 'TRIALING', trialEndsAt: days(3) }, now).allowed, true);
assert.match(resolveEntitlement({ status: 'TRIALING', trialEndsAt: days(3) }, now).warning ?? '', /trial ends in 3 days/);
assert.equal(resolveEntitlement({ status: 'TRIALING', trialEndsAt: days(-1) }, now).allowed, false, 'expired trial');
assert.equal(resolveEntitlement({ status: 'TRIALING' }, now).allowed, false, 'trial without an end date is not open-ended');
assert.equal(resolveEntitlement({ status: 'ACTIVE', currentPeriodEndsAt: days(20) }, now).allowed, true);
assert.equal(resolveEntitlement({ status: 'ACTIVE', currentPeriodEndsAt: days(-1) }, now).allowed, true, 'webhook lag tolerance');
assert.equal(
  resolveEntitlement({ status: 'ACTIVE', currentPeriodEndsAt: new Date(now.getTime() - PERIOD_END_TOLERANCE_MS - 1) }, now).allowed,
  false, 'stale active period eventually locks',
);
assert.equal(resolveEntitlement({ status: 'PAST_DUE', graceEndsAt: days(2) }, now).allowed, true);
assert.ok(resolveEntitlement({ status: 'PAST_DUE', graceEndsAt: days(2) }, now).warning);
assert.equal(resolveEntitlement({ status: 'PAST_DUE', graceEndsAt: days(-1) }, now).allowed, false);
assert.equal(resolveEntitlement({ status: 'PAST_DUE' }, now).allowed, false);

// --- Route classification ----------------------------------------------------
for (const path of ['/', '/login', '/register', '/pricing', '/demo', '/features', '/privacy', '/api/auth/login',
  '/api/auth/google/start', '/api/billing/webhook', '/api/access-requests', '/api/cron/gmail-sync', '/_astro/x.js',
  '/brand/logo.svg', '/subscribe', '/api/desktop/releases/latest', '/auth/google/complete']) {
  assert.equal(classifyPath(path), 'public', path);
}
for (const path of ['/api/desktop/heartbeat', '/api/desktop/licence', '/api/desktop/queue', '/agent/download']) {
  assert.equal(classifyPath(path), 'self', path);
}
for (const path of ['/billing', '/api/billing/checkout', '/api/billing/portal', '/admin/access', '/api/admin/organisations/x']) {
  assert.equal(classifyPath(path), 'session', path);
}
for (const path of ['/dashboard', '/projects', '/projects/abc', '/settings', '/desktop-agent/connect', '/api/projects',
  '/api/settings/desktop-agents/setup', '/downloads/ArchitectProAgentSetup-4.2.26.exe', '/billingx', '/administrator', '/api/billing']) {
  assert.equal(classifyPath(path), 'entitled', path);
}

// --- Stripe webhook signatures ----------------------------------------------
const secret = 'whsec_test_secret';
const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: { object: 'subscription' } } });
const ts = Math.floor(now.getTime() / 1000);
assert.equal(verifyStripeWebhook(payload, signStripePayloadForTest(payload, secret, ts), secret, ts).id, 'evt_1');
assert.throws(() => verifyStripeWebhook(payload, signStripePayloadForTest(payload, 'whsec_other', ts), secret, ts), /Invalid/);
assert.throws(() => verifyStripeWebhook(`${payload} `, signStripePayloadForTest(payload, secret, ts), secret, ts), /Invalid/);
assert.throws(() => verifyStripeWebhook(payload, signStripePayloadForTest(payload, secret, ts - 3600), secret, ts), /expired/);
assert.throws(() => verifyStripeWebhook(payload, null, secret, ts), /Missing/);
assert.throws(() => verifyStripeWebhook(payload, 't=abc', secret, ts), /Malformed/);

assert.equal(
  encodeStripeForm({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { organisationId: 'org' }, skip: undefined }).toString(),
  'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5BorganisationId%5D=org',
);

// --- Stripe -> entitlement mapping ------------------------------------------
process.env.STRIPE_PRICE_PRACTICE_ANNUAL = 'price_practice_annual';
process.env.STRIPE_PRICE_PRACTICE_USAGE = 'price_practice_usage';
assert.deepEqual(planForStripePrice('price_practice_annual'), { plan: 'practice', interval: 'annual', usage: false });
assert.deepEqual(planForStripePrice('price_practice_usage'), { plan: 'practice', interval: null, usage: true });
assert.equal(planForStripePrice('price_unknown'), null);
const stripeSub = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'sub_1', object: 'subscription' as const, customer: 'cus_1', status: status as never, cancel_at_period_end: false,
  items: { data: [{ price: { id: 'price_practice_annual' }, current_period_end: ts + 86_400 * 365 }] }, ...extra,
});
const active = subscriptionDataFromStripe(stripeSub('active'), null, now);
assert.equal(active.status, 'ACTIVE');
assert.equal(active.plan, 'practice');
assert.equal(active.agentDeviceLimit, 3);
assert.equal(active.includedApplications, 10);
assert.equal(active.userLimit, 3);
assert.equal(active.billingInterval, 'annual');
// Base and metered items together still resolve to the base price's plan and interval.
const twoItems = subscriptionDataFromStripe(stripeSub('active', { items: { data: [
  { price: { id: 'price_practice_usage' } }, { price: { id: 'price_practice_annual' }, current_period_end: ts + 100 },
] } }), null, now);
assert.equal(twoItems.billingInterval, 'annual');
assert.equal(twoItems.stripePriceId, 'price_practice_annual');
assert.equal((active.currentPeriodEndsAt as Date).getTime(), (ts + 86_400 * 365) * 1000);
const pastDue = subscriptionDataFromStripe(stripeSub('past_due'), null, now);
assert.equal(pastDue.status, 'PAST_DUE');
assert.equal((pastDue.graceEndsAt as Date).getTime(), days(7).getTime(), 'grace starts on first failure');
const existingGrace = days(1);
assert.equal(subscriptionDataFromStripe(stripeSub('unpaid'), { status: 'PAST_DUE', graceEndsAt: existingGrace }, now).graceEndsAt, existingGrace, 'grace is not extended by repeat failures');
assert.equal(subscriptionDataFromStripe(stripeSub('canceled'), null, now).status, 'CANCELED');
assert.equal(subscriptionDataFromStripe(stripeSub('active'), { status: 'ACTIVE', graceEndsAt: null, plan: 'practice', agentDeviceLimit: 6 }, now).agentDeviceLimit, 6, 'admin-raised Agent limit survives renewals');
assert.equal(subscriptionDataFromStripe(stripeSub('active'), { status: 'ACTIVE', graceEndsAt: null, plan: 'studio', agentDeviceLimit: 20 }, now).agentDeviceLimit, 3, 'changing plan resets to the plan default');
assert.equal(subscriptionDataFromStripe(stripeSub('incomplete'), null, now).status, 'PENDING_PAYMENT');
assert.equal(subscriptionDataFromStripe(stripeSub('active'), null, now).graceEndsAt, null);

// --- Signup without an invite is unpaid ---------------------------------------
assert.equal(subscriptionCreateFor(null).status, 'PENDING_PAYMENT');
const trial = subscriptionCreateFor({ plan: 'studio' });
assert.equal(trial.status, 'TRIALING');
assert.equal(trial.agentDeviceLimit, 1, 'evaluation workspaces get one Agent');
assert.equal(trial.plan, 'studio');
assert.ok((trial.trialEndsAt as Date).getTime() > Date.now() + 13 * 86_400_000);
assert.equal(postSignupRedirect(true), '/dashboard');
assert.equal(postSignupRedirect(false, 'studio', 'annual'), '/subscribe?plan=studio&billing=annual');
assert.equal(postSignupRedirect(false, 'payg', 'annual'), '/subscribe?plan=payg&billing=monthly', 'pay as you go has no yearly option');
assert.equal(postSignupRedirect(false, 'firm'), '/demo?interest=firm', 'firm is quoted');
assert.equal(postSignupRedirect(false, 'starter'), '/billing', 'retired plan ids are ignored');
assert.equal(postSignupRedirect(false, 'evil"plan', 'x'), '/billing');

// --- Agreed pricing ---------------------------------------------------------
assert.deepEqual([PLANS.payg.includedApplications, PLANS.practice.includedApplications, PLANS.studio.includedApplications, PLANS.firm.includedApplications], [0, 10, 30, 100]);
assert.deepEqual([PLANS.payg.extraApplicationRate, PLANS.practice.extraApplicationRate, PLANS.studio.extraApplicationRate, PLANS.firm.extraApplicationRate], [29, 8, 6, null]);
assert.deepEqual([PLANS.payg.userLimit, PLANS.practice.userLimit, PLANS.studio.userLimit, PLANS.firm.userLimit], [1, 3, 10, null]);
assert.equal(intervalFor('payg', 'annual'), 'monthly');
assert.equal(intervalFor('studio', 'annual'), 'annual');
assert.throws(() => checkoutLineItems('firm', 'monthly'), /quote/);
assert.deepEqual(checkoutLineItems('practice', 'annual'), [{ price: 'price_practice_annual', quantity: 1 }, { price: 'price_practice_usage' }]);
assert.throws(() => checkoutLineItems('payg', 'monthly'), /can't be bought online/, 'payg needs its usage price');
process.env.STRIPE_PRICE_PAYG_USAGE = 'price_payg_usage';
assert.deepEqual(checkoutLineItems('payg', 'annual'), [{ price: 'price_payg_usage' }], 'payg is usage only');
assert.throws(() => checkoutLineItems('studio', 'monthly'), /can't be bought online/);

// --- Per-application metering ------------------------------------------------
const usageBase = { subscriptionStatus: 'ACTIVE' as const, plan: 'practice', hasStripeCustomer: true, includedApplications: 10, usagePriceConfigured: true };
assert.equal(classifyUsage({ ...usageBase, usedThisMonth: 0 }), 'INCLUDED');
assert.equal(classifyUsage({ ...usageBase, usedThisMonth: 9 }), 'INCLUDED', '10th application is still included');
assert.equal(classifyUsage({ ...usageBase, usedThisMonth: 10 }), 'PENDING', '11th application is charged');
assert.equal(classifyUsage({ ...usageBase, plan: 'payg', includedApplications: 0, usedThisMonth: 0 }), 'PENDING', 'every payg application is charged');
assert.equal(classifyUsage({ ...usageBase, subscriptionStatus: 'TRIALING', usedThisMonth: 50 }), 'NOT_BILLED');
assert.equal(classifyUsage({ ...usageBase, subscriptionStatus: 'COMPLIMENTARY', usedThisMonth: 50 }), 'NOT_BILLED');
assert.equal(classifyUsage({ ...usageBase, subscriptionStatus: 'PAST_DUE', usedThisMonth: 50 }), 'PENDING');
assert.equal(classifyUsage({ ...usageBase, plan: 'firm', includedApplications: 100, usagePriceConfigured: false, usedThisMonth: 120 }), 'NOT_BILLED', 'firm overage is agreed per contract');
assert.equal(usagePeriodMonth(new Date('2026-11-30T23:59:59Z')), '2026-11');
const jobRoute = read('src/pages/api/desktop/automation-jobs/[id]/index.ts');
assert.match(jobRoute, /body\.status === AutomationJobStatus\.COMPLETED\) \{\s*\/\/ Per-application billing/);
assert.match(jobRoute, /recordApplicationUsage\(tx,/, 'usage is recorded inside the completion transaction');

// --- Demo request form contract (matches the marketing /demo form) -----------
assert.doesNotThrow(() => accessRequestSchema.parse({ name: 'Ann Lee', email: 'Ann@Example.com', practiceName: 'Lee Architects', role: '', practiceSize: '2-5', phone: '', message: 'Hi', interest: 'planning', plan: 'practice' }));
assert.equal(accessRequestSchema.parse({ name: 'Ann Lee', email: 'Ann@Example.com', practiceName: 'Lee Architects' }).email, 'ann@example.com');
assert.throws(() => accessRequestSchema.parse({ name: 'A', email: 'nope', practiceName: '' }));

assert.equal(organisationAccessSchema.parse({ action: 'set_agent_limit', agentLimit: '5' }).agentLimit, 5);
assert.equal(organisationAccessSchema.parse({ action: 'comp', agentLimit: '' }).agentLimit, undefined);

// --- Agent licences ----------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const agent = { id: 'agent_1', organisationId: 'org_1', installationId: '9c65df19-5a77-4e2c-a82f-30362b36773e' };
const claims = buildLicenceClaims({ agent, subscription: { plan: 'practice', agentDeviceLimit: 3 }, entitlement: resolveEntitlement({ status: 'COMPLIMENTARY' }, now), now });
assert.equal(claims.exp - claims.iat, LICENCE_TTL_SECONDS);
assert.ok(claims.rfa < claims.exp);
const licence = signLicence(claims, privateKey, 'test');
assert.equal(verifyLicence(licence, publicKey, { sub: 'agent_1', inst: agent.installationId, now }).org, 'org_1');
assert.throws(() => verifyLicence(licence, publicKey, { sub: 'agent_2', now }), /another Agent/);
assert.throws(() => verifyLicence(licence, publicKey, { now: new Date((claims.exp + 1) * 1000) }), /expired/);
const [h, p, s] = licence.split('.');
const forgedPayload = Buffer.from(JSON.stringify({ ...claims, org: 'org_2' })).toString('base64url');
assert.throws(() => verifyLicence(`${h}.${forgedPayload}.${s}`, publicKey, { now }), /signature/);
const otherKey = crypto.generateKeyPairSync('ed25519').publicKey;
assert.throws(() => verifyLicence(licence, otherKey, { now }), /signature/);
void p;
const trialClaims = buildLicenceClaims({ agent, subscription: null, entitlement: resolveEntitlement({ status: 'TRIALING', trialEndsAt: new Date(now.getTime() + 3_600_000) }, now), now });
assert.equal(trialClaims.exp, Math.floor(now.getTime() / 1000) + 3600, 'licence never outlives the trial');

// --- Enforcement is wired in -------------------------------------------------
assert.match(read('src/middleware.ts'), /resolveEntitlement/);
assert.match(read('src/server/auth/agent-credential.ts'), /assertOrganisationEntitled\(agent\.organisationId\)/);
assert.match(read('src/server/auth/desktop-token.ts'), /assertOrganisationEntitled\(access\.organisationId\)/);
const exchange = read('src/pages/api/desktop/enrollment/exchange.ts');
assert.match(exchange, /assertOrganisationEntitled\(enrollment\.organisationId, tx\)/);
assert.match(exchange, /AGENT_DEVICE_LIMIT/);
const register = read('src/pages/api/auth/register.ts');
assert.match(register, /subscriptionCreateFor\(invite\)/);
assert.match(register, /invite_only/);
assert.match(read('src/pages/api/auth/google/complete.ts'), /subscriptionCreateFor\(invite\)/);
assert.match(read('prisma/migrations/20261125140000_subscription_access/migration.sql'), /'COMPLIMENTARY', 'LEGACY'/);
assert.equal(existsSync('public/downloads'), false);

console.log('subscription access, billing and licensing tests passed');
