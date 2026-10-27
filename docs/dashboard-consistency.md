# Dashboard consistency and reliability

The redesigned dashboard remains the implementation. It now uses the same AppShell, Aptos typography, paper background, ink/moss palette, shared panels, fields and buttons as the Projects page. The pipeline, project register, deadlines, attention list, practice statistics, document review, automation, Agent setup and expandable calendar remain available.

## Functional changes

- Project search covers all non-archived active records, including client, address and internal reference. The register paginates six rows at a time without limiting the searchable records.
- Every pipeline phase filters the register. Survey/design and warrant/construction stay grouped; completed projects appear in Completion even if their saved stage has not been advanced. Archived records are excluded, and on-hold projects are identified.
- Deadline ranges include today and the remaining calendar days in Europe/London, plus every overdue deadline. BST/GMT boundaries and the final evening are included correctly. A stale stored OVERDUE flag cannot override the actual date.
- Deadline actions target the project's existing deadline section. Planning and warrant attention items target their exact application preparation record. Review items open the project's files.
- Only APPROVED documents count as approved. Draft, review, rejected and superseded states remain distinct. Rejected/superseded location plans cannot satisfy the missing-plan check.
- Automation is grouped by application and retains unresolved execution ownership. Ready jobs require a valid ready preflight and unchanged sources, using the existing application freshness service. Authorised jobs are queued; running jobs require a current heartbeat and lease. Disconnected claims are flagged for review rather than presented as running or bypassed by newer preparations.
- Attention/deadline lists can reveal every result. Future review actions stay hidden until available. Request cancellation, mutation refresh, loading, retry and retained data after a failed refresh are preserved. Visible dashboards refresh periodically and on return to the page.

## Scope

No database records or schemas, global styles, Tailwind tokens, shared AppShell, other page files, dependencies, or existing homepage work were changed by this pass. Calendar changes are optional and enabled only by the dashboard; its normal rendering and query bounds are unchanged.

## Verification

- `npm run check` — no errors or warnings; existing unrelated hints remain.
- `npm run build` — production build, including Prisma generation.
- `npm run test:security` — existing authentication, tenant isolation, uploads, preparation, handoff, project workspace and status checks.
- `npm run test:agent-reliability` — existing queue withdrawal, cancellation, stale claim races, execution exclusivity and release integrity checks.
- `npx tsx tests/dashboard-reliability.test.ts` — date boundaries, phases, document counts, automation state/freshness, ownership, register coverage, authentication, tenant scope and default calendar compatibility.
- `scripts/verify-dashboard-data.mjs` — read-only comparison against independent queries of the configured practice's real records.
- `scripts/verify-dashboard-native.browser.mjs` — real-data rendering, every dashboard control, destination validation, all-record search, pagination, completion, deadline expansion, rapid range changes, recovery, keyboard focus, and 320–1920px layouts. Synthetic edge cases are intercepted only in browser memory.

The final browser run passed 100 checks with no browser runtime errors. Local screenshots and results are under `output/playwright/dashboard-native/`. The source scope check also confirmed ten unrelated files were unchanged and the default Calendar HTML was byte-identical.

The localhost preview is read-only. Agent installation, queue mutations and council submissions were not executed against live services. Existing disconnected claims remain intact for the user to inspect and resolve through the established application workflow.
