# Access control, billing and Agent licensing

Status: implemented on the web side in this branch. The Agent (separate repo) needs the changes listed under "Agent repo work".

## What was wrong (audit, 25 Nov 2026)

| Path | Problem |
| --- | --- |
| `POST /api/auth/register`, Google sign-up | Anyone could create an organisation and get full access immediately. No payment, no approval. |
| Every page and API | Only checked "signed in". No concept of a subscription, trial or suspension. |
| `public/downloads/*.exe` and `*.zip` | Every installer **and the Agent source code** was a public static file with a year-long immutable cache. Anyone with the URL could download it. |
| `/agent/download` | Public redirect to the latest installer. |
| Agent credential (`apa_…`) | Never expires. Once enrolled, a copied Agent keeps working for as long as the organisation exists. |
| Desktop job tokens (`apd_…`) | Checked for revocation and expiry but not for whether the organisation is still paying. |

## How it works now

The model is the one most B2B SaaS products use: the server is the source of truth, every request is checked against the organisation's entitlement, and the desktop client only holds short-lived, signed, refreshable licences.

### 1. One entitlement record per organisation

`OrganisationSubscription` (1:1 with `Organisation`) holds `status`, `plan`, trial/period end dates, a past-due grace window, Stripe ids and the Agent device limit.

| Status | Access |
| --- | --- |
| `PENDING_PAYMENT` | None. Sent to `/billing`. |
| `TRIALING` | Full, until `trialEndsAt`. |
| `ACTIVE` | Full, until `currentPeriodEndsAt` + 3 days (webhook-lag tolerance). |
| `PAST_DUE` | Full with a warning banner, until `graceEndsAt` (7 days after first failed payment). |
| `CANCELED`, `SUSPENDED` | None. |
| `COMPLIMENTARY` | Full, no expiry. Used for existing organisations (backfilled by the migration) and anyone you comp manually. |

Logic lives in `src/server/billing/entitlement.ts` (pure, unit tested).

### 2. Two ways in, both gated

- **Request a demo** (`/demo` → `POST /api/access-requests`). Lands in `/admin/access` for a platform admin (`PLATFORM_ADMIN_EMAILS`). Approving issues a single-use invite link (14-day expiry, emailed through Resend when configured, also shown on screen). Registering through it creates the organisation on a **14-day trial**. The invite is bound to the requester's email.
- **Subscribe** (`/subscribe?plan=…&billing=…`). Signed-out visitors register first; the organisation is created as `PENDING_PAYMENT` and they go straight to Stripe Checkout. Nothing is usable until Stripe's webhook confirms the subscription.

`SIGNUP_MODE=invite_only` turns off self-serve registration entirely (demo invites only).

### 3. Server-side enforcement on every request

`src/middleware.ts` runs before every page and API route:

- Public marketing/auth paths pass through.
- Everything else needs a session **and** an entitled organisation. Pages redirect to `/billing`; APIs return `402 {code: "SUBSCRIPTION_REQUIRED"}`.
- Desktop/Agent APIs authenticate with bearer tokens, and `requireAgentAuth` / `requireDesktopAuth` / enrollment now check the same entitlement. A lapsed subscription stops the Agent from claiming or running any job, whatever binary it is.

### 4. Billing (Stripe)

- `POST /api/billing/checkout` creates a Checkout Session (subscription mode, promotion codes allowed) tied to the organisation.
- `POST /api/billing/portal` opens the Stripe Customer Portal for card changes, invoices and cancellation.
- `POST /api/billing/webhook` verifies the `Stripe-Signature` HMAC, is idempotent (`StripeWebhookEvent`), and syncs `checkout.session.completed`, `customer.subscription.*` and `invoice.payment_failed` / `invoice.paid` into `OrganisationSubscription`.
- No Stripe SDK dependency; a small `fetch` client in `src/server/billing/stripe.ts`.

### 4a. Plans and per-application metering

Plans follow the agreed pricing (`src/config/plans.ts`, mirroring `src/lib/marketing/plans.ts`):

| Plan | Fee | Included applications a month | Each extra | Users | Agent computers | Checkout |
| --- | --- | --- | --- | --- | --- | --- |
| `payg` Pay as you go | £0 (monthly only) | 0 | £29 | 1 | 1 | Self-serve |
| `practice` Practice | £79 / £790 a year | 10 | £8 | 3 | 3 | Self-serve |
| `studio` Studio | £179 / £1,790 a year | 30 | £6 | 10 | 10 | Self-serve |
| `firm` Firm | from £399, quoted | 100 | agreed | unlimited | 25 | Demo form, then "Activate Firm" in `/admin/access` |

- An **application** is counted the first time the Agent completes it (`AutomationJob` reaches `COMPLETED`). Re-runs of the same application don't count again. Each one becomes an `ApplicationUsage` row inside the same transaction, under the organisation's execution lock.
- The portal applies the monthly allowance itself (calendar month, UTC). Only applications beyond it are sent to the Stripe meter (`STRIPE_METER_EVENT_NAME`, default `application_submitted`), with an idempotent identifier. Stripe charges the plan's flat per-unit usage price on the next invoice.
- Trials, complimentary and Firm workspaces are recorded but not metered. Failed reports stay `PENDING` and are retried by the daily `/api/cron/usage-report`.
- User limits are stored per workspace; there is no team-invite flow yet, so they aren't enforced anywhere.

### 5. Agent licensing

- **Signed licence**: `POST /api/desktop/licence` (Agent bearer auth) returns an Ed25519-signed JWT: organisation, Agent id, installation id, plan, status, `exp` = 72 hours (never past a trial end), `refreshAfter` = 12 hours. Signed with `LICENCE_SIGNING_PRIVATE_KEY`; the Agent ships the public key.
- **Device limit** per plan (Pay as you go 1, Practice 3, Studio 10, Firm 25; 14-day evaluation 1; complimentary 10), enforced at enrollment. Platform admins can raise a workspace's limit on request ("Set Agent computer limit" in `/admin/access`); a raised limit survives renewals and resets only if the customer changes plan.
- **Revocation**: revoking an Agent in Settings, suspending the organisation or the subscription lapsing all stop licence refresh and job access immediately. The offline window is at most 72 hours.
- **Downloads**: installers are no longer public. They moved from `public/downloads/` to `agent-releases/` (outside `public/`, so never served statically). `/agent/download` requires a signed-in entitled user or an entitled Agent bearer token, then redirects to a **5-minute signed URL** in a private Supabase bucket (or, in local dev, streams from the folder named by `AGENT_RELEASE_LOCAL_DIR`). `vercel.json` redirects the old `/downloads/*` links to it.

## Owner steps before this goes live

1. **Choose and create the Stripe account.** Then:
   - Create a **meter** with event name `application_submitted`, sum aggregation, customer mapping on `stripe_customer_id`.
   - Create flat prices: Practice £79 monthly and £790 yearly, Studio £179 monthly and £1,790 yearly (`STRIPE_PRICE_PRACTICE_MONTHLY`, `..._ANNUAL`, `STRIPE_PRICE_STUDIO_MONTHLY`, `..._ANNUAL`).
   - Create metered per-unit prices on that meter: £29 (`STRIPE_PRICE_PAYG_USAGE`), £8 (`STRIPE_PRICE_PRACTICE_USAGE`), £6 (`STRIPE_PRICE_STUDIO_USAGE`). For yearly plans, use Stripe's flexible billing mode so monthly overage can sit on a yearly subscription, or accept that overage is invoiced at renewal.
   - Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, point a webhook at `/api/billing/webhook` for the events above, and turn on the Customer Portal.
2. **Generate the licence key pair** (`node scripts/generate-licence-keys.mjs`), set `LICENCE_SIGNING_PRIVATE_KEY` in Vercel, give the public key to the Agent repo.
3. **Create a private Supabase bucket** (`AGENT_RELEASE_BUCKET`, default `agent-releases`) and upload the current installer and source zip under the names in `src/config/agent-release.json`.
4. Set `PLATFORM_ADMIN_EMAILS` (comma-separated) for who can approve demos.
5. Run the migration (`npm run db:deploy`). It backfills every existing organisation as `COMPLIMENTARY` so nobody is locked out; downgrade any you want to bill from `/admin/access`.
6. Once the installers are in the bucket, delete `agent-releases/` from the repo (about 1.2 GB) in a follow-up. Until then **production downloads return 503**, because the files are no longer public.

## Agent repo work

1. Call `POST /api/desktop/licence` on start-up and every 12 hours (`refreshAfter`). Verify the Ed25519 signature with the **embedded** public key, check `iss`, `sub` (its own Agent id), `inst` (its installation id) and `exp`. Store the latest licence on disk.
2. Refuse to run automation when there is no valid licence. Allow offline use only until `exp`. Show "Subscription inactive, open Architect Pro to renew" on `402` and "This computer was disconnected" on `401`.
3. Treat `402` from any `/api/desktop/*` call as "licence lost": stop polling the queue, clear the cached licence, show the message above.
4. Self-update: download from the release's `downloadUrl` (now `/agent/download`) **with** `Authorization: Bearer <agent credential>`, follow the redirect to the signed URL, and keep verifying `sha256` before installing.
5. Release script: stop copying builds into the website's `public/downloads`. Upload the installer and source zip to the private `agent-releases` bucket (or commit them to `agent-releases/` until the bucket exists), then bump `src/config/agent-release.json` (`version`, `sha256`, `sizeBytes`, `storageKey`, `sourceStorageKey`).
6. Code-sign the installer (EV or OV certificate) so tampered builds are detectable and Windows stops warning.
7. Optional hardening: bind the stored credential to the machine with Windows DPAPI so copying the Agent's data folder to another PC doesn't carry the credential across.

## Not done yet

- User limits: stored per plan, but there is no team-invite flow yet to enforce them against.
- Evaluation workspaces have no cap on how many applications they run in 14 days.
- Daily crons (Gmail, Xero, workflow effects) still process lapsed organisations; they should skip them.
- Dunning emails beyond what Stripe sends itself.
