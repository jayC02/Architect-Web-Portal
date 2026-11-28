# Applications section redesign

Approved by the user on 2026-11-28 after an interactive mockup.

## Why

The project page shows one large card per application (Planning, Building Warrant, Completion Certificate). More
forms are coming, so stacked cards will not scale. Householder and Planning Permission share the Planning card, which
always says "Householder", and nothing lets the architect see or change which ePlanning form a project uses.

## Goals

- Group applications by portal: **ePlanning** (blue) and **eBuilding Standards** (red), as the eDevelopment site does.
- One compact row per application: icon, form name, reference or date, status pill, chevron. Clicking opens today's
  desktop automation panel underneath. Adding forms adds rows, not screens of cards.
- An **Add application** menu, grouped by portal, listing every form. Forms already on the project are shown as added;
  forms not yet possible (Completion Certificate before the warrant is submitted) explain why.
- Planning picks **Householder or Planning Permission** from what the drawings show, says why, and offers **Change**.
  A manual change is remembered and shown as "Changed by you".
- Adding a form later means one entry in a forms list plus its own pages.

## Non-goals

- No new AI call. The drawings are already read for type of work, building use, description, current and proposed
  use; the form is decided from those facts and the project scope.
- No database migration. The chosen form lives in `PlanningApplication.preparationData.planningForm`.
- No change to the desktop panel itself (`DesktopAutomationStatus` / `DesktopAutomationLiveCard`).

## Anti-goals

- A portal colour must never read as an error: the red is only the eBuilding Standards marker; status stays on the pill.
- Switching form must never touch a submitted application or a running Agent job.

## Approaches considered

1. **Forms list + grouped rows that open (picked).** Short page at any number of forms; the existing panel is reused.
2. Tabs per portal: hides half the project's state.
3. A plain table: loses the desktop panel and its actions.

## Design

### Forms list — `src/lib/application-forms.ts`

`APPLICATION_PORTALS` (key, label, short description, colour classes) and `APPLICATION_FORMS` (key `PLANNING`,
`BUILDING_WARRANT`, `COMPLETION_CERTIFICATE`; portal; label; description; icon name). The project page renders groups and
the Add menu from these lists, in order.

### Planning form — `src/lib/planning-form.ts`

- `PLANNING_FORMS`: `HOUSEHOLDER` → job type `HOUSEHOLDER_PLANNING`, `PLANNING_PERMISSION` → `PLANNING_APPLICATION`,
  each with a label and a one-line description.
- `suggestPlanningForm({ buildingUse, typeOfWorkKeys, facts })` returns `{ form, reason, source }` or `null`:
  - Planning Permission when the work is a new build, a conversion or change of use, commercial, or involves a flat
    (description or uses mention a flat, maisonette or apartment), or the proposal erects a new dwelling.
  - Householder when the project is residential and the work is alteration or extension to an existing house.
  - Drawing facts win over the scope screener; the reason quotes the drawing's description when there is one.
- `readPlanningForm(preparationData)` reads the stored choice
  `{ form, chosenBy: 'SUGGESTED' | 'USER', reason, suggestedForm, chosenAt }`.
- `effectivePlanningForm({ stored, latestJobType, suggestion })`: stored → latest job's type → suggestion → Householder.

### Server — `src/server/services/planning-form.service.ts`

- `resolvePlanningForm(db, organisationId, planningApplicationId)` loads the application, the project's screener and its
  documents' extracted facts and planning jobs, and returns the effective form plus the suggestion.
- New route `POST /api/planning/[id]/form` `{ form, expectedJobId, requestId }`: origin-checked, rate-limited,
  organisation-scoped. Refuses a submitted or decided application. Saves `planningForm` with `chosenBy: 'USER'`; when the
  application already has a run of the other type, it resets the run as the new type (same guards as Reset: a running
  job must be stopped first).
- Existing bugs fixed on the way: **Reset** and **Prepare for desktop** always created Householder jobs. Both now use
  the effective form, and the first run stores the suggestion it used.
- The Planning details page decides whether to ask the Planning Permission questions from the effective form.
- The new-application upload's "Let Architect Pro decide" uses the same suggestion when it lands on planning.

### Project page

- `ApplicationsSection` renders the header (title, a counts line: in progress, submitted, documents) and the Add menu,
  then one group per portal that has rows. An empty project shows an invitation to add the first application.
- `ApplicationRow` replaces `ApplicationSummaryCard`: a native `<details>` so it opens without JavaScript. The status
  pill keeps taking its colour from the live panel's state.
- Rows exist for forms on the project: Planning when there is a planning record or run, Building Warrant when there is a
  warrant, Completion Certificate when it is available or has a run. Others are rendered hidden; choosing them in the
  Add menu reveals and opens the row, whose panel already offers to start the application.
- The Planning row's subtitle shows the form, a sparkle and the reason ("From the drawings: …"), or "Changed by you",
  and a **Change** button opening a two-option switch (`PlanningFormSwitch`, React) with the re-prepare warning.

## Left to the builder

Exact copy, spacing and icons, following the site's existing stone/ink/moss styling.
