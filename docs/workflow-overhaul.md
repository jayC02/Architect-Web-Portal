# Architect Pro workflow overhaul

## Baseline — 9 October 2026

Baseline commit: `bd75264`. The checkout was clean. No AGENTS.md files were found in this checkout or its parent directories.

Source-confirmed weaknesses: upload intent and finalisation each have an IP-based allowance of 20/15 minutes; serializable upload reservations do not handle conflicts; one 750 ms retry repeats transfer and finalisation together; draft additions duplicate upload code and omit content hashes; project uploads parse multipart bodies; finalisation deletes objects on missing/incomplete metadata; analysis runs in the HTTP request; agreed fees sum enabled milestones; fee replacement deletes history; Xero documentation incorrectly calls the integration read-only.

Production upload failures, storage-token expiry and concurrent database reservation failures have **not** been reproduced against live providers. They are hypotheses until live verification, not demonstrated production defects.

Baseline checks: Astro check passed (383 files, zero errors, three hints); address, building warrant fee, state-model and all seven orchestration suites passed. The security command stops in `agent-enrollment-security.test.ts` on a pre-existing source assertion for `alreadyConnectedAgents`; the current AgentSetupFlow uses a different implementation. Remaining security suites must be run individually. There is no lint script.

The initial database connectivity probe failed. Connectivity was subsequently established and an isolated schema was created for synthetic fixtures. Twenty baseline screenshots were captured retrospectively from an archive of `bd75264` at 1440, 1366, 1024 and 390 pixels: project list, overview, prepared review, upload and historical finances. The archive used the installed dependencies/generated Prisma client and additive preview schema, so this verifies previous-page read compatibility, not a frozen historical production build or every previous write path. Evidence is in `output/workflow/baseline-screenshots/results.json`. No customer records were used.

## Protected contracts

Authentication uses database-backed, hashed session tokens and an HTTP-only cookie. Each API resolves the active organisation on the server, checks project/draft ownership and checks Origin for mutations. Finance remains OWNER/ADMIN-only. Draft review/commit and authorisation remain separate. Desktop jobs retain immutable authorised input, execution ownership and architect submission review. Document processing jobs must never use AutomationJob or appear in the floating active Agent queue. No desktop Agent changes are required.

## Experience contract

The daily task is upload → processing → evidence review → project creation → optional finances → explicit queue authorisation. Use the existing Astro/React stack, typography and paper/ink/moss palette. Project sections are Overview, Applications, Documents, Finances and Activity; existing routes and anchors remain valid. Completed sections summarise information; substantial edits use a keyboard-accessible drawer with focus restoration. Small edits stay inline. Values survive failed saves; navigation warnings apply only to dirty values or unfinished local files.

The recovery path retains successful documents, separates transfer and verification from processing, and offers per-file retry/cancel. Unknown finance and authority values remain explicitly unknown. Project fee setup never blocks submission. Required states are empty, loading, partial, permission, offline, retrying, action required, error and success. Responsive verification targets 1440, 1366, 1024 and 390 pixels, keyboard operation and reduced motion.

## Release evidence

Implementation, migration, provider and browser results are appended as they are verified. Additive migrations must precede dependent code. Live storage, licensing and minute-level worker scheduling are release prerequisites; no upgrade or production deployment is implied by passing mocked tests.

## Implementation — 10 October 2026

The implementation is complete in the local checkout and has passed the final production build and isolated journey checks. **Production rollout and live-provider acceptance remain outstanding.** The user's Vercel plan is Hobby/free; processing defaults to disabled. No upgrade, licence purchase, deployment, production migration, scheduled job or production environment update was performed.

| Phase | Delivered change |
| --- | --- |
| 0 | Baseline findings, protected authentication/organisation/finance/Agent contracts, synthetic historical and conflict fixtures, original-commit screenshots and regression comparisons. |
| 1 | Compact project header, section navigation and accessible native edit drawers; shared section, selection and recovery components; retained paper/ink/moss styling and anchors. |
| 2 | One staged upload controller for new PDF packages, draft additions and project files; private signed PUT and pinned TUS above 6 MiB; three transfers; byte progress; per-file cancel/retry; independent verification; five attempts per failed stage; timeouts/offline pause; content hashes; atomic authenticated allowances and bounded reservation transaction retries. |
| 3 | A separate PostgreSQL document queue, idempotent document/version identity, two active leases per organisation, lease generation/expiry fencing, bounded worker and provider timeouts, five processing attempts, manual retry, revision-fenced prepared reviews and best-effort immediate execution. Protected scheduled endpoint and Hobby-compatible scheduler template are prepared. |
| 4 | Client/applicant summaries, searchable organisation-scoped clients with match reasons, retained separate applicant values, explicit shared-directory editing and autosave revision conflicts. Controls wait for hydration. |
| 5 | Server-only licensed Ideal Postcodes search/resolve, debounce/cancellation/cache and resolution caps; string UPRN and provenance; unique supported extracted-address verification; evidence-preserving conflict choices; editable manual fallback; separate administrative/planning/building authorities and versioned Scottish routing. |
| 6 | Explicit net agreement and VAT treatment, optional schedule/template/notes, decimal validation and deterministic percentage pennies, stable milestone identifiers, optimistic revisions and fee audit history. Waiving milestones retains the agreed contract. |
| 7 | Tested project finance service, separated net/gross/cash/credit/balance metrics, London overdue dates, currency separation and unknown stale/legacy totals; ranked explicit invoice links; credit snapshots/allocations; preserved opt-in idempotent Xero draft creation with agreement/tax-rate checks. Documentation describes optional write authorisation. |
| 8 | Readiness derived from fresh server preflight, actionable editor/document links, processing/retrying/review/blocked states and optional professional finances; responsive project register and retained explicit queue authorisation, active Agent queue and removal. No desktop Agent reinstall is required. |
| 9 | Six additive Prisma migrations, isolated database and authenticated browser verification, before/after screenshots, scoped and existing regressions, production build, monitoring queries, configuration prerequisites and rollback instructions. |

The primary workflows use direct transfer and durable processing. Older multipart document and sort-batch routes remain for compatibility; their legacy synchronous behaviour has not been completely retired. Local files remain in browser memory only. Refresh offers unfinished server records and matching-file reselection; a closed tab cannot retain the local file itself.

## Demonstrated fixes

- A lost finalisation success response triggers verification again with **one file transfer**, returning the same persisted document.
- Three simultaneous identical reservations converge on one intent; a complete 20-file package fits, and the 21st file is rejected atomically. Same-size/name content identities include SHA-256. Cancelled upload tombstones cannot be finalised or shown as active documents after refresh.
- A fresh file selection has a stable attempt identifier. Reselection reuses matching active content, while deliberate selection after cancellation creates a fresh intent. Old cancelled attempts and late storage completions remain fenced. Removing a project document cancels its upload identity and active processing job, allowing future re-upload without resurrecting the removed record.
- A 7 MiB project PDF uses the real TUS client against mocked storage. An injected expired storage token causes authenticated refresh and HEAD resume: one TUS creation, two PATCH requests, no second file record. Project photos remain supported.
- After the browser page closes, server processing generates a prepared review from the persisted queue. The database lease test expires an owner and proves that only the replacement generation can write. This is **local worker/recovery evidence**, not verification of a hosted minute scheduler or a killed production function.
- Duplicate explicit project-analysis retries reuse one exhausted job, do not reset successful work and preserve manual classification. Retrying never requires upload.
- The 105/147 conflict is resolved, both document/page sources remain in the evidence, an obsolete address response cannot replace a later manual edit, and provider failure leaves manual values intact.
- Browser testing exposed an autosave race when a value was changed back during a pending save. Saved-value tracking now follows the actual completed server snapshot before persisting newer edits. An SSR button/hydration race was also fixed.
- An isolated Supabase pooler exposed raw locks/rate counters relying on `search_path`. New SQL explicitly qualifies the configured Prisma schema; tests assert and exercise that isolation.
- Failed fee saves preserve entered values. A £100.01 agreement allocates 25/50/25 as £25.00/£50.01/£25.00. Historical VAT/agreement unknowns remain unknown; a £120 invoice with £30 paid shows £90 outstanding. A waived milestone retains its identifier, audit entry and unknown historical contract; stale revisions return 409.
- Project list overflow at tablet width was corrected. Native project/client drawers support Escape, dirty-discard confirmation and focus restoration. A successful fee save clears the drawer's navigation warning before reload.

## Migrations and compatibility

All six migrations were applied successfully **only** to `workflow_overhaul_preview_20261009` in the existing Supabase database. The production/public application schema was not migrated. New records are synthetic test organisations/users/documents, not real customer fixtures.

| Migration | Additions |
| --- | --- |
| `20261009120000_workflow_upload_recovery` | Review/document-set revisions, document cancellation marker, shared upload allowances and project upload intents. |
| `20261009123000_document_processing_queue` | Dedicated document/preparation jobs, attempts, scheduling, leases, fencing and indexes. |
| `20261009130000_verified_site_addresses` | String UPRN, provider/time/provenance and separate authorities; legacy/unverified default. |
| `20261009133000_project_fee_agreements` | Nullable agreement, explicit legacy VAT default, fee revisions/audit and fixed/percentage schedule fields. |
| `20261009140000_xero_credit_reconciliation` | Nullable credited/net-credited invoice amounts and credit-note allocation snapshots. |
| `20261009143000_workflow_private_tables` | RLS and browser-role revocation on the five new server-owned tables. |

No invented fee/tax/authority backfill and no destructive schema rollback were used. Existing response fields/routes remain, with additive revision and upload/processing/address/fee/readiness fields. New callers send review/fee revisions; old clients can continue using compatible routes, but cannot provide the same concurrent-edit protection without supplying a revision. Immutable already-authorised Agent snapshots are not rewritten. The original application rendered all five representative screens with HTTP 200 against the migrated synthetic database; old write paths have not been comprehensively certified.

## Executed verification

Evidence is stored locally under ignored `output/workflow` and `output/playwright/workflow`; provider credentials and signed URLs are not included in this report or screenshot manifests.

| Check | Result and evidence |
| --- | --- |
| `npm run check` | **Pass:** 427 files, zero errors, zero warnings, nine hints. `output/workflow/final-check.log`. |
| `npm run build` | **Pass:** Prisma generation, server/client build and Vercel function bundling completed. `output/workflow/final-build.log`. |
| All local non-browser `.test.ts` files except isolated DB | **57/65 pass**, including four new workflow suites and existing Xero metrics/security, address, state, orchestration, queue removal and lease safeguards. Eight failures reproduce on `bd75264`; detailed results and original/current logs are in `output/workflow/regression`. The runner returns nonzero while those failures remain. |
| New upload behaviour | **Pass:** five-stage attempts, permanent 507/session/permission stops, cancellation, offline attempt preservation, hashes, concurrency, finalisation-only retry and transaction-conflict handling. |
| New processing/address/finance suites | **Pass:** owner/generation/expiry fencing; licensed flat/named-address/UPRN/park/outage cases; penny allocation, partial/full cash, credits, draft/void exclusion, currencies, unknown net and London dates. |
| Real isolated database integration | **Pass:** 20-file concurrent capacity, idempotent verification, cancellation, cross-org rejection, two leases, replacement fencing, manual analysis retry and historical fee revisions. `output/workflow/database-final.log`. |
| Main authenticated Playwright journey | **Pass:** PDF upload with injected network interruption → page closure → prepared review → separate applicant confirmation → project creation → failed fee save/retry → explicit application queue/removal. Actual TUS client plus photo support; 1440/1366/1024/390 widths on five screens; keyboard/dirty dismissal/focus checks; no horizontal overflow or page errors. `output/workflow/browser-results.json`; 21 screenshots in `output/playwright/workflow/screenshots`. |
| Extended authenticated browser journey | **Pass:** conflict choices/evidence, stale address response, outage/manual fallback, conflict project queueing, historical partial payment/unknown agreement, audited waiver and stale edit, empty-project readiness action. `output/workflow/extended-results.json`; two screenshots. |
| Previous-code baseline | **Pass for representative page reads:** 20 retrospective screenshots, all HTTP 200. `output/workflow/baseline-screenshots`. |
| Lint | No lint script exists; no lint pass is claimed. |
| Hosted/live providers | **Not executed:** live private Supabase PUT/TUS, external minute recovery, AI provider document analysis, licensed Ideal Postcodes and Xero Demo Company OAuth/sync/write. Mocked storage/provider results are recorded separately above. |

The eight pre-existing failures are `agent-enrollment-security`, `application-title-default`, `contained-application-management`, `desktop-start-acknowledgement`, `desktop-status`, `settings-simplification-ui`, `sign-in-screenshot-showcase` and `site-building-number-flow`. They assert obsolete source locations/wording or a stale VM import harness; each also fails against the archived original commit with the installed dependencies. They remain visible and were not silently bypassed. Changed upload retry and shared-selector assertions were updated to their intentional new contracts; behavioural coverage verifies the corresponding flows.

Screen-reader labels/native dialog semantics and reduced-motion browser settings were checked, but no assistive-technology user session or formal contrast audit was performed. Synthetic minimal PDFs exercised the deterministic fallback classifier; they do not establish live AI extraction quality on customer drawings. Dependency audit still reports existing issues in the broader dependency tree; no unrelated dependency upgrade was undertaken.

## Provider setup and Hobby recovery

1. Apply the additive migrations to the intended **isolated hosted preview database** before deploying the final branch. Use the normal `npm run db:deploy` workflow and generate Prisma through the build. Do not point an ordinary preview at production data.
2. Configure a private Supabase bucket and server-only service-role credentials. Verify signed PUT, hash checking, metadata/read permissions, TUS signed-token behaviour, cancellation and recovery against actual storage. Local mock tokens/endpoints must never become deployment configuration.
3. Keep `DOCUMENT_PROCESSING_ENABLED=false` for the normal Hobby workflow: click-to-analyse awaits bounded synchronous work and automatically continues through further requests while the review page is open. No scheduler, paid plan or additional service is required. Uploaded files and individual results persist across requests. The app requests a 240-second function duration; verify the generated deployment uses it. The inline request deadline is 180 seconds from handler entry, provider operations abort after 80 seconds, and interrupted claims recover after a 120-second lease. Hobby Fluid Compute supports up to 300 seconds. [Vercel duration limits](https://vercel.com/docs/functions/configuring-functions/duration).
4. **Optional background mode only:** Hobby Vercel Cron permits daily runs and rejects a minute expression. The minute example JSON is **not** the active project configuration. Either explicitly arrange an appropriate Vercel plan, or configure an external minute scheduler such as the existing Supabase database's Cron. No upgrade is necessary for the prepared external-scheduler approach itself, but quotas/availability and runtime reliability still need verification. [Vercel limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Supabase Cron](https://supabase.com/docs/guides/cron).
5. **Optional background mode only:** The database probe found `pg_cron` and `pg_net` available but not installed, with Vault already installed. `docs/rollout/supabase-worker-cron.example.sql` is an **unapplied setup template**, not a Prisma migration. Enable extensions in the Supabase dashboard, add the hosted HTTPS endpoint and matching secret to Vault, then schedule. For a protected preview, separately provide the deployment-protection bypass through a secret header; the template assumes the endpoint is reachable. Check actual HTTP responses as well as cron execution status.
6. **Optional background mode only:** Before enabling `DOCUMENT_PROCESSING_ENABLED=true`, use a random `CRON_SECRET` of at least 32 characters and verify unauthorised calls receive 401. In the hosted isolated organisation, disable immediate start or interrupt a leased invocation, close the browser, and confirm a later scheduled call recovers and completes without duplicate writes. A successful `net.http_get` enqueue alone does not prove processing. Only after those checks should processing be enabled for the intended rollout.
7. Configure an AI provider only after credentials/model access and real-PDF timeout/error handling are checked. The blank-provider deterministic fallback remains supported.
8. Confirm the Ideal Postcodes platform sublicensing key, per-organisation licensees and price before setting `IDEAL_POSTCODES_PLATFORM_LICENSED=true`, `IDEAL_POSTCODES_API_KEY` and `IDEAL_POSTCODES_LICENSEES`. Ordinary published pack prices and the licence distinction are recorded in `docs/address-preparation.md`. Manual saving remains available with lookup disabled.
9. Connect an isolated organisation to Xero Demo Company. Check duplicate-free repeated sync, partial/full payments, full/partial mixed-tax credits and stale/disconnected views. Separately authorise the existing optional invoice-write scope and verify only a DRAFT is created, with matching agreement VAT/account tax settings. No approval or send action is added.

## Monitoring and rollback

`docs/rollout/workflow-monitor.sql` supplies identifier/count-only queries for backlog age, retry states, expired leases, unfinished uploads and Xero freshness. Configure the deployment log/metrics view for upload-intent and finalisation HTTP status/latency, repeated verification requests for the same stable document, address resolve failure rates and Xero sync failures. Transfer-stage recovery itself must also be checked in the storage/TUS metrics; repeated finalisation is a proxy, not a complete automatic-recovery metric. No dashboard or alert service has been provisioned.

Worker diagnostics include job/organisation identifiers, phase, attempt and retry state. Inspect sanitised counters/statuses; do not export provider payloads, document contents, tokens, signed upload URLs or Vault headers. Investigate rising oldest backlog, expired leases or repeated five-attempt failures; explicit retries retain documents and manual classification.

To stop optional background processing, set `DOCUMENT_PROCESSING_ENABLED=false` and redeploy, and unschedule the external cron if used. Click-to-analyse continues to work synchronously with this flag disabled. Disable licensed resolution with its licence flag. Roll back the complete code release if necessary while retaining all additive tables, uploaded objects and audit history. Avoid destructive down migrations and avoid using an older fee replacement endpoint to rewrite new agreements/history. Unfinished local files may need reselection. Synthetic preview fixtures/schema are retained for inspection; no destructive cleanup was performed.

## Reproducing isolated checks

Start `node scripts/workflow-mock-storage.mjs` and, in a separate PowerShell window, set `$env:WORKFLOW_MOCK_STORAGE='true'` before `node scripts/workflow-isolated.mjs dev`. The isolated helper enforces the fixed preview schema; `init` applies migrations there, and `test tests/workflow-database.test.ts` runs the real database suite. Keep `.env` credentials private.

Run `node node_modules/@playwright/test/cli.js test --config playwright.workflow.config.ts`, then generate fresh extended fixtures with `node scripts/workflow-isolated.mjs test scripts/workflow-browser-fixtures.ts` and run `node scripts/workflow-verify-extended.mjs`. The extended scenario changes its synthetic draft/milestone, so regenerate those fixtures before repeating it. Run `node scripts/workflow-tests.mjs --all` for all local test files; original-commit comparison requires an archive under `output/workflow/baseline-app` with access to the installed dependencies. Baseline screenshot helpers also require that archive and the synthetic fixture manifest. Stop the task's Astro servers before `npm run build` on Windows to release Prisma's engine DLL.

## Delivery commits

The branch is `codex/workflow-overhaul`. The baseline and shared-experience commits precede a dedicated additive-schema prerequisite, then phase-labelled implementation and verification commits. Shared components/services carry some cross-phase interfaces, so deploy and validate the **complete branch**; intermediate commits are review boundaries, not independently certified releases. No push or hosted deployment is included in this delivery.

| Review area | Commit |
| --- | --- |
| Baseline and protected contracts | `95f9058` |
| Shared project experience | `3c0f708` |
| Additive schema prerequisites | `61ca1fd` |
| Phase 2: staged uploads | `cef7c7e` |
| Phase 3: durable processing | `29bd657` |
| Phase 4: client/applicant review | `bdf4931` |
| Phase 5: address resolution | `5acbf83` |
| Phase 6: fee agreements | `f8f73ec` |
| Phase 7: Xero reconciliation | `e00a1ff` |
| Phase 8: readiness and responsive rows | `b20aed9` |
| Cancellation/reselection and loading safeguards | `c3aa7ca` |
| Phase 9: verification and rollout helpers | `a8bba30` |

The final authenticated browser run passed in 2.9 minutes with the additional cancellation, late transfer, document removal and reselection checks. Earlier development-only runs hit Vite's stale dependency cache (504 Outdated Optimize Dep); clearing the cache and waiting for loaded upload handlers resolved that local fixture issue. Production build output uses bundled dependencies and does not use that development cache.


## Hobby PDF regression correction - 10 October 2026

The original queue-only route rejected normal analysis with the default disabled-worker flag. This was a regression. The corrected route awaits analysis and preparation when that flag is false; scheduling remains an optional mode. No production environment, database migration, deployment or merge was performed for this correction.

Compared with `main` (`3c0f708`), restored application-type/notes context, successful evidence reuse from organisation-scoped draft/project caches, and multiple-Location-Plan review safeguards. Extraction still uses the existing classifier, fact collection, synthesis, client/site matching and readiness checks. An unedited initial review generated from failed analysis is rebuilt after recovery; saved reviews retain architect edits and manual classifications. Pending autosave is flushed before the review's retry action.

Inline work uses the existing persisted job identities and ownership fences, limited to the requested draft. Each request claims at most two operations (documents or preparation). Bulk queue setup counts towards the 180-second request deadline. The runner reserves 110 seconds before claiming another operation, aborts provider work after 80 seconds, and leaves a 120-second lease for crash recovery. Upload retries, hashes, idempotency and cancellation remain intact. Transient analysis failures retain exponential retry delays and the five-attempt cap. Exhausted failures expose retry/manual review without deleting files or repeating successful analysis.

The API returns 202 with a continuation delay while work remains and 200 once preparation finishes. The review page continues awaited requests automatically, respects retry times/live claims, and stops with a retry action on request errors. Reopening an analysing draft resumes it. A terminated request is reclaimed after its lease expires. When every page is closed, remaining work waits for a later visit or explicit retry; no scheduler is required to resume. Error copy explains that uploads and completed evidence are saved.

Verified on the final correction:

- **Browser/main comparison:** three PDFs on `main` and the fixed branch produced identical client, site, application and document-classification values under controlled AI responses. Main used one analysis request; the Hobby path used two. All three files transferred once, including an injected lost finalisation response. Prepared review confirmation and project creation passed.
- **Recovery:** lost analysis response and same-button retry without extra transfer; transient AI 503, closed page and reopened review with automatic completion; live claim respected then expired-lease recovery; stale-owner writes rejected; five failed attempts followed by retry of only the failed PDF; recovered client extraction and saved manual review/classification preservation; foreign-organisation analysis rejected. Evidence: `output/workflow/hobby/results.json` and screenshots.
- **Live AI:** three valid one-page synthetic PDFs went through the existing Gemini configuration with `DOCUMENT_PROCESSING_ENABLED=false`, the real isolated database and loopback storage. Two requests, three transfers, all three documents `SUCCESS`, extracted Anna Campbell/contact/address, and correct Location Plan/Proposed Plans classifications. Evidence: `output/workflow/hobby/live-ai-results.json` and `live-gemini-review.png`. This validates synthetic extraction, not general quality on customer drawings. Actual Supabase Storage remains a hosted verification item.
- **Budget/capacity:** the isolated database test reserved 20 PDFs idempotently and returned continuation without claiming work after an exhausted request deadline. Provider deadline and retryable OpenAI status tests passed. Existing lease/upload recovery/database tests passed.
- **Relevant regression suite:** 26 of the 28 existing package checks passed. The two failures (`agent-enrollment-security` and `desktop-status`) reproduce on the archived original and concern existing Agent UI wording. Additional workflow upload, processing, deadline and batch tests passed. They remain separate from the verified PDF journey.
- **Final validation:** `npm run check` passed across 433 files with zero errors, zero warnings and nine hints. `npm run build` passed. The generated Node 24 Vercel function declares `maxDuration: 240`. Logs are in `output/workflow/hobby/final-check.log` and `final-build.log`.

Reproduce the mocked comparison by archiving `main` into `output/workflow/main-app`, starting the loopback storage fixture, and running both `dev-main` and `dev` through `scripts/workflow-isolated.mjs` with `WORKFLOW_MOCK_STORAGE=true`, `WORKFLOW_MOCK_AI=true`, and `WORKFLOW_BACKGROUND_PROCESSING=false`. Run `node scripts/workflow-isolated.mjs test scripts/workflow-verify-hobby.ts`. For live Gemini, stop both app servers, use `WORKFLOW_MOCK_AI=false`, `WORKFLOW_LIVE_AI=true` with the same disabled-background/storage-fixture settings, start `dev`, then run `test scripts/workflow-verify-live-ai.ts`. Keys remain in the private environment. Run the isolated budget test via `test tests/workflow-inline-batch.test.ts`; like the database suite, it requires the isolated schema and is excluded from the generic local-unit runner.
