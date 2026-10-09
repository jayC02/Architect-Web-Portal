# Architect Pro workflow overhaul

## Baseline — 9 October 2026

Baseline commit: `bd75264`. The checkout was clean. No AGENTS.md files were found in this checkout or its parent directories.

Source-confirmed weaknesses: upload intent and finalisation each have an IP-based allowance of 20/15 minutes; serializable upload reservations do not handle conflicts; one 750 ms retry repeats transfer and finalisation together; draft additions duplicate upload code and omit content hashes; project uploads parse multipart bodies; finalisation deletes objects on missing/incomplete metadata; analysis runs in the HTTP request; agreed fees sum enabled milestones; fee replacement deletes history; Xero documentation incorrectly calls the integration read-only.

Production upload failures, storage-token expiry and concurrent database reservation failures have **not** been reproduced against live providers. They are hypotheses until live verification, not demonstrated production defects.

Baseline checks: Astro check passed (383 files, zero errors, three hints); address, building warrant fee, state-model and all seven orchestration suites passed. The security command stops in `agent-enrollment-security.test.ts` on a pre-existing source assertion for `alreadyConnectedAgents`; the current AgentSetupFlow uses a different implementation. Remaining security suites must be run individually. There is no lint script.

Local authenticated baseline screenshots are pending: the configured database did not respond successfully to the initial read-only connectivity probe. No real customer data, credentials or signed URLs are recorded here.

## Protected contracts

Authentication uses database-backed, hashed session tokens and an HTTP-only cookie. Each API resolves the active organisation on the server, checks project/draft ownership and checks Origin for mutations. Finance remains OWNER/ADMIN-only. Draft review/commit and authorisation remain separate. Desktop jobs retain immutable authorised input, execution ownership and architect submission review. Document processing jobs must never use AutomationJob or appear in the floating active Agent queue. No desktop Agent changes are required.

## Experience contract

The daily task is upload → processing → evidence review → project creation → optional finances → explicit queue authorisation. Use the existing Astro/React stack, typography and paper/ink/moss palette. Project sections are Overview, Applications, Documents, Finances and Activity; existing routes and anchors remain valid. Completed sections summarise information; substantial edits use a keyboard-accessible drawer with focus restoration. Small edits stay inline. Values survive failed saves; navigation warnings apply only to dirty values or unfinished local files.

The recovery path retains successful documents, separates transfer and verification from processing, and offers per-file retry/cancel. Unknown finance and authority values remain explicitly unknown. Project fee setup never blocks submission. Required states are empty, loading, partial, permission, offline, retrying, action required, error and success. Responsive verification targets 1440, 1366, 1024 and 390 pixels, keyboard operation and reduced motion.

## Release evidence

Implementation, migration, provider and browser results are appended as they are verified. Additive migrations must precede dependent code. Live storage, licensing and minute-level worker scheduling are release prerequisites; no upgrade or production deployment is implied by passing mocked tests.
