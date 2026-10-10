# Original PDF workflow restoration

The PDF upload and preparation mechanism is restored from GitHub commit [`bd752645e8805aac67371b6f3e4c2f0c7636f055`](https://github.com/jayC02/Architect-Web-Portal/commit/bd752645e8805aac67371b6f3e4c2f0c7636f055). The baseline was verified against GitHub and the local Git object. The archived baseline used for browser comparison has byte-identical upload pages, draft services and project sorting endpoint; its development configuration allows access to the shared installed dependencies.

Application PDF Drop selects files, creates one draft, uploads each file to its original signed storage PUT URL, finalises the uploads and opens the review page. The review page makes one awaited `/analyse` request. The original `classifyProjectDocumentBatch` integration analyses the PDFs with the configured Gemini/OpenAI provider, extracts facts and synthesises the prepared review. Existing applications use the original signed upload controls; existing projects use the original multipart upload and synchronous sorting review.

The active workflow ignores `DOCUMENT_PROCESSING_ENABLED`. It creates no `DocumentProcessingJob` records and does not use worker starts, leases, continuation requests, Vercel Cron or Supabase Cron. `/api/cron/document-processing` returns 410. The old document-worker entry point is inert. Legacy processing helpers and additive database tables remain for compatibility with the existing schema and historical records; they are unused by the restored UI/API paths. Desktop Agent jobs and their queue are separate and remain unchanged.

Compatibility changes retain cancellation tombstones, organisation-scoped access, document/review revision checks, saved form corrections and manual classifications. Finalisation confirms stored size; the original analysis request verifies PDF bytes and hashes. An invalid PDF or failed read is marked for attention without deleting the stored object. A removed file can be deliberately selected again by the original client. Already saved project upload intents can still finalise; their documents use the same awaited classifier. Existing project document analysis retries read the current stored PDF and update its existing record.

Phases 4–8 remain: client matching/search and separate applicant forms; Ideal Postcodes, address authority/UPRN/provenance and manual fallback; fee agreements, VAT/history and milestones; Xero reconciliation; project readiness, navigation, drawers, unsaved-change protection and responsive interfaces. No customer data or database schema was reset or removed.

## Execution and recovery

This restores the original request model and its practical execution limits. Application uploads bypass the function request body by transferring directly to storage. Existing-project multipart uploads retain the original Vercel body limit; packages beyond the [4.5 MB function request limit](https://vercel.com/docs/functions/limitations) need smaller uploads. No new transfer or processing architecture is added to bypass that limit.

The generated Node 24 function requests 240 seconds. [Hobby with Fluid Compute permits a maximum of 300 seconds](https://vercel.com/docs/functions/configuring-functions/duration); the deployed project's actual function settings still need checking before release. Provider timeouts remain bounded, with the original configurable maximum of 90 seconds per provider request. Large/slow packages can still exceed a function's duration.

An interrupted analysis keeps uploaded files and each completed document result. The review offers an explicit Retry preparation action using the same stored documents and original validated-result cache. Reopening a draft left in ANALYSING offers this action instead of waiting for a worker. There is no automatic preparation retry loop. An explicit Analyse again re-runs the original classifier; manual categories and saved client/site changes are retained. Provider failures lead to deterministic suggestions marked for manual review, as in the baseline, rather than a queue that never completes.

## Verification

Tests use synthetic organisations in the existing isolated schema `workflow_overhaul_preview_20261009`; production application tables are not used. Evidence is saved under `output/workflow/pdf-restoration`.

- Baseline and restoration: three PDFs produce identical classifications, client/site extraction, description and automatic Building Warrant routing in one awaited request. The restored flow creates zero processing jobs even with the retired flag set to true.
- Simulated lost analysis response: explicit retry uses the same three uploaded files, without duplicate document records or transfers.
- Improved review: existing-client matching, manual category correction, saved form values, reanalysis, adding a fourth PDF and Create Project pass in the browser.
- Existing project: original upload/sorting review adds two files; manual categories save successfully and original stored PDFs remain accessible. Existing-document retry uses the same record. Foreign-organisation requests return 404.
- Controlled provider outage: the original fallback reaches manual review; explicit reanalysis recovers extracted client information using the same document IDs. A synthetic conflicting-address evidence fixture displays both sources; the architect's corrected address survives another analysis.
- Real-provider browser journey: three valid synthetic PDFs uploaded to real hosted Supabase Storage and analysed by the configured Gemini provider (`gemini-3.5-flash-lite`), with the retired flag false. All returned SUCCESS with client/site extraction and document classifications. Existing-client matching, manual classification, review corrections, adding another application PDF, project creation and adding two project PDFs passed. No processing jobs were created. This ran against the local application and isolated database schema; hosted Vercel function execution has not been tested.
- Older PDFs: three documents created by the earlier overhaul test remain accessible with unchanged original metadata. A legacy storage URL without a storage key also opens successfully. These were synthetic prior-run documents; customer files were not inspected or changed.
- Project retry UI: an injected provider failure leaves Retry analysis available. A second click succeeds on the same document, retaining its manual category and document count.
- Final static/build checks: `npm run check` passes (438 files, zero errors/warnings, nine hints); `npm run build` passes and emits a Node 24 function with `maxDuration: 240`.
- Existing packaged regression checks: 26/28 pass. `agent-enrollment-security.test.ts` and `desktop-status.test.ts` fail on Agent UI source/wording assertions and reproduce on the archived baseline. The PDF restoration does not change those Agent components. Additional upload/review/security and retained address/finance workflow checks pass.

Evidence files include `mock-results.json`, `live-results.json`, `recovery-results.json`, `existing-pdfs-results.json` and browser screenshots in the directory above. The existing broader `workflow-browser.spec.ts` passes (2.2 minutes): original synchronous upload and project sorting, stored review reopening, applicant preservation, fee save recovery, keyboard/focus and unsaved-change protection, explicit Agent queue authorisation/removal, cancellation compatibility, foreign-organisation access and responsive layouts at 1440/1366/1024/390 pixels. Its report is `output/workflow/browser-results.json`.

## Reproducing the checks

Use the existing isolated schema with current additive migrations and synthetic fixtures. `scripts/workflow-isolated.mjs` overrides both database URLs to that schema. Do not run the verification scripts directly against a production schema.

For mocked verification, start `node scripts/workflow-mock-storage.mjs`, then run `node scripts/workflow-isolated.mjs dev` with `WORKFLOW_MOCK_STORAGE=true` and `WORKFLOW_MOCK_AI=true`. The baseline comparison also needs the exact `bd75264` archive at `output/workflow/baseline-app`, shared dependencies enabled in its development configuration, and `dev-main` on port 4332. Run `node scripts/workflow-isolated.mjs test scripts/workflow-verify-restored-pdf.ts`. Recovery and project retry checks use the corresponding `workflow-verify-restored-recovery.ts` and `workflow-verify-restored-project-retry.ts` scripts. Older-file checks use `workflow-verify-restored-existing.ts` and require the earlier synthetic Hobby fixture.

For real-provider verification, stop the mocked app server and start `dev` with `WORKFLOW_MOCK_STORAGE=false`, `WORKFLOW_MOCK_AI=false`, `WORKFLOW_LIVE_AI=true`, `WORKFLOW_REAL_STORAGE=true` and `WORKFLOW_BACKGROUND_PROCESSING=false`. Run the same PDF verifier through `test` with those settings. Private provider/storage credentials remain in the environment. This creates synthetic stored objects and isolated-schema records.

Run the retained broader browser checks through `node scripts/workflow-isolated.mjs test node_modules/@playwright/test/cli.js test --config playwright.workflow.config.ts` with the mocked settings. Historical lease/deadline tests exercise the retired architecture and are not acceptance tests for this restoration.

The restoration is delivered as a separate commit on the current development branch. No push, deployment, merge, production database migration, cron setup or environment update has been performed. Production release requires the user's approval.
