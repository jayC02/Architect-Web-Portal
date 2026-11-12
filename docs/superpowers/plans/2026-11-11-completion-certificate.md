# Completion Certificate (Main Details) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Architects prepare a completion certificate from an existing warrant on the website, and the Agent fills the portal's Completion Certificate → Main Details section through to completion.

**Architecture:** A third automation job type, `COMPLETION_CERTIFICATE`, travels through the existing queue, claim, progress and callback machinery unchanged. The website stores completion answers in their own JSON field on the warrant and builds a snapshot v2 with a new `completionCertificate` section. The Agent gains a separate `automation/completion_certificate` workflow that reuses the warrant workflow's login, agent/applicant entry and certificate validation.

**Tech Stack:** Website: Astro 5, React 19, Prisma 6 / Postgres, Zod, `tsx` test scripts. Agent: Python, Selenium, PySide/Qt, `pytest`.

**Spec:** `docs/superpowers/specs/2026-11-11-completion-certificate-design.md` (website repo). Read it with this plan; portal element IDs and the screen table live there.

## Global Constraints

- Two repositories. Website: `D:\Jayveer\Documents\websites\Architect Web Portal`. Agent: `C:\Users\Jayveer\Building Portal`. Each gets a branch named `feature/completion-certificate`. Nothing is pushed.
- **Never apply a migration.** `.env` points at a live database. Write the migration SQL by hand and run only `npx prisma generate`. `npm run db:migrate` and `npm run db:deploy` are the owner's steps.
- No test may need a live database, the real portal, real credentials or the Windows Credential Manager.
- The callback contract (`desktopJobStatusSchema`) and progress contract do not change.
- Portal wizard prefix: `MainContent_CompletionCertificateAppWizard_`. Keep the portal's spelling `rbSumissionCoverYes`.
- Portal dates are typed as `dd/mm/yyyy`; snapshot dates are ISO `yyyy-mm-dd`.
- Text limits: amendment dates 750, continuing requirements 750, certificate entries per register 20.
- Registration codes — construction: Part 1 `NIC1` `SEL1` `SNP1`, Part 2 `C` (certifier) and `CB` (approved body). Design / Form Q: Part 1 `BRE1` `BRE2` `RIA1` `RIA2` `SER1`, Part 2 `D` and `DB`.
- Never repeat a portal action whose result is uncertain: Add Additional Forms, register Add, Validation Check, Next. Never click register Remove.
- Completion jobs must not change `WarrantStatus`, warrant `preparationData`, deadlines, calendar events or Xero milestones.
- Agent version becomes `4.2.15`. Website release metadata (`src/config/agent-release.json`) is not changed in this plan.
- Fixed answers (spec, "Fixed answers") are constants, not user input.

## Review Focus

1. **Address formatting differs between Architect Pro and the portal** (case, commas, postcode spacing). The Proposal Summary check must treat `112 Ralston Avenue, Glasgow G52 3NB` and `112 RALSTON AVENUE, GLASGOW, G52 3NB` as the same, and report both strings when they genuinely differ. Test in Task B4.
2. **Double-click on Confirm and send.** Two rapid requests must produce one job, not two. Test in Task A6.
3. **Text at the limit.** Exactly 750 characters is accepted, 751 is rejected, and line breaks in amendment dates survive to the portal textarea. Tests in Tasks A2 and B6.
4. **Dates.** Single-digit days and months format as `05/03/2026`; a malformed or future date is refused before any portal action. Tests in Tasks A2 and B3.
5. **Client has title "Other" or no title.** Queueing is blocked on the website with a message naming the client record, not discovered mid-run. Test in Task A2.

---

# Part A — Website

All paths relative to the website repo. Run a single test with `npx tsx tests/<file>`.

### Task A1: Branch, schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`enum AutomationJobType`, `model BuildingWarrantApplication`)
- Create: `prisma/migrations/20261111120000_completion_certificate/migration.sql`

**Interfaces:**
- Produces: `AutomationJobType.COMPLETION_CERTIFICATE`; `BuildingWarrantApplication.completionPreparationData: Json?`, `.completionPreparedAt: DateTime?`.

- [ ] **Step 1:** `git checkout -b feature/completion-certificate`.
- [ ] **Step 2:** Add `COMPLETION_CERTIFICATE` as the last value of `AutomationJobType`. Add the two optional fields after `preparedAt` on `BuildingWarrantApplication`.
- [ ] **Step 3:** Write the migration by hand:

```sql
ALTER TYPE "AutomationJobType" ADD VALUE 'COMPLETION_CERTIFICATE';
ALTER TABLE "BuildingWarrantApplication"
  ADD COLUMN "completionPreparationData" JSONB,
  ADD COLUMN "completionPreparedAt" TIMESTAMP(3);
```

- [ ] **Step 4:** Run `npx prisma generate`. Expected: "Generated Prisma Client". Run `npx prisma validate`. Expected: "The schema at prisma\schema.prisma is valid".
- [ ] **Step 5:** Commit: `feat: add completion certificate job type and preparation fields`.

### Task A2: Completion preparation domain module

**Files:**
- Create: `src/lib/completion-certificate.ts`
- Test: `tests/completion-certificate-preparation.test.ts`

**Interfaces:**
- Consumes: `CERTIFIER_REGISTRATION_PART1_CODES` from `src/lib/certifier-registration.ts`.
- Produces:
  - `CONSTRUCTION_REGISTRATION_PART1_CODES = ['NIC1','SEL1','SNP1'] as const`
  - `REGISTER_PART2 = { construction: { certifier: 'C', approvedBody: 'CB' }, design: { certifier: 'D', approvedBody: 'DB' } } as const`
  - `COMPLETION_FIXED_ANSWERS` — the literal object in the spec's `fixedAnswers`.
  - `certificateEntrySchema(register: 'construction' | 'design')`, `completionPreparationSchema` (every answer nullable, shape as spec "Completion preparation shape"), type `CompletionPreparation`.
  - `emptyCompletionPreparation(): CompletionPreparation`
  - `completionPrefill(source: CompletionPrefillSource): CompletionPreparation` where `CompletionPrefillSource = { warrantReference: string | null; grantedDate: Date | null; amendmentGrantedDates: Date[]; warrantPreparation: Record<string, unknown>; certifier: { registrationAPart1?: string | null; registrationAPart2?: string | null; registrationBPart1?: string | null; registrationBPart2?: string | null } | null }`
  - `mergeCompletionPreparation(saved: unknown, prefill: CompletionPreparation): CompletionPreparation` — a saved non-null answer wins; saved entries win when the saved list is non-empty.
  - `completionIssues(preparation: CompletionPreparation, parties: CompletionParties, today: Date): Array<{ field: string; message: string }>` where `CompletionParties = { client: { title; otherTitle; firstName; lastName; buildingNumber; addressLine1; townCity; postcode; country } | null; agent: { firstName; lastName; email; phone; buildingNumber; addressLine1; townCity; postcode; country } }` (all `string | null`).
  - `formatPortalDate(iso: string): string` → `dd/mm/yyyy`.

- [ ] **Step 1: Write the failing tests** — one `assert` block per rule:

```ts
// prefill
const prefill = completionPrefill({ warrantReference: '26/01234/WARR', grantedDate: new Date('2026-03-05'),
  amendmentGrantedDates: [new Date('2026-06-01'), new Date('2026-07-09')],
  warrantPreparation: { scottishMinistersRelaxationDirection: true, relaxationReference: 'RD/1', relaxationDate: '2026-02-01',
    approvedCertifierOfConstruction: false, designCertifierSelected: true },
  certifier: { registrationAPart1: 'SER1', registrationAPart2: '1234', registrationBPart1: 'SER1', registrationBPart2: '77' } });
assert.equal(prefill.workCompletedDate, null);                      // never defaulted
assert.equal(prefill.warrantDate, '2026-03-05');
assert.equal(prefill.amendmentDates, '01/06/2026\n09/07/2026');
assert.deepEqual(prefill.relaxation, { applies: true, reference: 'RD/1', date: '2026-02-01' });
assert.equal(prefill.constructionCertificates.accompany, false);
assert.equal(prefill.designCertificates.entries[0].certifierRegistration.part2, 'D');
assert.equal(prefill.designCertificates.entries[0].approvedBodyRegistration.part2, 'DB');
assert.equal(prefill.energyPerformanceCertificate, null);

// merge: saved wins, prefill fills gaps
// issues: complete preparation + complete parties => []
// issues: each of these adds exactly one issue with the named field
//   workCompletedDate null; workCompletedDate '2999-01-01' (future); warrantReference null; warrantDate null;
//   relaxation.applies true with no reference; constructionCertificates.accompany true with [] entries;
//   a construction entry with part1 'BRE1' (wrong register); designCertificates.accompaniedWarrant true with formQRequired null;
//   formQRequired true with [] entries; energyPerformanceCertificate null; continuingRequirements.applies true with no details;
//   client null; client.title null; client.title 'Other' with otherTitle null; client with neither buildingNumber nor a building name in addressLine1.
// limits
assert.equal(completionPreparationSchema.safeParse({ ...complete, amendmentDates: 'x'.repeat(750) }).success, true);
assert.equal(completionPreparationSchema.safeParse({ ...complete, amendmentDates: 'x'.repeat(751) }).success, false);
assert.equal(completionPreparationSchema.safeParse({ ...complete, continuingRequirements: { applies: true, details: 'x'.repeat(751) } }).success, false);
// dates
assert.equal(formatPortalDate('2026-03-05'), '05/03/2026');
assert.throws(() => formatPortalDate('2026-13-40'));
```

- [ ] **Step 2:** Run `npx tsx tests/completion-certificate-preparation.test.ts`. Expected: fails, module not found.
- [ ] **Step 3:** Implement the module. `completionIssues` message for a client problem starts "Client record:" so the page can link to the client.
- [ ] **Step 4:** Run the test. Expected: exits 0.
- [ ] **Step 5:** Commit: `feat: completion certificate preparation rules`.

### Task A3: Contract — snapshot section and Agent capability

**Files:**
- Modify: `src/lib/validation/automation-job.ts` (`automationJobSnapshotV2Schema`)
- Modify: `src/lib/validation/desktop-agent.ts` (`agentCapabilitiesSchema`)
- Create: `tests/fixtures/automation-job-v2-completion-certificate.json`
- Test: `tests/completion-certificate-contract.test.ts`

**Interfaces:**
- Consumes: Task A2 schemas.
- Produces: `completionCertificateSnapshotSchema` (exported) — `sourceWarrantId: string`, `proposalHint: { proposalName: string | null }`, resolved answers (`workCompletedDate`, `warrantReference`, `warrantDate` required strings; booleans non-null; `formQRequired` nullable), `fixedAnswers` as literals, `updatedAt`. `automationJobSnapshotV2Schema.completionCertificate` is `.nullable().optional()`. `preflight.locationPlanStatus` gains `'NOT_APPLICABLE'`. `agentCapabilitiesSchema.workflows` accepts `COMPLETION_CERTIFICATE`.
- The fixture is a full valid snapshot: `metadata.applicationType: "COMPLETION_CERTIFICATE"`, `planning: null`, `buildingWarrant: null`, `documents: []`, relaxation Yes, one construction entry, design Yes with Form Q Yes and one entry, continuing requirements Yes. Task B2 copies this file to the Agent repo.

- [ ] **Step 1: Write the failing tests**

```ts
const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-completion-certificate.json', 'utf8'));
assert.equal(automationJobSnapshotV2Schema.safeParse(fixture).success, true);
const warrantFixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
assert.equal(automationJobSnapshotV2Schema.safeParse(warrantFixture.dataSnapshot ?? warrantFixture).success, true); // existing snapshots still valid
assert.equal(automationJobSnapshotV2Schema.safeParse({ ...fixture, completionCertificate: { ...fixture.completionCertificate, fixedAnswers: { ...fixture.completionCertificate.fixedAnswers, coversAllWork: false } } }).success, false);
assert.doesNotThrow(() => assertSafeAutomationSnapshot(fixture));
const caps = { workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT', 'COMPLETION_CERTIFICATE'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1], resetContractVersions: [1] };
assert.equal(agentCapabilitiesSchema.safeParse(caps).success, true);
assert.equal(agentSupportsJob({ capabilities: caps } as never, { type: 'COMPLETION_CERTIFICATE', payloadVersion: 2 } as never), true);
assert.equal(agentSupportsJob({ capabilities: { ...caps, workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT'] } } as never, { type: 'COMPLETION_CERTIFICATE', payloadVersion: 2 } as never), false);
```

- [ ] **Step 2:** Run it. Expected: fails (unknown key / enum).
- [ ] **Step 3:** Implement the schema changes and write the fixture.
- [ ] **Step 4:** Run `npx tsx tests/completion-certificate-contract.test.ts` and `npx tsx tests/automation-job-contract.test.ts`. Expected: both exit 0.
- [ ] **Step 5:** Commit: `feat: completion certificate snapshot contract`.

### Task A4: Job identity

**Files:**
- Modify: `src/server/services/desktop-automation-status.service.ts` (`resolveAutomationJobIdentity`)
- Modify: `src/server/services/automation-state-model.service.ts` (`recordApplicationSnapshot`, line ~38)
- Test: `tests/completion-certificate-identity.test.ts`

**Interfaces:**
- Produces: for a completion job, `resolveAutomationJobIdentity` returns `{ applicationType: 'COMPLETION_CERTIFICATE', applicationId: completionCertificate.sourceWarrantId, snapshotVersion: 2 }`. It throws when `planning.recordId` or `buildingWarrant.recordId` is present, when `sourceWarrantId` is missing, or when the snapshot is v1.

- [ ] **Step 1: Write the failing tests**

```ts
const job = { id: 'job_12345678', projectId: 'project', type: 'COMPLETION_CERTIFICATE', dataSnapshot: fixtureWith({ jobId: 'job_12345678', projectId: 'project' }) };
assert.equal(resolveAutomationJobIdentity(job as never).applicationId, 'warrant_1');
assert.throws(() => resolveAutomationJobIdentity({ ...job, dataSnapshot: { ...job.dataSnapshot, buildingWarrant: { recordId: 'warrant_1' } } } as never));
// A completion job is never the warrant's current run, and vice versa.
assert.equal(selectCurrentAutomationJob([job] as never, { projectId: 'project', types: ['BUILDING_WARRANT'], applicationId: 'warrant_1' }), null);
assert.equal(selectCurrentAutomationJob([job] as never, { projectId: 'project', types: ['COMPLETION_CERTIFICATE'], applicationId: 'warrant_1' })?.id, 'job_12345678');
```

- [ ] **Step 2:** Run it. Expected: throws "missing its application type".
- [ ] **Step 3:** Implement the third branch. In `recordApplicationSnapshot`, a completion job looks up the warrant by `completionCertificate.sourceWarrantId`.
- [ ] **Step 4:** Run the new test and `npx tsx tests/desktop-status.test.ts`. Expected: both exit 0.
- [ ] **Step 5:** Commit: `feat: completion certificate job identity`.

### Task A5: Snapshot builder and preflight

**Files:**
- Modify: `src/server/services/automation-jobs.service.ts` — extract and export the party builders from `buildAutomationJobSnapshot` without changing its output; extend `currentAutomationSourceUpdatedAt`.
- Create: `src/server/services/completion-certificate.service.ts`
- Test: `tests/completion-certificate-snapshot.test.ts`

**Interfaces:**
- Consumes: A2, A3.
- Produces in `automation-jobs.service.ts`: `snapshotSite(project)`, `snapshotClientApplicant(client, applicantIsOwner: boolean | null)`, `snapshotOrganisationAgent(defaults, organisationName)`, `snapshotProject(project, typeOfWorkKeys)` — each returns exactly the object literal now inlined at lines ~351–480.
- Produces in `completion-certificate.service.ts`:
  - `loadCompletionContext(input: { organisationId: string; warrantId: string }, database?): Promise<CompletionContext>` — warrant (with project, client, site), organisation defaults, amendment warrants on the same project (`warrantType: AMENDMENT`, `grantedDate` not null, ordered ascending). Throws `HttpError(404)` when the warrant is not in the organisation.
  - `completionPreparationFor(context: CompletionContext): { preparation: CompletionPreparation; issues: Issue[]; parties: CompletionParties }`
  - `buildCompletionCertificateSnapshot(input: { jobId: string; createdAt: Date; organisationId: string; organisationName: string; warrantId: string; createdBy: { id: string; name: string; email: string } }, database?): Promise<{ title: string; dataSnapshot; documentSnapshot: { schemaVersion: 2; documents: [] }; snapshotHash: string; sourceUpdatedAt: Date; preflight }>` — title `Completion Certificate - <project name>`; `preflight.status` is `READY` when `issues` is empty, else `NEEDS_INPUT` with one `missing` entry per issue; `locationPlanStatus: 'NOT_APPLICABLE'`; `proposalHint.proposalName` is the site address joined as `addressLine1, townCity, postcode`; integrity hash computed as in `buildAutomationJobSnapshot`.
  - `currentAutomationSourceUpdatedAt` also reads the warrant named by `completionCertificate.sourceWarrantId`.

- [ ] **Step 1: Write the failing tests** using an in-memory `database` object exposing only `buildingWarrantApplication.findFirst`, `buildingWarrantApplication.findMany`, `organisationDefaults.findUnique`:

```ts
const built = await buildCompletionCertificateSnapshot(input, database as never);
assert.equal(built.dataSnapshot.metadata.applicationType, 'COMPLETION_CERTIFICATE');
assert.equal(built.dataSnapshot.buildingWarrant, null);
assert.equal(built.dataSnapshot.planning, null);
assert.deepEqual(built.dataSnapshot.documents, []);
assert.equal(built.dataSnapshot.completionCertificate?.sourceWarrantId, 'warrant_1');
assert.equal(built.dataSnapshot.completionCertificate?.proposalHint.proposalName, '112 Ralston Avenue, Glasgow, G52 3NB');
assert.equal(built.preflight.status, 'READY');
assert.match(built.snapshotHash, /^sha256:[a-f0-9]{64}$/);
assert.equal(automationJobSnapshotV2Schema.safeParse(built.dataSnapshot).success, true);
// missing work-completed date => NEEDS_INPUT and the snapshot still parses
// warrant in another organisation => HttpError 404
// source-updated time moves when the warrant row's updatedAt moves
```

- [ ] **Step 2:** Run it. Expected: fails, module not found.
- [ ] **Step 3:** Extract the party builders, then implement the service.
- [ ] **Step 4:** Run the new test, then `npx tsx tests/automation-job-contract.test.ts && npx tsx tests/retry-fresh-snapshot.test.ts && npx tsx tests/warrant-prepared-edit.test.ts`. Expected: all exit 0 (the extraction changed no output).
- [ ] **Step 5:** Commit: `feat: completion certificate snapshot builder`.

### Task A6: Preparation and run endpoints

**Files:**
- Modify: `src/server/services/completion-certificate.service.ts`
- Create: `src/pages/api/building-warrant/[id]/completion-certificate/preparation.ts` (`GET`, `PATCH`)
- Create: `src/pages/api/building-warrant/[id]/completion-certificate/run.ts` (`POST`)
- Test: `tests/completion-certificate-queue.test.ts`

**Interfaces:**
- Consumes: A5; `authoriseAutomationJobRun` from `automation-job-run.service.ts`; `reusableAutomationJobStatuses`, `selectCurrentAutomationJob` from `desktop-automation-status.service.ts`.
- Produces:
  - `saveCompletionPreparation(input: { organisationId: string; warrantId: string; body: unknown }, database?): Promise<{ preparation; issues }>` — validates with `completionPreparationSchema`, writes only `completionPreparationData` and `completionPreparedAt`.
  - `queueCompletionCertificateJob(input: { organisationId: string; organisationName: string; warrantId: string; user: { id; name; email } }, database?): Promise<{ jobId: string; created: boolean; compatibleAgentOnline: boolean }>` — inside one transaction holding `lockOrganisationExecution`: return the existing job when a completion job for this warrant is in a reusable or running status; otherwise build the snapshot, refuse with `HttpError(409, 'Complete the missing completion certificate details first.')` unless preflight is `READY`, create the job as `READY` with `payloadVersion: 2`, and set `completionCertificateStatus` to `DRAFTING` when it is `NOT_REQUIRED` or `NOT_STARTED`. Then call `authoriseAutomationJobRun`.
  - Endpoint responses: `GET` → `{ preparation, issues, parties, fixedAnswers }`; `PATCH` → `{ ok: true, preparation, issues }`; `POST run` → `{ jobId, redirectTo: '/automation-job/<id>', compatibleAgentOnline }`.
  - Both mutating endpoints use `assertAllowedOrigin`, `assertRateLimit(..., rateLimitPolicies.mutation, 'completion:<action>')`, `requireOrganisation`, as `src/pages/api/building-warrant/[id]/preparation.ts` does.

- [ ] **Step 1: Write the failing tests** with an in-memory database:

```ts
// save isolation
const before = structuredClone(state.warrant);
await saveCompletionPreparation({ organisationId: 'org', warrantId: 'warrant_1', body: complete }, database as never);
assert.deepEqual(state.warrant.preparationData, before.preparationData);
assert.equal(state.warrant.status, before.status);
assert.equal(state.warrant.description, before.description);
assert.equal(state.warrant.completionPreparationData.workCompletedDate, '2026-10-30');
// reopen returns what was saved, not prefill
// queue
const first = await queueCompletionCertificateJob(queueInput, database as never);
const second = await queueCompletionCertificateJob(queueInput, database as never);
assert.equal(first.created, true);
assert.equal(second.created, false);
assert.equal(second.jobId, first.jobId);                       // double-click => one job
assert.equal(state.jobs.length, 1);
assert.equal(state.jobs[0].type, 'COMPLETION_CERTIFICATE');
assert.equal(state.jobs[0].status, 'READY');
assert.ok(state.jobs[0].executionAuthorisedAt);
assert.equal(state.warrant.completionCertificateStatus, 'DRAFTING');
assert.equal(state.warrant.status, before.status);             // WarrantStatus untouched
// incomplete preparation => HttpError 409, no job created
// warrant with completionCertificateStatus SUBMITTED stays SUBMITTED
```

- [ ] **Step 2:** Run it. Expected: fails, function not exported.
- [ ] **Step 3:** Implement the two service functions and the three route handlers.
- [ ] **Step 4:** Run the test. Expected: exits 0. Run `npx astro check`. Expected: 0 errors.
- [ ] **Step 5:** Commit: `feat: completion certificate preparation and queue endpoints`.

### Task A7: Job-type audit

Every place that treats "not a building warrant" as planning gets an explicit completion branch. Decisions:

| File | Change |
|---|---|
| `src/pages/api/automation-jobs/[id]/launch.ts` | Refuse completion jobs: `HttpError(409, 'Completion certificates run from the Agent queue.')` |
| `src/pages/api/automation-jobs/[id]/preparation.ts`, `prepare.ts`, `restart.ts` | Refuse completion jobs with 409; they are re-queued from the completion page |
| `src/server/services/automation-job-restart.service.ts` | Throw `HttpError(409)` for completion jobs before building |
| `src/server/services/prepared-application-review.service.ts` | For completion jobs, skip the final-review action item and `reviewedAt` write; return early |
| `src/server/services/application-lifecycle.service.ts` (`recordAutomationReadinessTransition`, line ~356) | Return `null` for completion jobs |
| `src/lib/dashboard/overview.ts:62`, `src/pages/api/dashboard/summary.ts:134,301` | Exclude completion jobs from planning/warrant attention lists; label `Completion certificate` at line 301 |
| `src/components/automation/AgentQueueDropdown.tsx:166` | Label `Completion certificate` |
| `src/pages/automation-job/[id].astro:40`, `src/pages/automation-jobs.astro:75,78` | Label `Completion Certificate`; link to `/building-warrant/<sourceWarrantId>/completion-certificate/preparation` |
| `src/components/automation/DesktopAutomationLiveCard.tsx`, `AutomationFailureRecovery.tsx` | Widen `applicationType` to include `'COMPLETION_CERTIFICATE'`; completion shows only Cancel, Open in portal and a link back to the completion page — no warrant recovery fields, no Reset |
| `src/pages/api/settings/desktop-agents/index.ts:35` | Unchanged (an Agent is "usable" for planning/warrant regardless) |
| `src/server/services/automation-job-reset.service.ts`, `src/pages/api/automation-jobs/reset.ts`, `project-screener.service.ts`, `src/pages/projects/[id].astro:239-263` | Unchanged: each already filters by an explicit type list that excludes completion. Confirm by reading. |

**Files:** as listed. Test: `tests/completion-certificate-audit.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// lifecycle: a completion result leaves the warrant alone
assert.equal(await recordAutomationReadinessTransition(tx as never, { ...base, jobType: 'COMPLETION_CERTIFICATE' }), null);
// restart refuses
// (call the restart function exported by automation-job-restart.service.ts with a completion job)
await assert.rejects(() => restart({ ...restartInput, jobId: completionJobId, database }), /409|Completion/);
// source scan: no remaining two-way type ternary reaches completion jobs unguarded
for (const file of auditedFiles) assert.match(readFileSync(file, 'utf8'), /COMPLETION_CERTIFICATE/);
```

- [ ] **Step 2:** Run it. Expected: fails on the first assertion.
- [ ] **Step 3:** Apply the table.
- [ ] **Step 4:** Run the new test, then `npm run test:orchestration` and `npx tsx tests/automation-run-reset.test.ts`. Expected: all exit 0.
- [ ] **Step 5:** Commit: `feat: route completion certificate jobs through type-specific branches`.

### Task A8: Preparation page and entry point

**Files:**
- Create: `src/pages/building-warrant/[id]/completion-certificate/preparation.astro`
- Create: `src/components/applications/CompletionCertificateForm.tsx`
- Modify: `src/components/projects/ApplicationSummaryCard.astro` (new optional prop `completionHref?: string`)
- Modify: `src/pages/projects/[id].astro` (pass `completionHref` for the warrant card when `latestWarrant.status` is one of `SUBMITTED`, `IN_REVIEW`, `FURTHER_INFORMATION_REQUESTED`, `GRANTED`, `COMPLETED`, `CLOSED`)
- Test: `tests/completion-certificate-ui.test.ts`

**Interfaces:**
- Consumes: A6 endpoints; A2 constants.
- Produces: `CompletionCertificateForm` props `{ warrantId: string; initial: CompletionPreparation; issues: Issue[]; parties: CompletionParties; fixedAnswers: typeof COMPLETION_FIXED_ANSWERS; clientHref: string | null; settingsHref: string }`.

Page behaviour:
- Server-rendered with `requirePageAuth`, `loadCompletionContext`, `completionPreparationFor`. Layout and styling follow `src/pages/building-warrant/[id]/preparation.astro` and `DESIGN.md`.
- Sections in portal order: Completion and warrant; Relevant person (read-only, "Edit client" link); Agent (read-only, "Edit in Settings" link); Relaxation; Construction certificates; Design certificates and Form Q; EPC; Sustainability; Fire safety; Continuing requirements; Fixed answers (read-only table); Missing information.
- Yes/No questions are radio groups with no default. Conditional blocks show only on Yes.
- Certificate entries: Add entry / Remove entry, at most 20. Part 1 is a `<select>` from the register's codes; Part 2 is shown as fixed text. Each entry has an optional "Signed certificate" `<select>` of the project's documents (extra prop `documents: Array<{ id: string; name: string }>`), saved as `documentId`, with the note "Uploaded in a later step".
- Textareas show a live `n / 750` count.
- **Save** PATCHes and re-renders the issue list. **Confirm and send to Agent** is disabled while issues remain or there are unsaved changes; it POSTs to `run` and follows `redirectTo`. It disables itself on click.
- Button on the warrant card reads "Prepare Completion Certificate".

- [ ] **Step 1: Write the failing test** (source-level, as `tests/application-draft-review-ui.test.ts` does):

```ts
const form = readFileSync('src/components/applications/CompletionCertificateForm.tsx', 'utf8');
for (const code of ['NIC1', 'SEL1', 'SNP1']) assert.ok(form.includes('CONSTRUCTION_REGISTRATION_PART1_CODES') || form.includes(code));
assert.match(form, /completion-certificate\/run/);
assert.match(form, /maxLength=\{750\}/);
const card = readFileSync('src/components/projects/ApplicationSummaryCard.astro', 'utf8');
assert.match(card, /Prepare Completion Certificate/);
```

- [ ] **Step 2:** Run it. Expected: fails, file not found.
- [ ] **Step 3:** Build the page, form and entry point.
- [ ] **Step 4:** Run the test, `npx astro check` (0 errors) and `npm run build` (completes).
- [ ] **Step 5:** Commit: `feat: completion certificate preparation page`.

### Task A9: Website verification

- [ ] **Step 1:** Add the six new test files to a new `test:completion-certificate` script in `package.json` and append it to `test:release-reliability`.
- [ ] **Step 2:** Run `npm run test:completion-certificate`. Expected: exits 0.
- [ ] **Step 3:** Run `npm run test:release-reliability`. Expected: exits 0. Record any failure that also fails on `main` as pre-existing rather than fixing it here.
- [ ] **Step 4:** Run `npx astro check` and `npm run build`. Expected: 0 errors; build completes.
- [ ] **Step 5:** Commit: `test: completion certificate release checks`.

---

# Part B — Agent

All paths relative to `C:\Users\Jayveer\Building Portal`. Run tests with `python -m pytest tests/<file> -q`. Tests use fake drivers in the style of `tests/test_main_details_regression.py`; none opens a browser.

### Task B1: Job type, dispatch and progress profile

**Files:**
- Modify: `automation/models.py`, `automation/runner.py` (`_workflow_for`), `automation/progress.py`
- Test: `tests/test_completion_dispatch.py`

**Interfaces:**
- Produces: `automation.models.COMPLETION_TYPES = {"COMPLETION_CERTIFICATE", "Completion Certificate"}`; `RuntimeJob.from_mapping` accepts them. `progress.workflow_key(t)` returns `"completion_certificate"` for them. `DEFAULT_STAGE_SECONDS["completion_certificate"] = {"validation": 1.0, "browser": 5.0, "login": 8.0, "proposal": 15.0, "completion_form": 15.0, "main_details": 60.0, "final_review": 5.0}`. `USER_STAGE_LABELS["completion_form"] = "Opening the completion certificate"`. `_workflow_for` returns `automation.completion_certificate.run.main` for completion types and raises `ValueError("Unsupported application type")` for anything that is not planning, warrant or completion.

- [ ] **Step 1: Write the failing tests**

```python
def test_runtime_job_accepts_completion():
    job = RuntimeJob.from_mapping({"job_id": "job_12345678", "application_type": "COMPLETION_CERTIFICATE", "user_inputs": {}})
    assert job.application_type == "COMPLETION_CERTIFICATE"

def test_stage_profile():
    assert workflow_stages("COMPLETION_CERTIFICATE") == ("validation", "browser", "login", "proposal", "completion_form", "main_details", "final_review")
    assert workflow_key("BUILDING_WARRANT") == "building_warrant"
    assert workflow_key("HOUSEHOLDER_PLANNING") == "planning"

def test_unknown_type_is_not_treated_as_warrant():
    with pytest.raises(ValueError):
        runner._workflow_for("SOMETHING_ELSE")
```

- [ ] **Step 2:** `git checkout -b feature/completion-certificate`. Run the tests. Expected: fail.
- [ ] **Step 3:** Implement. Create `automation/completion_certificate/__init__.py` and a `run.py` whose `main` raises `NotImplementedError` for now.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_dispatch.py tests/test_automation_runner.py tests/test_progress_estimator.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: completion certificate job type and dispatch`.

### Task B2: Snapshot validation and input mapping

**Files:**
- Modify: `gui/services/portal_handoff.py`, `automation/portal_adapter.py`
- Create: `tests/fixtures/automation-job-v2-completion-certificate.json` (copy of the website fixture, wrapped as a job: `{"id", "type", "projectId", "title", "dataSnapshot"}`)
- Test: `tests/test_completion_handoff.py`

**Interfaces:**
- Produces:
  - `COMPLETION_JOB_TYPE = "COMPLETION_CERTIFICATE"`, added to `SUPPORTED_JOB_TYPES`.
  - `_validate_snapshot_v2`: for a completion job, requires `completionCertificate.sourceWarrantId`, requires `planning` and `buildingWarrant` record IDs to be absent, and requires `fixedAnswers` to equal the spec's fixed answers exactly; otherwise `PortalHandoffError("Prepare this completion certificate again in Architect Pro.")`.
  - `application_identity_from_job`: `application_id` is `sourceWarrantId`, `selected_automation` is `"COMPLETION_CERTIFICATE"`.
  - `_portal_job_v2_to_values` returns for a completion job: `"Application Type": "Completion Certificate"`, `"Site Address"`, `"Site Postcode"`, `"Local Authority"`, `"Automation Job ID"`, `"Project ID"`, `"Application Record ID"` (= `sourceWarrantId`), the same `"Agent …"` and `"Applicant …"` keys the warrant mapping produces, and `"Completion"`: the `completionCertificate` section as a dict with ISO dates.
  - `normalise_portal_job`: no fee and no document blocking issues for completion jobs.
  - `runtime_job_from_portal`: works with zero documents (`pdf_folder` empty).

- [ ] **Step 1: Write the failing tests**

```python
def test_completion_values():
    values = portal_handoff.portal_job_to_values(job)
    assert values["Application Type"] == "Completion Certificate"
    assert values["Application Record ID"] == "warrant_1"
    assert values["Completion"]["workCompletedDate"] == "2026-10-30"
    assert values["Completion"]["constructionCertificates"]["entries"][0]["certifierRegistration"] == {"part1": "SEL1", "part2": "C", "number": "12345"}
    assert values["Applicant First Name"] and values["Agent First Name"]

def test_rejects_changed_fixed_answer():
    job["dataSnapshot"]["completionCertificate"]["fixedAnswers"]["coversAllWork"] = False
    with pytest.raises(portal_handoff.PortalHandoffError):
        portal_handoff.validate_portal_job(job)

def test_rejects_warrant_section():   # buildingWarrant.recordId present => PortalHandoffError
def test_no_blocking_issues_without_documents():
    assert portal_handoff.normalise_portal_job(job).blocking_issues == []
def test_runtime_job_from_portal_without_documents():
    runtime = runtime_job_from_portal(job, [], [], login_email="a@example.com")
    assert runtime.application_type == "COMPLETION_CERTIFICATE"
def test_warrant_fixture_unchanged():  # existing warrant fixture maps to the same values as before
```

- [ ] **Step 2:** Run. Expected: fail with "missing its application type".
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_handoff.py tests/test_portal_handoff.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: map completion certificate jobs to runtime inputs`.

### Task B3: Shared entry helpers and wizard-prefix reuse

**Files:**
- Create: `automation/completion_certificate/fields.py`, `automation/completion_certificate/navigation.py`
- Modify: `automation/building_warrant/agent.py` (`fill_agent_details`), `automation/building_warrant/applicant.py` (`fill_applicant_details`)
- Test: `tests/test_completion_fields.py`

**Interfaces:**
- Produces in `fields.py`:
  - `PREFIX = "MainContent_CompletionCertificateAppWizard_"`
  - `portal_date(iso: str) -> str` — `"2026-03-05"` → `"05/03/2026"`; raises `ValueError` on anything else.
  - `set_text(driver, element_id: str, value: str, timeout=30) -> bool` — types only when the current value differs; reads the value back; returns whether it changed. Multi-line values are set intact.
  - `choose(driver, label_for_id: str, timeout=30) -> bool` — clicks the `<label for=…>` only when that radio is not already selected; waits until it is selected.
  - `choose_yes_no(driver, answer: bool, yes_id: str, no_id: str) -> None`
- Produces in `navigation.py`: `click_next(driver, *, expected_ids=None, screen_name, timeout=30)`, `wait_for_step(driver, expected_ids, *, screen_name, timeout=30)`, `ensure_step(driver, expected_ids, *, screen_name, inline_timeout=2)` — same semantics as `automation/building_warrant/navigation.py` (`ensure_step` ≡ `ensure_follow_up`), bound to the completion wizard's Next button `PREFIX + "StepNavigationTemplateContainerID_btnNext"`; and `open_main_details(driver, timeout=120)` using `MainContent_FormSections_btnMainDetails`.
- `fill_agent_details(driver, user_inputs, prefix="MainContent_BuildingWarrantAppWizard_")` and `fill_applicant_details(driver, user_inputs, applicant_title_resolution_callback=None, prefix="MainContent_BuildingWarrantAppWizard_")` build every element ID from `prefix`. Default behaviour is unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_portal_date():
    assert portal_date("2026-03-05") == "05/03/2026"
    for bad in ("05/03/2026", "2026-13-01", ""):
        with pytest.raises(ValueError): portal_date(bad)

def test_set_text_skips_matching_value():      # fake element already holds the value => no send_keys, returns False
def test_set_text_replaces_different_value():  # returns True, value read back
def test_set_text_keeps_line_breaks():         # "01/06/2026\n09/07/2026" arrives intact
def test_choose_skips_selected_radio():        # no click recorded
def test_click_next_does_not_repeat():         # destination never appears => RuntimeError, exactly one click
def test_ensure_step_inline():                 # marker already visible => zero Next clicks
def test_agent_details_use_prefix():           # prefix=PREFIX => first id touched starts with PREFIX + "AgentDetails_"
def test_agent_details_default_prefix_unchanged():
```

- [ ] **Step 2:** Run. Expected: fail, module not found.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_fields.py tests/test_agent_building_number.py tests/test_applicant_other_title.py tests/test_main_details_regression.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: completion certificate entry helpers`.

### Task B4: Find the proposal and open the completion form

**Files:**
- Modify: `automation/common/proposal_creation.py` (`ProposalStateStore`, `SeleniumProposalPortal`)
- Create: `automation/completion_certificate/proposal.py`
- Test: `tests/test_completion_proposal.py`

**Interfaces:**
- Produces in `proposal_creation.py`:
  - `ProposalStateStore.find_for_project(project_reference: str, application_type: str, site_address: str) -> dict | None` — newest entry by `updatedAt` matching all three (address via `normalise_address`).
  - `SeleniumProposalPortal.proposals_named(proposal_name: str) -> list[str]` — proposal references in My Proposals whose name matches (normalised).
  - `SeleniumProposalPortal.summary_address() -> str` and `.summary_reference() -> str` — read from the Proposal Summary panel.
  - `SeleniumProposalPortal.draft_form_links(text: str) -> list` and `.submitted_form_count(text: str) -> int`.
  - `SeleniumProposalPortal.add_standard_form(label_text: str) -> None` — `LinkBtnAddForm` → `AddAdditionalFormsWizard_UseList` → `AddAdditionalFormsWizard_btnContinue` → tick the label → click `MainContent_AddAdditionalFormsWizard_btnAddForms` once. Raises `ProposalCreationUncertain` if the summary does not return.
- Produces in `proposal.py`:
  - `class ProposalSelectionRequired(RuntimeError)`; `class CompletionFormError(RuntimeError)` with attribute `confirmation_required = True`.
  - `open_source_proposal(portal, user_inputs, *, state_store, wait_for_user) -> str` — resolution order from spec Stage 1; `wait_for_user(reason: str)` is called for the third branch and must return once the Proposal Summary is open; returns the proposal reference; raises `CompletionFormError` naming both addresses on mismatch.
  - `open_completion_form(portal) -> str` — returns `"reused"` or `"created"`; behaviour per spec Stage 2.

- [ ] **Step 1: Write the failing tests** against a `FakePortal` recording calls:

```python
def test_saved_identity_opens_by_reference():
def test_saved_reference_missing_falls_back_to_name_match():   # open_existing_proposal raises SavedProposalNotFoundError
def test_unique_name_match():
def test_ambiguous_list_asks_user():                            # two matches => wait_for_user called once, nothing opened by the Agent
def test_no_match_asks_user():
def test_address_formats_match():
    # job "112 Ralston Avenue, Glasgow G52 3NB" vs summary "112 RALSTON AVENUE, GLASGOW, G52 3NB" => accepted
def test_address_mismatch_stops():
    with pytest.raises(CompletionFormError) as error: ...
    assert "112 RALSTON AVENUE" in str(error.value) and "9 Other Road" in str(error.value)
def test_form_reused():        # one draft link => clicked, add_standard_form not called
def test_form_created():       # none => add_standard_form("Completion Certificate") once, then the link is clicked
def test_duplicate_forms_stop():                # two draft links => CompletionFormError
def test_already_submitted_stops():             # none in drafts, one submitted => CompletionFormError
def test_uncertain_add_is_not_repeated():       # link never appears => raises, add_standard_form called exactly once
def test_find_for_project_returns_newest():
```

- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_proposal.py tests/test_proposal_creation.py tests/test_existing_application.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: locate warrant proposal and completion form`.

### Task B5: Certificate registers

**Files:**
- Create: `automation/completion_certificate/certificates.py`
- Test: `tests/test_completion_certificates.py`

**Interfaces:**
- Consumes: `_select_text`, `check_certificate_validation`, `CertificateValidationError` from `automation/building_warrant/certificates.py`; `set_text`, `portal_date`, `PREFIX` from B3.
- Produces:
  - `CONSTRUCTION = RegisterSpec(prefix=PREFIX + "CertificatesRegister_", scheme="Construction", part1=("NIC1","SEL1","SNP1"), certifier_part2="C", approved_body_part2="CB")`; `DESIGN = RegisterSpec(prefix=PREFIX + "CertificatesRegister1_", scheme="Design", part1=("BRE1","BRE2","RIA1","RIA2","SER1"), certifier_part2="D", approved_body_part2="DB")`.
  - `validate_entries(entries, spec: RegisterSpec) -> None` — 1 to 20 entries; every field present; Part 1 in `spec.part1`; dates valid. Raises `ValueError` naming the entry number. Called before any portal action.
  - `pager(driver, spec) -> tuple[int, int]` — parses the `i/n` text beside the pager buttons.
  - `fill_register(driver, entries, spec: RegisterSpec) -> None` — per spec "Certificate registers", including in-place correction of saved entries and stopping when the register holds more entries than the job.
  - `class RegisterStateError(RuntimeError)` with `confirmation_required = True`.

- [ ] **Step 1: Write the failing tests** against a fake register that models postbacks, the pager and the option lists:

```python
def test_single_entry_fills_blank_first_entry():     # pager stays 1/1, Add never clicked, Validation Check clicked once
def test_three_entries_add_twice():                  # pager ends 3/3, Add clicked twice, Validation Check three times
def test_saved_entries_corrected_in_place():         # register starts 2/2 with stale number => Add never clicked, both corrected
def test_extra_saved_entries_stop():                 # register 3/3, job has 2 => RegisterStateError, Remove never clicked
def test_missing_option_lists_available():
    with pytest.raises(RuntimeError) as error: ...   # "SEL1" absent
    assert "NIC1" in str(error.value)
def test_validation_rejection_names_entry():         # CertificateValidationError, message mentions entry 2
def test_validation_timeout_not_repeated():          # Validation Check clicked exactly once
def test_add_not_confirmed_not_repeated():           # pager never advances => RuntimeError, Add clicked exactly once
def test_validate_entries_rejects_wrong_register():  # construction entry with part1 "SER1" => ValueError before any driver call
def test_dates_typed_as_portal_dates():              # "2026-03-05" => "05/03/2026" in txtCertifierSignatureDate
```

- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_certificates.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: completion certificate registers`.

### Task B6: Main Details workflow

**Files:**
- Create: `automation/completion_certificate/details.py`
- Modify: `automation/completion_certificate/run.py`
- Test: `tests/test_completion_workflow.py`

**Interfaces:**
- Consumes: B2 input keys, B3, B4, B5; `login_to_ebuilding` from `automation/building_warrant/login.py`; `record_checkpoint`, `clear_checkpoint` from `automation/common/runtime.py`.
- Produces:
  - `details.validate_completion(completion: Mapping) -> None` — refuses before any portal action: missing or malformed dates; a work-completed or warrant date in the future; empty warrant reference; amendment dates or continuing requirements over 750 characters; relaxation Yes without reference and date; register entries via `validate_entries`; any `fixedAnswers` value differing from the spec.
  - One function per spec screen row, each taking `(driver, completion)` and leaving the wizard on the next screen: `fill_completion_and_warrant`, `fill_notices`, `fill_applicant_or_agent`, `fill_ownership_and_address`, `fill_extent_and_relaxation`, `fill_construction_certificates`, `fill_design_certificates` (includes Form Q), `fill_epc`, `fill_sustainability`, `fill_fire_safety`, `fill_continuing_requirements`.
  - `details.confirm_main_details_completed(driver, timeout=60) -> None` — waits for `MainContent_FormSections_btnSupportingDocumentation` to be clickable; does not click it; raises `RuntimeError("The portal did not confirm Main Details as completed. Review the completion certificate in the portal.")` otherwise.
  - `run.main(*, user_inputs, password, driver, document_mapping=None, progress=None, cancellation_token=None, address_resolution_callback=None, applicant_title_resolution_callback=None, proposal_selection_callback=None)` — stages in order: `login`, `proposal`, `completion_form`, `main_details`. Calls `validate_completion` first. Emits `running` then `completed` for each stage through `progress(name, status, message)` and checks the cancellation token at each stage boundary.

- [ ] **Step 1: Write the failing tests** against a fake wizard that models the screen sequence in the spec table, including inline follow-ups:

```python
def test_all_no_path():
    # relaxation No, construction No, design No, EPC/sustainability/fire No, continuing No
    assert wizard.screens_visited == ["intro", "completion_warrant", "notices", "applicant_or_agent", "agent", "relevant_person",
                                      "ownership", "extent_relaxation", "construction_question", "design_question",
                                      "epc", "sustainability", "fire_safety", "continuing", "form_summary"]
    assert wizard.value("txtDateWorkCompleted") == "30/10/2026"
    assert wizard.value("BuildingWarrantDetails_txtBuildingWarrantRefNumber") == "26/01234/WARR"
    assert wizard.selected("rbSumissionCoverYes") and wizard.selected("rbDangerousBuildingNo")
    assert wizard.value("txtBuildingRegComplianceNotice") == ""

def test_all_yes_path():            # visits construction_register, form_q_question, form_q_register; relaxation and continuing text entered
def test_design_no_skips_form_q():
def test_form_q_no_skips_register():
def test_inline_relaxation_fields_need_no_extra_next():    # fields appear in place => Next count equals screens visited - 1
def test_relaxation_fields_behind_next():                  # fields appear only after Next => still completes
def test_amendment_dates_keep_line_breaks_and_750_limit(): # 750 chars accepted; 751 => ValueError before login
def test_rerun_over_saved_answers_changes_nothing():       # wizard pre-populated with the same answers => zero typed characters, zero radio clicks, completes
def test_rerun_corrects_changed_answer():                  # saved warrant date differs => that field only is retyped
def test_completion_not_confirmed_fails():                 # supporting-documentation button never clickable => RuntimeError, button never clicked
def test_fixed_answer_changed_refused_before_login():
def test_future_work_completed_date_refused_before_login():
def test_cancel_between_stages():                          # token cancelled after proposal => AutomationCancelled, no wizard input
def test_stage_events_in_order():
```

- [ ] **Step 2:** Run. Expected: fail (`NotImplementedError`).
- [ ] **Step 3:** Implement `details.py` and `run.main`.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_workflow.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: completion certificate main details workflow`.

### Task B7: Runner, Agent window and release metadata

**Files:**
- Modify: `automation/runner.py` (`run_automation`, `describe_failure`), `gui/agent_app.py`, `gui/services/background_agent.py`, `version_info.txt`, `installer/ArchitectProAgent.iss`, `AGENT_README.md`
- Test: `tests/test_completion_runner.py`

**Interfaces:**
- Produces:
  - `run_automation` passes `proposal_selection_callback` only to workflows whose type is in `COMPLETION_TYPES`. The callback emits `("proposal", USER_ACTION_REQUIRED, "Open the correct proposal in My Proposals to continue.")`, reveals the browser through the managed driver's existing reveal method, waits up to 600 seconds for `MainContent_ProposalSummaryWizard_LinkBtnAddForm`, then emits `("proposal", RUNNING, "Proposal confirmed. Continuing automation.")`. Timeout raises `AutomationCancelled("Proposal selection timed out")`.
  - Success result message for completion jobs: `"Completion Certificate Main Details completed"`; stage `final_review`.
  - `describe_failure`: stage labels `proposal` → "Finding the warrant proposal", `completion_form` → "Opening the completion certificate". `CompletionFormError`, `RegisterStateError` and any failure at stage `completion_form` or `main_details` → `recovery_action "review_portal"`, `retry_safe False`. `CertificateValidationError` at `main_details` keeps its existing controlled handling. Failures at `validation`, `login` or `proposal` before a form exists stay retryable.
  - `CAPABILITIES["workflows"] == ["HOUSEHOLDER_PLANNING", "BUILDING_WARRANT", "COMPLETION_CERTIFICATE"]`; `AGENT_VERSION = "4.2.15"`; version strings in `version_info.txt` and the installer script match.
  - Agent window: application label "Completion Certificate"; no fee step is shown for completion jobs (`gui/agent_app.py` near lines 1463 and 1842).
  - `AGENT_README.md`: title and a first paragraph for 4.2.15 describing completion certificates and the website-first release order.

- [ ] **Step 1: Write the failing tests** using `workflow_registry` and a fake managed driver:

```python
def test_success_result():
    result = run_automation(completion_job, workflow_registry={"COMPLETION_CERTIFICATE": ok_workflow}, driver_factory=fake_factory, password="x")
    assert result.status == "success" and result.message == "Completion Certificate Main Details completed"
def test_proposal_callback_only_for_completion():      # warrant workflow receives no proposal_selection_callback kwarg
def test_form_error_is_review_portal():
    details = describe_failure(CompletionFormError("…"), "completion_form", "COMPLETION_CERTIFICATE")
    assert details.recovery_action == "review_portal" and details.retry_safe is False
def test_login_failure_stays_retryable():
def test_capabilities_and_version():
    assert "COMPLETION_CERTIFICATE" in background_agent.CAPABILITIES["workflows"]
    assert background_agent.AGENT_VERSION == "4.2.15"
```

- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `python -m pytest tests/test_completion_runner.py tests/test_automation_runner.py tests/test_background_agent.py tests/test_agent_gui.py -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: Agent 4.2.15 completion certificate support`.

### Task B8: Agent verification

- [ ] **Step 1:** Run `python -m compileall -q automation gui Gui.py`. Expected: no output, exit 0.
- [ ] **Step 2:** Run `python -m pytest tests -q`. Expected: all pass. Record any test that also fails on `master`/`main` as pre-existing.
- [ ] **Step 3:** Confirm `git status` shows only intended files; no credentials, caches or `user_inputs.json`.

---

# Part C — Owner's release steps (not performed by this plan)

1. Review and merge both branches.
2. Website: `npm run db:deploy`, then deploy.
3. Agent: `python Scripts/build_agent_release.py`, copy the installer and source archive to the website's `public/downloads`, update `src/config/agent-release.json` to 4.2.15, deploy again.
4. Supervised run on a real warrant. Confirm the add/continue button on Add Additional Forms and the Supporting Documentation signal behave as the spec assumes.
