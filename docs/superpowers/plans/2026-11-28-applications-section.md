# Applications Section Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the project page's applications by portal in compact rows, add an Add application menu, and let
Planning choose Householder or Planning Permission from the drawings with a manual Change.

**Architecture:** A forms list and a pure planning-form module in `src/lib`; one server service resolves the effective
form and saves a change; the project page renders rows from the forms list, reusing `DesktopAutomationStatus` inside.

**Tech Stack:** Astro, React islands, Prisma, zod, Tailwind; tests are `tsx` scripts using `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-28-applications-section-design.md`

## Global Constraints

- No database migration: the choice lives in `PlanningApplication.preparationData.planningForm`.
- Stored shape: `{ form: 'HOUSEHOLDER' | 'PLANNING_PERMISSION', chosenBy: 'SUGGESTED' | 'USER', reason: string | null, suggestedForm: 'HOUSEHOLDER' | 'PLANNING_PERMISSION' | null, chosenAt: string }`.
- Job types: `HOUSEHOLDER` → `HOUSEHOLDER_PLANNING`, `PLANNING_PERMISSION` → `PLANNING_APPLICATION`.
- Portal colours: ePlanning blue `#185FA5`, eBuilding Standards red `#A32D2D`, as markers only, never as status.
- Every mutation route: `assertAllowedOrigin`, `assertRateLimit`, organisation scoping.
- Modules imported by React islands must not import `@prisma/client` at runtime.

## Review Focus

- A submitted or decided planning application: Change is refused (409) and not offered in the row.
- A running Agent job (IN_PROGRESS / NEEDS_REVIEW): switching is refused with the reset service's "stop it first" message.
- Choosing the form the application already uses: saves nothing and creates no new run.
- No drawings and no scope: no suggestion; the row says "Householder" without a reason, and Change still works.
- A project with conflicting drawings (one says flat, another says extension): Planning Permission wins and the reason names it.

---

### Task 1: Planning form module

**Files:** Create `src/lib/planning-form.ts`; Test `tests/planning-form.test.ts`; add to `test:earlier-fixes` in `package.json`.

**Produces:**
- `type PlanningFormKey = 'HOUSEHOLDER' | 'PLANNING_PERMISSION'`
- `PLANNING_FORMS: Record<PlanningFormKey, { label: string; description: string; jobType: 'HOUSEHOLDER_PLANNING' | 'PLANNING_APPLICATION' }>`
- `type PlanningFormFact = { fieldKey: string; value: string | number | boolean }`
- `suggestPlanningForm(input: { buildingUse?: string | null; typeOfWorkKeys: readonly string[]; facts: readonly PlanningFormFact[] }): { form: PlanningFormKey; reason: string; source: 'drawings' | 'scope' } | null`
- `readPlanningForm(preparationData: unknown): StoredPlanningForm | null`
- `planningFormForJobType(type: string | null | undefined): PlanningFormKey | null`
- `effectivePlanningForm(input: { stored: StoredPlanningForm | null; latestJobType?: string | null; suggestion: ReturnType<typeof suggestPlanningForm> }): { form: PlanningFormKey; chosenBy: 'USER' | 'SUGGESTED' | 'RUN' | 'DEFAULT'; reason: string | null }`

- [ ] Test: extension to a house → HOUSEHOLDER, source `drawings`, reason contains the description text; `project.typeOfWork` "New build" fact → PLANNING_PERMISSION; description "Alterations to first floor flat" → PLANNING_PERMISSION, reason mentions a flat; commercial scope with no facts → PLANNING_PERMISSION, source `scope`; no facts, no scope → `null`; mixed facts (extension + flat) → PLANNING_PERMISSION; `effectivePlanningForm` order stored → latest job → suggestion → `{ form: 'HOUSEHOLDER', chosenBy: 'DEFAULT' }`; `readPlanningForm` rejects junk.
- [ ] Run `npx tsx tests/planning-form.test.ts`: FAIL (module missing).
- [ ] Implement. Facts read: `project.typeOfWork`, `project.buildingUse`, `application.descriptionOfWork`, `application.currentUse`, `application.proposedUse`. Flat words: `/\b(flat|flats|maisonette|apartment)s?\b/i`; new dwelling: `/\b(erection|construction) of\b.*\b(dwelling|house)|\bnew (dwelling|house)\b/i`.
- [ ] Run again: PASS. Commit.

### Task 2: Forms list

**Files:** Create `src/lib/application-forms.ts`; extend `tests/planning-form.test.ts`.

**Produces:** `APPLICATION_PORTALS` (`EPLANNING`, `EBUILDING_STANDARDS`: `label`, `description`, `colour`), `APPLICATION_FORMS: readonly { key: 'PLANNING' | 'BUILDING_WARRANT' | 'COMPLETION_CERTIFICATE'; portal; label; description }[]`, `formsForPortal(portal)`.

- [ ] Test: every form's portal exists; order Planning, Building Warrant, Completion Certificate; Planning is ePlanning, the other two eBuilding Standards. Implement. Commit with Task 1.

### Task 3: Server service and switch route

**Files:** Create `src/server/services/planning-form.service.ts`, `src/pages/api/planning/[id]/form.ts`; modify `src/server/services/automation-job-reset.service.ts`, `src/pages/api/automation-jobs/reset.ts`, `src/pages/api/automation-jobs/index.ts`, `src/pages/planning/[id]/preparation.astro`, `src/server/services/application-draft.service.ts`; Test `tests/planning-form-switch.test.ts`.

**Consumes:** Task 1. **Produces:**
- `planningFormSuggestionFor(project: { buildingUse/typeOfWork screener }, documents: { analysisResult: unknown }[])`
- `resolvePlanningForm(db, organisationId, planningApplicationId): Promise<{ form, chosenBy, reason, suggestion, jobType }>`
- `choosePlanningForm(db, { organisation, actor, planningApplicationId, form, expectedJobId, requestId }): Promise<{ changed: boolean; jobId: string | null }>`
- Reset input `type` accepts `'HOUSEHOLDER_PLANNING' | 'PLANNING_APPLICATION' | 'BUILDING_WARRANT'`; for planning, the new run's type is the resolved form's job type.

- [ ] Test with a fake db: switching saves `chosenBy: 'USER'` and `suggestedForm`; the same form → `changed: false`, no reset; SUBMITTED status → 409; route file is origin-checked, rate-limited and scoped (source match). Source checks: the job-create route and reset use `resolvePlanningForm`; the preparation page uses it for `isPlanningPermission`.
- [ ] Implement; on a switch with an existing run of the other type, call `resetAutomationJobInTransaction` with the new type.
- [ ] Run test and `npm run check`: PASS. Commit.

### Task 4: Project page rows

**Files:** Create `src/components/projects/ApplicationsSection.astro`, `src/components/projects/ApplicationRow.astro`, `src/components/projects/PlanningFormSwitch.tsx`, `src/components/projects/AddApplicationMenu.astro`; delete `src/components/projects/ApplicationSummaryCard.astro`; modify `src/pages/projects/[id].astro`, `src/styles/global.css`; update tests `project-workspace`, `automation-job-security`, `completion-certificate-ui`, `tests/application-card-layout.browser.mjs`.

**Consumes:** Tasks 1 to 3.

- [ ] Update the tests first: three `<ApplicationRow` uses; rows are `<details`; portal groups come from `APPLICATION_PORTALS`; the Planning row's form label comes from `PLANNING_FORMS`, never a literal "Householder"; the Add menu renders every `APPLICATION_FORMS` entry; the switch posts to `/api/planning/${id}/form`.
- [ ] Implement. A row whose form is not on the project is rendered with `hidden` and `data-application-row`; the Add menu's item un-hides it, opens it and scrolls to it. `.app-row` carries the tone variables without the left border.
- [ ] Run `npm run check` and the updated tests: PASS. Commit.

### Task 5: Verify in the browser

- [ ] Start the dev server, open a project with planning and warrant records, and check groups, opening, the Add menu, Change (Cancel only, so the live database is not written), and a narrow width.
