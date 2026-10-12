# Xero integration setup

Architect Pro uses Xero's standard OAuth 2.0 authorisation-code flow to import accounting data. The integration is read-only: it does not create, edit, send, approve, void or delete accounting records in Xero.

## Xero developer app

1. Sign in to the [Xero Developer portal](https://developer.xero.com/app/manage).
2. Create an app using the **Auth Code** grant type.
3. Add the Architect Pro company/homepage URL and the public Privacy Policy and Terms URLs.
4. Add the exact redirect URIs below. Xero requires an exact match; `127.0.0.1` is not accepted for local OAuth testing.
5. Copy the generated Client ID and create a Client Secret. Store both only as server-side environment variables.

Redirect URIs:

- Local: `http://localhost:4321/api/integrations/xero/callback`
- Production: `https://www.architectpro.co.uk/api/integrations/xero/callback`

If `PUBLIC_SITE_URL` points at another production hostname, register the corresponding `/api/integrations/xero/callback` URI in Xero and set `XERO_REDIRECT_URI` to that exact value.

## Required scopes

Architect Pro requests only these scopes:

```text
offline_access
accounting.contacts.read
accounting.invoices.read
accounting.payments.read
accounting.reports.profitandloss.read
accounting.reports.aged.read
accounting.settings.read
```

`accounting.settings.read` is required to read the Xero organisation's base currency and ShortCode for currency-safe display and supported Xero deep links. The deprecated `accounting.transactions.read` and `accounting.reports.read` scopes are not used.

Current provider references:

- [OAuth authorisation-code flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [OAuth scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Tenant connections](https://developer.xero.com/documentation/guides/oauth2/tenants/)
- [Token types and rotation](https://developer.xero.com/documentation/guides/oauth2/token-types)
- [Deep linking](https://developer.xero.com/documentation/best-practices/user-experience/deep-linking)

## Environment variables

Set these locally in `.env` and in the Vercel project's Production and Preview environments as appropriate:

```text
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_REDIRECT_URI=
XERO_TOKEN_ENCRYPTION_KEY=
```

Generate `XERO_TOKEN_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded as base64. Never reuse the Xero Client Secret as the encryption key and never expose these values through public/browser-prefixed variables.

`XERO_REDIRECT_URI` may be omitted only when `PUBLIC_SITE_URL` is correctly set; Architect Pro then derives the callback URL from the canonical site URL.

## Database and local setup

1. Configure `DATABASE_URL` and `DIRECT_URL` for the intended development database.
2. Apply the committed Prisma migration using the repository's normal deployment workflow.
3. Run `npx prisma generate`.
4. Add the local Xero variables above.
5. Start Architect Pro with `npm run dev`.
6. Sign in as an organisation OWNER or ADMIN.
7. Open **Settings → Integrations → Xero → Connect Xero**.
8. Authorise the Xero Demo Company or another test organisation. If Xero returns more than one organisation, explicitly choose the correct one.
9. Confirm that the connection card shows the Xero organisation and a successful initial sync. Use **Sync now** to repeat the idempotent import.

Unit and integration-source tests do not require real Xero credentials; the provider HTTP boundary is not contacted by those tests.

## Production setup

1. Register the production redirect URI in the Xero app.
2. Add all four Xero variables to Vercel as encrypted server-side environment variables.
3. Set `PUBLIC_SITE_URL=https://www.architectpro.co.uk` (or the canonical deployed origin).
4. Apply the Prisma migration before enabling the integration for users.
5. Redeploy so the environment and generated Prisma client are current.
6. Connect a test Architect Pro organisation to a Xero Demo Company and verify Contacts, invoices, payments, Profit & Loss, Aged Receivables, deep links and disconnect.

## Security and lifecycle

- OAuth state is a random, hashed, single-use database record bound to the current user and Architect Pro organisation with a ten-minute expiry.
- Access and rotating refresh tokens are encrypted at rest with AES-256-GCM through the existing server-side token encryption implementation.
- Xero tokens never appear in browser JavaScript, URLs, API responses or logs.
- A central token service reuses valid access tokens and atomically stores both replacement tokens after refresh. Refresh failures mark the connection as requiring reconnection.
- All snapshots and links carry an Architect Pro organisation ID and a connection ID. Every route re-checks ownership server-side.
- Finance pages and mutation routes are limited to OWNER and ADMIN roles for v1.
- Sync reads Xero and writes only local snapshot tables. Page rendering uses those local snapshots rather than live provider calls.
- Disconnect calls Xero's connection DELETE endpoint, then removes the local Xero connection. Cascades remove cached Xero snapshots and local Xero links; Architect Pro Clients and Projects remain untouched.
- Webhooks are intentionally deferred. Data freshness is manual/initial sync plus a visible last-successful-sync timestamp.

## Connection test checklist

- Connect as OWNER and ADMIN; confirm MEMBER is blocked.
- Reject/cancel one OAuth attempt and confirm no connection is created.
- Authorise multiple Xero organisations and confirm the selection page appears.
- Sync twice and confirm record counts do not duplicate.
- Confirm draft and voided invoices are not included in normal invoiced/outstanding metrics.
- Confirm part-paid and overdue invoices use `AmountDue`.
- Confirm mixed currencies display separately.
- Confirm Revenue YTD and Net Profit YTD come from the Xero Profit & Loss report.
- Link and unlink a Client contact and multiple Project invoices; confirm no Xero record changes.
- Disconnect and confirm cached finance data disappears while Architect Pro Clients and Projects remain.

## Deliberately deferred

Invoice creation/editing/sending, payment write-back, bank data, bills/accounts payable, expenses, payroll, Xero Files, automatic contact or invoice creation, webhooks, payment chasing, time/cost tracking and project profitability are not part of this read-only version.
