# Architect Pro — design handoff to Claude Code

Prepared 7 November 2026. Task: redesign the Building Warrant and Planning preparation pages. Functionality is finished; this is a UX/layout pass that must not change behaviour.

## Read first

1. `docs/prelaunch-coding-completion-2026-11-07.md` — Codex's authoritative implementation and verification record.
2. `DESIGN.md` — design notes. The cool indigo dashboard palette applies only to `/dashboard` and the public homepage. **Preparation pages use the existing warm app style** (`panel`, `field`, `label`, `btn`, stone/moss/ink colours in `src/styles/global.css` and `tailwind.config.mjs`). Keep that style.

Workspaces: website `D:/Jayveer/Documents/websites/Architect Web Portal` (branch `main`); Agent `C:/Users/Jayveer/Building Portal` (branch `master`). Ignore the old nested website copy inside the Agent folder. Changes are uncommitted and include untracked files; do not reset or clean anything.

## Files in scope

- `src/pages/building-warrant/[id]/preparation.astro`
- `src/components/forms/WarrantOwnerDetails.astro`
- `src/components/forms/WarrantFollowUps.astro`
- `src/components/forms/WarrantBranchFields.astro`
- `src/pages/planning/[id]/preparation.astro` (must match the new warrant layout)
- `src/components/forms/ProjectScreener.astro` (only if needed for consistency)

## Problems to fix

- Follow-up fields do not appear under the question that triggers them. The 7 Yes/No tick boxes sit in one grid; their follow-ups (listing category, historical details, relaxation directions, dangerous-notice references, STAS reference, fire authority name) render further down. The user explicitly wants each follow-up directly under its question.
- Owner details are separate from "Applicant is the legal owner".
- Order is illogical: the declaration-authorisation checkbox sits before the certificate section; sustainability lands mid-page.
- Long questions are styled with the small uppercase `.label` class and are hard to read. Use sentence-case question text; keep `.label` only for short field labels.
- No progress or missing-information overview.
- Planning page: parking fields always show, but are only needed when "New or altered vehicle access" is Yes.

## Agreed design

Same warm look as the rest of the app. A user-approved plan:

1. Numbered sections in portal order:
   1. The work: screening summary and link, description, estimated value, current and proposed use, provision of services, conversion descriptions (conversion only), demolition weeks (demolition only).
   2. Applicant and owner: "Applicant is the legal owner", with the owner section directly underneath.
   3. Building and site questions: one row per question with its follow-up directly underneath. Fire and Rescue (name box shows when **unticked**), listed or conservation area, historical importance, relaxation direction (repeatable rows), dangerous building notice, STAS (only when shown by screening).
   4. Sustainability: new build only.
   5. Certificates: design certifier, then construction certifier.
   6. Fee: the disabled-person facilities question; work started is fixed No and shown as text.
   7. Review and authorise: the declaration-authorisation checkbox, then Save.
2. Each question is a clear row; when ticked, its follow-up appears directly below it inside the same row.
3. A sticky side panel with the application summary, the live fee (existing script), and a section list showing done or needs info.
4. An error summary at the top linking to each section with missing answers, and a save bar that stays visible.
5. Planning restyled to the same pattern; parking fields appear only when vehicle access is Yes. Check the Planning save schema still receives what it requires.

## Hard constraints

- Keep every input `name`, value, the repeatable array names (`relaxationReferences`, `relaxationDates`, `conversionDescriptions`, sustainability level arrays), and every `data-*` hook the scripts use. Moving markup anywhere inside the same `<form data-api-form>` is safe, because the scripts query the whole form.
- Keep tick boxes as checkboxes. The scripts read `.checked` for checkboxes and `.value === 'true'` for selects. Radios would break them (`namedItem` returns a RadioNodeList). If you change a control type, update its script and tests together.
- Keep the global rule `[hidden] { display: none !important }` in `global.css`.
- Keep warrant answers editable only on this page. The job review page (`src/pages/automation-job/[id].astro`) shows them read-only.
- Do not change APIs, schemas, the snapshot, preflight rules, the Agent, or the fee calculation.
- Splitting the follow-up components so their pieces sit next to each question is fine. Keep one copy of each component's script, so each controller still runs once.

## Confirmed product decisions (do not revisit)

- Work started before application: always No.
- Applicant is owner: selectable; default ticked. If No, ask whether the owner is the saved client (reuse details) or enter a separate owner.
- Fire and Rescue: Yes continues; No requires the authority name (20 characters maximum).
- Historical importance, dangerous notice and relaxation direction: selectable, with required follow-ups.
- Staged, limited life and restricted public inspection: fixed No, not shown.
- STAS: only for commercial or new build, via the project screener.

## Verification after the change

Run from the website folder and fix any failures:

- `npm run check`
- `npm run test:warrant-mapping:browser`
- `npm run test:release-reliability`

Then load both pages in the browser pane at desktop and phone width. Tick and untick every question and confirm its follow-up appears directly underneath. Confirm Save still works and the fee updates. Report design changes, automated results and anything not live-tested separately. Nothing here proves the live government portal works; supervised test drafts are still needed before release.
