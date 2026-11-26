# Homepage Story Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the homepage scroll story so one project visibly goes from planning to building warrant, construction and completion. An on-screen Architect Pro window shows the software reading documents, filling forms, handling fees and running in the background, and a time ledger shows 60 minutes by hand against 4 with Architect Pro.

**Architecture:** Everything stays a pure function of scroll progress `p ∈ [0,1]`. `story.js` owns the timeline: chapters, beats, copy, numbers, `poseAt`, `windowAt` and `ledgerAt`, all pure and unit-tested in Node. A new HTML overlay (`overlay.js`) renders the window and ledger from those states. The Three.js scene gains new modules for the warrant section, construction, inspection and the closing sketch. Documents fly to a world-space anchor computed every frame from the window's on-screen rectangle.

**Tech Stack:** Astro 5, Three.js (existing `ink.js` / `lines.js` pens), GSAP ScrollTrigger (existing), plain CSS in `src/styles/scroll-home.css`, `tsx` for unit tests, Playwright via `scripts/verify-homepage.browser.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-homepage-story-redesign-design.md`

## Global Constraints

- Numbers: planning 15 min / 1 min, building warrant 25 min / 1.5 min, completion 20 min / 1.5 min; `MANUAL_MIN = 60`, `AUTO_MIN = 4`, `SAVED_MIN = 56`. `src/pages/features.astro` imports `MANUAL_MIN` and `AUTO_MIN`; keep both exports.
- Fees: planning fee is **entered by the user** (window shows "Planning fee · added by you"). Only the **building warrant** fee is shown as calculated. Completion shows **"No fee"** and never a Pay step.
- U-value: show the ISO 6946 calculation and the report joining the warrant pack. **Never** show documents dropped in to produce a U-value.
- Decisions ("Approved", "Accepted") arrive as tracked replies, never as something the software decides. The small print keeps "illustrative; actual times vary; decisions rest with the planning authority and building standards verifier".
- **Project framing (plan decision, flagged to the user):** the product's planning automation is *householder* planning. So 14 Harbour Lane is an **existing two-storey house** (storeys 0–1 present and finished from the start), and the proposal is the **second-floor timber studio with roof terrace** (storey 2, its roof and terrace). Proposal text: "Second-floor studio extension with roof terrace".
- Application colours everywhere (sheets, window chips, ledger, beacons): planning `#6c86c6`, warrant `#488b85`, completion `#7c9d70`.
- Primary CTA is `/demo` "Book a demo"; secondary is Replay. Header and footer links from `markup.js` are unchanged.
- Look: the existing paper-and-ink presentation model. No bloom, lens flares or confetti. Fonts: Space Grotesk (already self-hosted).
- Robustness must keep passing everything `scripts/verify-homepage.browser.mjs` checks today: server-rendered rail, reload/rotation/back restore, WebGL loss and unavailable fallbacks, no-JavaScript transcript, reduced motion, the 8 viewport sizes, no `/api/` calls, no runtime errors, texture canvases released (`>= 24` released canvases).
- Mobile budget: at most today's texture count plus 6 new textures. Scaffold and lattice use `InstancedMesh` or merged geometry. DPR is capped as today.
- Copy: one headline (≤ 8 words) and one line (≤ 110 characters) per beat, British spelling, no em dashes.
- Commit on `main` directly; stage only the files a task names (the working tree has unrelated changes).

## Review Focus

1. **Scrolling backwards across chapter boundaries** must land on exactly the same frame and window state as scrolling forwards: test `windowAt`/`ledgerAt` are pure and monotonic (Task 1).
2. **Phones at 320×568 and 568×320** with the window, ledger and copy all on screen must not overlap: verify-homepage geometry check extended to `.app-window` and `.ledger` (Task 2).
3. **Jumping to a chapter from the dock mid-flight** (smooth scroll passing through beats) must not leave sheets stranded off-anchor: sheet positions derive only from `p` and the current anchor (Task 3); spot check in Task 9.
4. **Window rectangle missing or zero-sized** (WebGL ok but window hidden by CSS on a tiny landscape phone) must fall back to a fixed anchor, not `NaN` positions: unit test on `anchorFromRect(null)` (Task 3).
5. **Reduced motion** still shows every beat (state changes instantly, no lost content): verify-homepage reduced-motion phone passes through each chapter and reads the window title (Task 2).

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/home/scroll-story/story.js` (rewrite) | Numbers, applications, chapters (`acts`), beats and copy, `poseAt`, `windowAt`, `ledgerAt`, colour worlds and themes. Pure, no DOM, no Three. |
| `src/components/home/scroll-story/overlay.js` (new) | `windowMarkup(state)`, `ledgerMarkup(ledger)` (pure strings) and `createOverlay(root)` (DOM diffing). |
| `src/components/home/scroll-story/main.js` (modify) | Replace the HUD with the overlay; copy is driven by the current beat; 5 chapters. |
| `src/components/home/scroll-story/markup.js` (modify) | 5-part rail labels, overlay containers, transcript from beats, updated small print. |
| `src/styles/scroll-home.css` (modify) | Window, ledger, 5-column dock, responsive rules; remove HUD/minutes styles no longer used. |
| `scene/anchor.js` (new) | `anchorFromRect(rect, viewport)` → NDC; `worldAtNdc(camera, ndc, distance, out)`. |
| `scene/documents.js` (rewrite) | Three groups of 9 sheets: peel from the model, fly to the anchor, scan, settle. Portal, noise, record board and beacons are removed. |
| `scene/textures.js` (modify) | Sheet specs per application with palette bands, checkpoint icons, U-value layer labels. Portal, record and noise painters removed. |
| `scene/section.js` (new) | Clipping-plane section cut of the studio and the exploded wall build-up (5 layers). |
| `scene/construction.js` (new) | Ghost outline of the approved design, scaffold, one tower crane and one mobile crane, a load swinging, the site hoarding. |
| `scene/inspection.js` (new) | Ring of 4 checkpoints (fire, energy, drainage, electrical) orbiting the finished house and ticking off. |
| `scene/sketch.js` (new) | Pencil drawing a new house elevation on the paper beside the plot, with a pencil at the line's tip. |
| `scene/building.js` (modify) | Existing storeys finished from the start; studio massing (planning), ghost and timber rebuild (construction); exposes `clippingPlanes` for the section. |
| `scene/site.js` (modify) | 60-segment ring only in the opening (faint) and time back; landscaping on `pose.landscape`. |
| `scene/camera.js` (modify) | New rail for 5 chapters; the framing offsets keep the subject clear of the window. |
| `scene/index.js` (modify) | Wire the new modules; take `getAnchorRect` from `main.js`; enable `renderer.localClippingEnabled`. |
| `tests/homepage-story.test.ts` (new) | Unit tests for timeline, copy, numbers, window and ledger, overlay markup and anchor maths. |
| `scripts/verify-homepage.browser.mjs` (modify) | 5 chapters, new progress points, overlay geometry checks. |
| `scripts/homepage-silent-frames.mjs` (new) | Captures key frames with copy hidden for the silent test. |
| `package.json` (modify) | `"test:homepage": "tsx tests/homepage-story.test.ts"`. |
| `PRODUCT.md` (modify) | Replace the six-act description and the 30/3 numbers. |

## Timeline (pinned values)

Chapters (`acts`), with `start` and the dock `jump` target:

| # | name | start | jump |
|---|---|---|---|
| 0 | Planning | 0 | 0.035 |
| 1 | Building warrant | 0.27 | 0.30 |
| 2 | Construction | 0.50 | 0.56 |
| 3 | Completion | 0.66 | 0.72 |
| 4 | Time back | 0.86 | 0.90 |

`FINAL_AT = 0.965`. Rail height becomes `1500svh` (from `1150svh`).

Beats (`beats`, ordered by `at`; `app` is `planning | warrant | completion | null`; `kind` drives the window):

| at | chapter | app | kind | headline | line |
|---|---|---|---|---|---|
| 0 | 0 | null | intro | From first sketch to completion certificate. | Architect Pro prepares planning, building warrant and completion for you. |
| 0.03 | 0 | null | design | Every project starts with a red line. | Draw the site and the design, as you always have. |
| 0.12 | 0 | planning | collect | Your drawings, collected and read. | Every sheet labelled by type, scale and revision. Anything it is unsure of, it asks you. |
| 0.17 | 0 | planning | fill | Read into the householder application. | Each field filled from the drawings or the project. Nothing typed twice. |
| 0.215 | 0 | planning | pay | Add the fee and pay. | That is your part. It completes the portal in the background. |
| 0.27 | 1 | warrant | design | Then the technical detail. | Sections, structure, drainage, fire and energy for the building warrant. |
| 0.32 | 1 | warrant | uvalue | U-values, calculated to ISO 6946. | Set out the build-up and the result and report are ready for the warrant. |
| 0.38 | 1 | warrant | collect | A full building warrant, coming together. | Every document read and matched to the right section. |
| 0.42 | 1 | warrant | fill | Details finalised. Fee calculated. | The building standards fee is worked out for you. All you do is pay. |
| 0.455 | 1 | warrant | pay | Pay, and get back to drawing. | It submits in the background while you get on with the architecture. |
| 0.50 | 2 | null | build | Then it gets built. | Approved and on site. Every document stays in the project record. |
| 0.66 | 3 | null | inspect | Finished, and checked over. | Fire, energy, drainage and electrical, signed off one by one. |
| 0.74 | 3 | completion | collect | Completion certificates, gathered and read. | EPC, sustainability, construction and design certificates matched to the warrant. |
| 0.79 | 3 | completion | fill | Completion, ready to submit. | Details pulled from the warrant. No fee for a completion certificate. |
| 0.82 | 3 | completion | background | Submitted in the background. | Accepted when the verifier replies. |
| 0.86 | 4 | null | ring | An hour of portal work. Four minutes. | Planning, warrant and completion, completed in the background. |
| 0.965 | 4 | null | final | 56 minutes back on every project. | Spend them on architecture. |

Ledger: `manual` rises linearly 0→15 over planning `[0.12, 0.25]`, 15→40 over warrant `[0.38, 0.48]`, 40→60 over completion `[0.74, 0.84]`. `auto` rises 0→1, 1→2.5 and 2.5→4 over the same windows. Both hold flat elsewhere.

Statuses in the window's background card: planning `Submitted` at 0.25, `Approved` at 0.33; warrant `Submitted` at 0.48, `Approved` at 0.53; completion `Submitted` at 0.84, `Accepted` at 0.875.

Window content (exact):
- planning docs: `Location plan · 1:1250`, `Site plan · 1:200`, `Existing elevations · 1:100`, `Proposed elevations · 1:100`, `Floor plans · 1:100`; fields: `Site address — 14 Harbour Lane — Project`, `Applicant — Harbour Lane Homes Ltd — Project`, `Proposal — Second-floor studio extension with roof terrace — Design statement`, `Ownership — Certificate A — Ownership certificate`; fee row `Planning fee · added by you`.
- warrant docs: `Building sections · 1:50`, `Structural calculations`, `Drainage layout`, `Fire safety strategy`, `U-value report · ISO 6946`; fields: `Value of works — £85,000 — Project`, `Certifier of design — Structural — Certificate`, `Description — Second-floor timber studio — Drawings`; fee row `Fee calculated · £1,290.00`. That is `calculateBuildingStandardsFee({ submissionType: 'BUILDING_WARRANT', valueOfWorksMinorUnits: 8500000, effectiveDate: '2026-11-26', workStartedBeforeApplication: false, disabledPersonsFacilitiesOnly: false })` → `129000`.
- completion docs: `Energy Performance Certificate`, `Statement of Sustainability`, `Certificate of Construction`, `Form Q · design certificate`, `Fire Safety Design Summary`; fields: `Warrant — BW/26/0412 — Warrant`, `Covers all work — Yes — Warrant`; fee row `No fee`.
- U-value panel: layers `Brick 102.5 mm`, `Cavity 50 mm`, `PIR insulation 100 mm`, `Block 100 mm`, `Plasterboard 12.5 mm`; result `0.17 W/m²K`, method `ISO 6946`, target `0.17 or better · Section 6` with a tick.

---

### Task 1: Timeline, numbers and copy

**Files:**
- Modify (rewrite): `src/components/home/scroll-story/story.js`
- Create: `tests/homepage-story.test.ts`
- Modify: `package.json` (add `test:homepage`)

**Interfaces:**
- Produces (all from `story.js`):
  - Keeps `clamp, smooth, win, lin, mix` and `MANUAL_MIN, AUTO_MIN, SAVED_MIN, FINAL_AT, worlds, themes`.
  - `APPLICATIONS: { key: 'planning'|'warrant'|'completion', name: string, short: string, colour: string, manualMin: number, autoMin: number, fee: 'entered'|'calculated'|'none' }[]`
  - `acts: { name, start, jump, title, body }[]` (5; `title`/`body` = the chapter's first beat's headline/line, used by the transcript)
  - `beats: { at, chapter, app, kind, headline, line }[]` and `beatAt(p) → beat`
  - `actAt(p) → number`
  - `ledgerAt(p) → { manual: number, auto: number }`
  - `windowAt(p) → { visible: boolean, app: key|null, kind: string, title: string, docs: { label, read: boolean }[], fields: { label, value, source, filled: boolean }[], fee: { kind, text } | null, uvalue: { layers: string[], shown: number, result: string|null } | null, payTapped: boolean, statuses: { app, label }[] }`
  - `poseAt(p)` with exactly these keys (all in `[0,1]` unless noted): `p, redline, plan, grid, studio: { walls, slab, roof, glazing, terrace }, sheets: [{ peel, fly, read }×3], section: { cut, explode, uvalue }, construction: { ghost, hoarding, scaffold, cranes, swing (radians), lift, storey, roof, strike }, built, landscape, inspection: { ring, checks: [4] }, city, dusk, ringOpen, ringFinal, sketch`
  - `themes` and `worlds` have one entry per chapter boundary (themes length 5).

- [ ] **Step 1: Write the failing tests** in `tests/homepage-story.test.ts`:

```ts
import assert from 'node:assert/strict';
import * as story from '../src/components/home/scroll-story/story.js';
import { calculateBuildingStandardsFee } from '../src/lib/fees/building-standards-fee';
const samples = Array.from({ length: 2001 }, (_, i) => i / 2000);

assert.deepEqual(story.acts.map(a => a.name), ['Planning', 'Building warrant', 'Construction', 'Completion', 'Time back']);
assert.deepEqual(story.acts.map(a => a.start), [0, 0.27, 0.5, 0.66, 0.86]);
story.acts.forEach((a, i) => assert.equal(story.actAt(a.jump), i, `jump lands in ${a.name}`));
assert.deepEqual([story.MANUAL_MIN, story.AUTO_MIN, story.SAVED_MIN], [60, 4, 56]);
assert.deepEqual(story.APPLICATIONS.map(a => [a.key, a.manualMin, a.autoMin, a.fee]),
  [['planning', 15, 1, 'entered'], ['warrant', 25, 1.5, 'calculated'], ['completion', 20, 1.5, 'none']]);
assert.deepEqual(story.ledgerAt(0), { manual: 0, auto: 0 });
assert.deepEqual(story.ledgerAt(0.26), { manual: 15, auto: 1 });
assert.deepEqual(story.ledgerAt(0.49), { manual: 40, auto: 2.5 });
assert.deepEqual(story.ledgerAt(1), { manual: 60, auto: 4 });
samples.slice(1).forEach((p, i) => {
  const a = story.ledgerAt(samples[i]), b = story.ledgerAt(p);
  assert.ok(b.manual >= a.manual && b.auto >= a.auto, `ledger never falls at ${p}`);
});
samples.forEach(p => assert.deepEqual(story.windowAt(p), story.windowAt(p), 'pure'));
const fee = (p: number) => story.windowAt(p).fee?.text;
assert.equal(fee(0.22), 'Planning fee · added by you');
const warrantFee = calculateBuildingStandardsFee({ submissionType: 'BUILDING_WARRANT', valueOfWorksMinorUnits: 8500000, effectiveDate: '2026-11-26', workStartedBeforeApplication: false, disabledPersonsFacilitiesOnly: false });
assert.ok(warrantFee.calculationStatus === 'CALCULATED' && warrantFee.totalFeeMinorUnits === 129000);
assert.equal(fee(0.44), 'Fee calculated · £1,290.00');
assert.equal(fee(0.8), 'No fee');
samples.filter(p => story.windowAt(p).app === 'completion').forEach(p => assert.notEqual(story.windowAt(p).kind, 'pay', 'completion never asks for payment'));
story.beats.filter(b => b.app === 'planning').forEach(b => assert.ok(!/calculat/i.test(b.headline + b.line), 'planning never claims a calculated fee'));
story.beats.forEach(b => {
  assert.ok(b.headline.split(/\s+/).length <= 8, `headline length: ${b.headline}`);
  assert.ok(b.line.length <= 110, `line length: ${b.line}`);
  assert.ok(!/—/.test(b.headline + b.line), 'no em dashes');
});
assert.ok(!story.beats.some(b => /drop/i.test(b.line) && b.kind === 'uvalue'), 'no drop-in U-value claim');
assert.deepEqual(story.windowAt(0.9).statuses.map(s => s.label), ['Approved', 'Approved', 'Accepted']);
samples.forEach(p => {
  const flat = JSON.stringify(story.poseAt(p)).match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
  assert.ok(flat.every(Number.isFinite), `finite pose at ${p}`);
});
assert.equal(story.poseAt(0.4).construction.cranes, 0, 'no cranes before construction');
assert.equal(story.poseAt(0.2).section.cut, 0, 'no section before the warrant');
assert.equal(story.themes.length, 5);
console.log('homepage story tests passed');
```

- [ ] **Step 2: Run it to see it fail.** Run: `npx tsx tests/homepage-story.test.ts`. Expected: FAIL on the first `acts` assertion (six old acts).

- [ ] **Step 3: Rewrite `story.js`** with the exports above and the pinned timeline, beats, ledger windows, statuses and window content from "Timeline (pinned values)". `poseAt` windows are the implementer's call within each chapter's range, using `win` for eased moves and `lin` for clocks. `themes`/`worlds` take one paper colour per chapter from the existing palette (planning blue, warrant teal-grey, construction warm site tone, completion green, time back golden). Formatting `£1,290.00` uses `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`.

- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npx tsx tests/homepage-story.test.ts`. Expected: `homepage story tests passed`.

- [ ] **Step 5: Keep the old scene running.** Until Tasks 3–7 replace them, `site.js`, `building.js` and `documents.js` read old pose keys (`walls`, `slabs`, `roof`, `glazing`, `docs`, `manual`, `portal`, …). Add a temporary `legacyPose(pose)` in `scene/index.js` that maps the new pose to the old keys (old portal, noise and record keys → 0) so the page renders without errors. Each later task deletes the keys it no longer needs, and Task 7 deletes `legacyPose`.

- [ ] **Step 6: Add `"test:homepage": "tsx tests/homepage-story.test.ts"` to `package.json` scripts and commit**

```bash
git add src/components/home/scroll-story/story.js src/components/home/scroll-story/scene/index.js tests/homepage-story.test.ts package.json
git commit -m "feat: homepage story timeline from planning to completion"
```

### Task 2: Architect Pro window, ledger and copy wiring

**Files:**
- Create: `src/components/home/scroll-story/overlay.js`
- Modify: `src/components/home/scroll-story/main.js`, `src/components/home/scroll-story/markup.js`, `src/styles/scroll-home.css`, `scripts/verify-homepage.browser.mjs`
- Test: `tests/homepage-story.test.ts` (append)

**Interfaces:**
- Consumes: `windowAt`, `ledgerAt`, `beatAt`, `acts`, `APPLICATIONS` from Task 1.
- Produces: `windowMarkup(state) → string`, `ledgerMarkup(ledger) → string`, `createOverlay(root: HTMLElement) → { update(p: number): void, rect(): DOMRect | null }`. The window root is `#app-window` (`class="app-window"`, `data-app`, `data-kind`) and the ledger root is `#ledger` (`class="ledger"`). Task 3 uses `rect()`.

- [ ] **Step 1: Append failing markup tests**

```ts
import { windowMarkup, ledgerMarkup } from '../src/components/home/scroll-story/overlay.js';
const planningFill = windowMarkup(story.windowAt(0.19));
assert.match(planningFill, /data-app="planning"/);
assert.match(planningFill, /Second-floor studio extension with roof terrace/);
assert.match(planningFill, /from Design statement/);
assert.match(windowMarkup(story.windowAt(0.44)), /£1,290\.00/);
assert.doesNotMatch(windowMarkup(story.windowAt(0.8)), /data-action="pay"/);
assert.match(windowMarkup(story.windowAt(0.34)), /0\.17 W\/m²K/);
assert.match(ledgerMarkup({ manual: 40, auto: 2.5 }), /40 min/);
assert.match(ledgerMarkup({ manual: 40, auto: 2.5 }), /2\.5 min/);
assert.equal(windowMarkup({ ...story.windowAt(0.19), visible: false }), '');
```

- [ ] **Step 2: Run** `npx tsx tests/homepage-story.test.ts`. Expected: FAIL, `overlay.js` not found.

- [ ] **Step 3: Implement `overlay.js`.** The window is a compact product panel (≈ 340 px wide desktop) with these parts:
  - **Title bar:** the Architect Pro mark, the application name with its colour chip, and a step strip `Read · Fill · Pay`, or `Read · Fill · Submit` for completion.
  - **Document list:** each document gets a scan bar while being read and a tick once read.
  - **Field rows:** each field types in, with a "from …" source tag.
  - **Fee row and Pay button:** the button shows a tap ripple when `payTapped`.
  - **U-value panel:** when `uvalue` is set, the layers stack with the ISO 6946 result.
  - **Background card:** once the application is running, the window collapses into a card with an ETA, plus the status list.

  `createOverlay` writes `innerHTML` only when the markup string changes, and animates typing and ticks with CSS transitions keyed on classes. Use the frontend-design skill for this styling pass.
- [ ] **Step 4: Wire into `main.js`.**
  - Replace `setHud` and the act-5 minutes block with `overlay.update(p)`.
  - `setCopy` renders `beatAt(p)` (headline and line) under the chapter index. The final beat keeps the CTA block, now `/demo` "Book a demo" plus Replay, with the updated `fictionNote`.
  - Live region text: `Part ${act + 1} of ${acts.length}, ${name}. ${headline}`.
  - Pass `getAnchorRect: () => overlay.rect()` into `createExperience`.
- [ ] **Step 5: Update `markup.js`.**
  - Add the `#app-window` and `#ledger` containers in `.stage`. Rail `aria-label="ArchitectPro, a five-part scroll story"`.
  - Canvas label: "A house extension is drawn, approved, built and completed while its applications are prepared".
  - `fictionNote` names the 60-minute versus 4-minute comparison.
  - The no-JavaScript transcript lists every beat's headline and line, grouped by chapter, with one `<section>` per chapter (5).
- [ ] **Step 6: CSS.**
  - Dock: `grid-template-columns: repeat(5, 1fr)`; rail `height: 1500svh`.
  - Remove the `.hud`, `.minutes` and `.compare` rules.
  - Window placement: top-right on desktop (as the HUD was). On phones, full width under the header, with the ledger as one line beneath it.
  - Landscape phones: the window on the right at `min(42vw, 300px)` and the ledger inside the window's footer.
- [ ] **Step 7: Update `verify-homepage.browser.mjs`.**
  - Chapter loop `< 5`. Reload/restore progress point 0.55 → expect `data-act` `'2'`, and 0.35 → `'1'`; the fallback checks at 0.55 and 0.72 → `'2'` and `'3'`.
  - The overlap check uses `.app-window` and `.ledger` instead of `.hud`. Transcript sections `=== 5`.
  - New check on the reduced-motion phone: at each chapter's `jump`, `#app-window` or `#copy` contains that chapter's first beat headline.
- [ ] **Step 8: Run** `npx tsx tests/homepage-story.test.ts`, then `npm run preview:homepage` (background), then `HOMEPAGE_PREVIEW_URL=<printed url> npm run verify:homepage`. Expected: tests pass, and the verification JSON has `errors: []` with every check present.
- [ ] **Step 9: Commit** `overlay.js`, `main.js`, `markup.js`, `scroll-home.css`, the verify script and the test file: `feat: Architect Pro window and time ledger in the homepage story`.

### Task 3: Documents fly from the model into the window

**Files:**
- Create: `src/components/home/scroll-story/scene/anchor.js`
- Modify (rewrite): `scene/documents.js`; modify `scene/textures.js`, `scene/index.js`
- Test: `tests/homepage-story.test.ts` (append)

**Interfaces:**
- Consumes: `pose.sheets[g].{peel, fly, read}`, `APPLICATIONS[g].colour`, `overlay.rect()` via `getAnchorRect`.
- Produces: `anchorFromRect(rect: {left,top,width,height}|null, viewport: {width,height}) → {x: number, y: number}` (NDC; for `null` or a zero-size rect it returns `{ x: 0.55, y: 0.35 }`); `worldAtNdc(camera, ndc, distance, out: Vector3) → Vector3`; `createDocuments(scene, textures, { mobile })` → `{ update(pose, colors, time, dpr, anchor: Vector3), dispose() }`.

- [ ] **Step 1: Append failing tests** for `anchorFromRect`: a rect centred in a 1000×800 viewport → `{x:0,y:0}`; a rect at the top-right quarter → positive x and y; `null` and `{width:0,...}` → the fallback; never `NaN`.
- [ ] **Step 2: Run** the tests. Expected: FAIL, `anchor.js` missing.
- [ ] **Step 3: Implement `anchor.js`** and, in `index.js`, compute `anchor = worldAtNdc(camera, anchorFromRect(getAnchorRect(), {width, height}), 9, scratch)` each frame after the rig update.
- [ ] **Step 4: Rewrite `documents.js`.**
  - Three groups of 9 sheets, using the existing sheet specs regrouped. Planning: location, site, existing/proposed elevations, floor plans, roof plan, design statement, ownership certificate, form. Warrant: sections, structural calcs, fire, energy, drainage, specification, details, foundations, form. Completion: the 9 sheets already in `textures.js`.
  - Each sheet **peels** off the model where its drawing belongs: elevations from the façade, plans from the floor, sections from the cut. It **turns like paper** in flight (slerp with a slight flutter that dies as it lands), shrinks into the anchor, and fades as the window's document row ticks.
  - During `read`, a scan line in the application's colour crosses the sheet face.
  - Delete the portal screen, the noise sheets, the record board, beacons and the data stream.
  - In `textures.js`, sheet bands take the application colour, and the portal, record and noise painters and their textures are deleted.
- [ ] **Step 5: Verify visually.**
  - Run `node <scratch>/shots.mjs` (the screenshot helper pattern from the last session: Playwright, 1440×900 and 390×844, frames at 0.13, 0.15, 0.39, 0.76).
  - Expected: sheets visibly leave the model and arrive at the window on both sizes, and none are stranded mid-air at 0.25, 0.5 or 0.86.
  - Run the test file and the verification. Expected: pass.
- [ ] **Step 6: Commit** `anchor.js`, `documents.js`, `textures.js`, `index.js` and the tests: `feat: drawings peel off the model into the Architect Pro window`.

### Task 4: Planning on an existing house, and the warrant section with U-value

**Files:**
- Create: `scene/section.js`
- Modify: `scene/building.js`, `scene/index.js`, `scene/camera.js`

**Interfaces:**
- Consumes: `pose.studio.*`, `pose.section.{cut, explode, uvalue}`, `anchor`.
- Produces: `createBuilding(scene)` → `{ update(pose, colors, time), clippingPlanes: THREE.Plane[], studioBounds: THREE.Box3, dispose() }`; `createSection(scene, building, { mobile })` → `{ update(pose, colors, time, anchor), dispose() }`.

- [ ] **Step 1: Building.**
  - Storeys 0–1 render as the existing house, in finished render and grey ink, from `p = 0`.
  - The planning plan drawing inks the studio footprint at roof level and the red line on the ground.
  - The studio (storey 2 walls, its roof, the terrace and its glazing) rises in white on `pose.studio.*`.
  - Every surface material in the studio takes `clippingPlanes`; `index.js` sets `renderer.localClippingEnabled = true`.
- [ ] **Step 2: Section.**
  - On `cut`, a vertical plane slices the studio. A cap plane with a 45° hatch texture fills the cut face, and the outside half slides away 1.5 m.
  - On `explode`, the 5 wall layers (sized to the pinned build-up, in their material colours, each with ink edges) step out of the cut face and fan apart. Then they travel to the anchor in order while `windowAt(...).uvalue.shown` counts up in the window.
  - `uvalue` drives a tick ring on the wall.
- [ ] **Step 3: Camera rail for chapters 0–1.**
  - Opening: overhead paper with the faint ring.
  - Planning: the red line drawn top-down, then a low hero shot as the studio rises, then a three-quarter view with the façade facing the window side (so sheets fly towards it).
  - Warrant: square-on to the cut face for the section, then close on the layers.
- [ ] **Step 4: Verify.**
  - Screenshots at 0.05, 0.10, 0.15, 0.30, 0.34 and 0.40 on desktop and phone. Expected: the existing house reads as existing (finished), the studio as new (white), the cut as a section with hatch, and the five layers are legible.
  - The test file and the verification pass.
- [ ] **Step 5: Commit** `section.js`, `building.js`, `index.js`, `camera.js`: `feat: householder studio, warrant section and U-value build-up`.

### Task 5: Construction

**Files:**
- Create: `scene/construction.js`
- Modify: `scene/building.js`, `scene/camera.js`, `scene/index.js`, `scene/site.js`

**Interfaces:**
- Consumes: `pose.construction.{ghost, hoarding, scaffold, cranes, swing, lift, storey, roof, strike}`, `building.studioBounds`.
- Produces: `createConstruction(scene, building, { mobile })` → `{ update(pose, colors, time), dispose() }`.

- [ ] **Step 1: Construction module.**
  - **Hoarding** around the plot.
  - **Scaffold** wrapping the existing house up to studio height: instanced tubes, boards and ink edges, climbing bay by bay on `scaffold` and coming down on `strike`.
  - **Tower crane:** a lattice mast from merged boxes with ink edges, a jib and counter-jib, slewing on `swing`. A hook lowers a timber panel onto the studio on `lift`.
  - **Mobile crane** on the road, with its boom raised. Both cranes are yellow (`#e3a11f`) with ink edges, and they drive in and out on `cranes`.
- [ ] **Step 2: Building in construction.**
  - On `ghost`, the white studio fades to a dashed ink outline (the approved design).
  - On `storey`, timber-clad studio walls rise inside the ghost, panel by panel in step with the crane lifts. `roof` places the zinc roof. The ghost fades once the real studio fills it.
  - `pose.built` finishes materials as today.
- [ ] **Step 3: Time-lapse.**
  - The sun sweep and shadows run faster through `[0.5, 0.66]`: drive `sweep` from `p` with a steeper slope in this range in `index.js`. Shadows racing across the ground are the time-lapse cue.
  - The `city` and `worlds` colour moves are left to the implementer.
- [ ] **Step 4: Camera.** Chapter 2 is a slow orbit at mid height that keeps both cranes in frame on desktop, and a tighter, taller framing on phones.
- [ ] **Step 5: Verify.**
  - Screenshots at 0.51, 0.55, 0.59, 0.63 and 0.65, desktop and phone. Expected: scaffold, cranes, the ghost and the rising timber are clearly readable.
  - On the phone, frame time stays smooth: compare `performance.now()` deltas over 120 frames at 0.58 with the same at 0.30 in an emulated 390×844 run, and allow at most 1.3× worse.
  - The test file and the verification pass.
- [ ] **Step 6: Commit** `construction.js`, `building.js`, `camera.js`, `index.js`, `site.js`: `feat: construction with scaffold, cranes and the studio going up`.

### Task 6: Completion and inspection

**Files:**
- Create: `scene/inspection.js`
- Modify: `scene/site.js`, `scene/textures.js`, `scene/camera.js`, `scene/index.js`

**Interfaces:**
- Consumes: `pose.inspection.{ring, checks[4]}`, `pose.landscape`, `pose.sheets[2]`.
- Produces: `createInspection(scene, textures, { mobile })` → `{ update(pose, colors, time), dispose() }`; `textures.checkpoints: CanvasTexture[4]` (fire, energy, drainage, electrical line icons) and `textures.tick`.

- [ ] **Step 1: Landscaping and inspection.**
  - Landscaping (lawn, path, hedges, trees) arrives on `landscape`.
  - **Inspection:**
    - A thin ring at mid-height draws itself around the house.
    - Four checkpoint discs sit on it. Each, in turn, gets a sweep arc travelling to it from the previous one, then flips to the green tick on `checks[i]`.
    - Each checkpoint has a short leader line to the part of the house it checks: fire to the stair core, energy to the wall, drainage to the ground, electrical to the consumer unit position.
- [ ] **Step 2: Completion sheets.** Completion sheets peel from where each certificate belongs (EPC from the wall, drainage test from the ground) and fly to the anchor (Task 3 mechanism).
- [ ] **Step 3: Camera.** Chapter 3 is a full orbit at eye level during inspection, then a settle on a calm three-quarter view while the certificates fly.
- [ ] **Step 4: Verify.** Screenshots at 0.68, 0.71, 0.74, 0.77 and 0.83. Expected: the checks read as an inspection and the finished house reads as complete. The test file and the verification pass.
- [ ] **Step 5: Commit**: `feat: completion with inspection checkpoints and certificates`.

### Task 7: Time back and the closing sketch

**Files:**
- Create: `scene/sketch.js`
- Modify: `scene/site.js`, `scene/camera.js`, `scene/index.js` (delete `legacyPose`)

**Interfaces:**
- Consumes: `pose.ringOpen`, `pose.ringFinal`, `pose.sketch`, `pose.dusk`.
- Produces: `createSketch(scene, { mobile })` → `{ update(pose, colors, time), dispose() }`.

- [ ] **Step 1: Ring.** The 60-segment ring:
  - Faint red outline during the opening (`ringOpen`).
  - In time back (`ringFinal`) it draws in fully red, then segments 5–60 fall away (drop and fade, staggered). Segments 1–4 turn gold and stay.
  - Remove the old `manual`/`collapse`/`ringHide` logic.
- [ ] **Step 2: Sketch.**
  - On the paper beside the plot, a `ribbon()` drawing of a new house elevation reveals on `sketch`, in pencil grey.
  - A pencil (a hexagonal cylinder and cone with ink edges) rides the line's tip, using the existing `uReveal` tip glow.
  - Its final pose rests the pencil on the paper.
- [ ] **Step 3: Camera.** A golden-hour aerial pulls back so the finished house, the gold ring and the sketch are all in frame at `FINAL_AT`, and the final copy and CTA have clear space (left on desktop, bottom on phones).
- [ ] **Step 4: Clean up.** Delete `legacyPose` and every pose key no module reads. Run `rg "legacyPose|pose\.manual|portal" src/components/home`. Expected: no matches.
- [ ] **Step 5: Verify.** Screenshots at 0.88, 0.93 and 0.99 on desktop and phone. The test file and the verification pass.
- [ ] **Step 6: Commit**: `feat: time back with the falling ring and a new sketch`.

### Task 8: Silent test and polish pass

**Files:**
- Create: `scripts/homepage-silent-frames.mjs`
- Modify: any scene or CSS file the review identifies, `PRODUCT.md`

- [ ] **Step 1: Write the frames script.** It loads `HOMEPAGE_PREVIEW_URL` at 1440×900 and 390×844, adds `#copy, .ledger { visibility: hidden }`, and captures frames at 0.04, 0.10, 0.15, 0.19, 0.23, 0.31, 0.35, 0.41, 0.46, 0.55, 0.62, 0.71, 0.76, 0.84, 0.90 and 0.99 into `output/homepage-preview/silent/`. It also writes `contact-sheet.png` (a 4×4 grid per size).
- [ ] **Step 2: Run the script and review the contact sheets.** Each frame must be nameable as one of: "drawing it", "making the application", "calculating the wall", "paying / running in the background", "building it", "checking it", "time back". Fix any frame that isn't, through camera, timing, emphasis or colour, and re-run until all pass.
- [ ] **Step 3: Reduced-motion and dark-scheme pass.** At 390×844 with `reducedMotion: 'reduce'`, every chapter's window state appears. Contrast of the window text against the window background is ≥ 4.5:1 (check the two muted greys with a contrast calculation).
- [ ] **Step 4: Update `PRODUCT.md`.** Rewrite the homepage paragraph: five chapters (Planning, Building warrant, Construction, Completion, Time back), the Architect Pro window and ledger, 60 versus 4 minutes illustrative, a householder studio extension, the planning fee entered by the user, the warrant fee calculated, and no fee for completion.
- [ ] **Step 5: Final checks.** Run `npx tsx tests/homepage-story.test.ts`, `npx astro check` (0 errors) and `npm run verify:homepage`. Expected: all pass, with `errors: []`, `failedAssets: []` and `apiCalls: []`.
- [ ] **Step 6: Commit** the script, `PRODUCT.md` and the polish changes: `feat: homepage story polish and silent-frame review`.
