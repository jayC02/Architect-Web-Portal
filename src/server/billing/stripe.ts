import crypto from 'node:crypto';
import { HttpError } from '@/lib/utils/http';

// Minimal Stripe REST client. Avoids an SDK dependency; only the calls the
// portal needs. https://docs.stripe.com/api

const STRIPE_API = 'https://api.stripe.com/v1';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY?.trim());

const secretKey = () => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new HttpError(503, 'Online payments are not set up yet. Please contact us to subscribe.');
  return key;
};

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

// Stripe expects application/x-www-form-urlencoded with bracketed nesting.
export const encodeStripeForm = (value: Record<string, FormValue>) => {
  const params = new URLSearchParams();
  const walk = (prefix: string, item: FormValue) => {
    if (item === undefined || item === null) return;
    if (Array.isArray(item)) { item.forEach((entry, index) => walk(`${prefix}[${index}]`, entry)); return; }
    if (typeof item === 'object') { Object.entries(item).forEach(([key, entry]) => walk(`${prefix}[${key}]`, entry)); return; }
    params.append(prefix, String(item));
  };
  Object.entries(value).forEach(([key, item]) => walk(key, item));
  return params;
};

const stripeRequest = async <T>(method: 'GET' | 'POST', path: string, body?: Record<string, FormValue>, idempotencyKey?: string): Promise<T> => {
  const headers: Record<string, string> = { authorization: `Bearer ${secretKey()}` };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`${STRIPE_API}${path}`, { method, headers, body: body ? encodeStripeForm(body) : undefined });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) {
    console.error('Stripe request failed', path, response.status, payload.error?.message);
    throw new HttpError(502, 'The payment provider could not be reached. Please try again.');
  }
  return payload;
};

export type StripeSubscription = {
  id: string;
  object: 'subscription';
  customer: string;
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
  cancel_at_period_end: boolean;
  current_period_end?: number;
  trial_end?: number | null;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string }; current_period_end?: number }> };
};

export type StripeCheckoutSession = {
  id: string;
  object: 'checkout.session';
  url: string | null;
  mode: string;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  metadata?: Record<string, string>;
};

export type StripeInvoice = {
  id: string;
  object: 'invoice';
  customer: string;
  subscription?: string | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: StripeSubscription | StripeCheckoutSession | StripeInvoice | { object: string } };
};

export const createCheckoutSession = (input: {
  organisationId: string;
  lineItems: Array<{ price: string; quantity?: number }>;
  customerId: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}) => stripeRequest<StripeCheckoutSession>('POST', '/checkout/sessions', {
  mode: 'subscription',
  line_items: input.lineItems,
  client_reference_id: input.organisationId,
  ...(input.customerId ? { customer: input.customerId } : { customer_email: input.customerEmail }),
  success_url: input.successUrl,
  cancel_url: input.cancelUrl,
  allow_promotion_codes: true,
  billing_address_collection: 'required',
  metadata: { organisationId: input.organisationId },
  subscription_data: { metadata: { organisationId: input.organisationId } },
});

export const createPortalSession = (customerId: string, returnUrl: string) =>
  stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });

export const retrieveSubscription = (id: string) =>
  stripeRequest<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);

// Verifies the Stripe-Signature header (HMAC-SHA256 over "t.payload").
// https://docs.stripe.com/webhooks#verify-manually
export const verifyStripeWebhook = (
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeEvent => {
  if (!header) throw new HttpError(400, 'Missing Stripe signature.');
  const parts = header.split(',').map((part) => part.split('=', 2) as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || !signatures.length) throw new HttpError(400, 'Malformed Stripe signature.');
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new HttpError(400, 'Stripe signature has expired.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const valid = signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expectedBuffer.length && crypto.timingSafeEqual(candidate, expectedBuffer);
  });
  if (!valid) throw new HttpError(400, 'Invalid Stripe signature.');
  return JSON.parse(payload) as StripeEvent;
};

export const signStripePayloadForTest = (payload: string, secret: string, timestamp: number) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex')}`;

// Usage-based billing: one meter event per application beyond the plan's
// allowance. `identifier` makes retries idempotent on Stripe's side.
// https://docs.stripe.com/api/billing/meter-event/create
export const sendMeterEvent = (input: { eventName: string; customerId: string; identifier: string; timestamp: Date; value?: number }) =>
  stripeRequest<{ identifier: string }>('POST', '/billing/meter_events', {
    event_name: input.eventName,
    identifier: input.identifier,
    timestamp: Math.floor(input.timestamp.getTime() / 1000),
    payload: { stripe_customer_id: input.customerId, value: String(input.value ?? 1) },
  });
