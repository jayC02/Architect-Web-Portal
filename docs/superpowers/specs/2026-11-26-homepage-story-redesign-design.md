# Homepage scroll story redesign: planning to completion

Date: 2026-11-26
Status: approved 2026-11-26 (approach A)

## Why

The current homepage story looks good and has the right general idea, but it does not show what the software does. A visitor sees a house, a storm of paper and a portal. They don't come away knowing that Architect Pro:

1. collects the project's documents and reads them automatically,
2. uses what it read to fill in the application forms,
3. finalises the details and calculates the building warrant fee, so all you do is pay,
4. runs in the background while you get back to drawing and architecture,
5. does this for all three stages of a job: planning permission, building warrant and completion certificate,
6. also calculates U-values to ISO standards, with a report ready to attach to the warrant.

The redesign keeps what works (the 3D house, the paper-and-ink look, the scroll-driven camera) and rebuilds the story around the **real lifecycle of a project**. The building goes from drawing to construction to finished. At each stage the software visibly does that stage's paperwork.

**Success:** someone who scrolls once, without reading the small print, can say: "It reads my documents, fills in planning, warrant and completion for me, works out the warrant fee, I just pay, and it saves me about an hour per project."

## Goals

- Show the whole journey, planning → building warrant → construction → completion, as one continuous build of one house.
- Clearly explain each automation step on screen, in plain words, at the moment the scene shows it.
- Make the time saving obvious and cumulative: about 60 minutes by hand, 4 minutes with Architect Pro.
- Introduce the U-value calculator inside the warrant stage, where it actually belongs.
- Keep it precise: every claim matches what the product does today.

## Non-goals

- Not a product tour of every feature. Tracking, Xero, the calendar and roles stay on the Features page.
- No real uploads, AI calls or submissions. It's still a local, illustrative animation.
- No new 3D engine or library. It stays on the existing Three.js and GSAP setup.

## Anti-goals (it fails even if it technically works if…)

- **It's pretty but vague.** If a visitor can't say what the software does, it failed. This is the main problem today.
- **It overclaims**, for example implying the council approval is automatic, a fee is charged for completion, or a feature exists that doesn't.
- **It's too long to finish.** Three stages risk a story three times as long. Each stage must earn its scroll length.
- **It breaks on phones** or drops the current robustness (reload restores position, rotation, WebGL fallback, reduced motion, no-JavaScript transcript).

## Facts from the product that shape the story

| Story beat | What the product does today | Implication |
|---|---|---|
| Documents read automatically | AI reads each PDF: drawing type, number, revision, paper size. Anything uncertain goes to the user to confirm. | Show documents being read and labelled. Don't show anything as "guessed". |
| Forms filled | Planning, warrant and completion are filled from the project record, and each value shows where it came from. | Show fields filling, with a small source tag on each. |
| Fees | The **building standards** fee is calculated. The planning fee is **entered on the draft** ("Enter the planning fee in pounds"). Completion certificates have **no fee**. | Confirmed 2026-11-26: the planning fee is entered by hand. Only the warrant says "fee calculated for you". Planning says "add the fee, then pay". Completion shows no payment. |
| All you do is pay | The Desktop Agent completes the portal and **stops at payment for you to approve**. | This fits your wording exactly. |
| Runs in the background | The Agent runs on a PC in your office, with live progress and an ETA. | Show the work continuing on a small floating card while the scene moves on. |
| Approved / accepted | Decisions come from the council and the verifier. Gmail tracking matches their replies to the application. | Show "Approved" and "Accepted" arriving as tracked replies, not as something the software decides. Keep the disclaimer. |
| U-value calculator | ISO 6946, ISO 13370, ISO 10077-1, ISO 13789 and BRE BR 443. You build up the layers, then export a report to attach to the warrant. Calculating from dropped-in documents is **not live yet** (confirmed 2026-11-26). | Show the ISO calculation and the report joining the warrant pack. Don't show documents being dropped in to produce a U-value. |
| Time | You gave about 15 min for planning, 25–30 min for the warrant, about 20 min for completion; call it 60 min in all, and 4 min with Architect Pro. | Use 15 + 25 + 20 = 60. With Architect Pro: 1 + 1.5 + 1.5 = 4 (my split; the Agent's typical runs are about 1¼, 2 and 1½ min). |

## Approaches considered

**A. Rebuild the story inside the existing 3D scene (recommended).**
Keep the Three.js house, the camera rail, the paper colour worlds and all the robustness work. Rewrite the chapters, add construction (cranes, scaffold, foundations) and an inspection walk-round to the model, and add one new on-screen element: a small **Architect Pro window** that shows the software working (documents read, fields filling, fee, pay). The 3D shows *the project*, and the window shows *the software*. That split is what makes it precise.
*Trade-off:* most work goes into new 3D props and a longer camera path, but nothing already working gets thrown away.

**B. Two layers: a flat 2D product animation driven by scroll, with the 3D house as a background.**
The software steps become crisp 2D UI animation (very legible), and the house only shows progress in the background.
*Trade-off:* clearer UI, but the house becomes wallpaper and loses the "very cool" quality you liked. It also means two animation systems to keep in sync.

**C. Start again as an illustrated 2D scroll (SVG or Lottie), with no 3D.**
Lightest and the most phone-friendly. Every frame is art-directed.
*Trade-off:* throws away the existing scene and its hard-won mobile fixes, and needs a lot of new illustration. It's a different look, not an evolution.

I recommend **A**. You said the current one is very cool and has the right general idea, and A keeps that. The missing clarity comes from showing the software itself, and the Architect Pro window does that without a second engine.

**Chosen: A** (2026-11-26). The brief for the build: "extremely visually impressive", "a proper story that can kind of speak for itself", built to a senior designer's standard.

## Art direction

The bar is a story that **reads with the captions switched off**. If you mute every word, each chapter still has to say what is happening. Text confirms the picture; it never carries it alone.

**One visual idea per chapter (signature shots).** Each chapter has a single unmistakable image that a visitor would describe afterwards:

| Chapter | Signature shot | What it says without words |
|---|---|---|
| Planning | Ink plan lines on the paper **extrude upward into walls**, then the elevations **peel off the model as paper sheets** and fly into the Architect Pro window. | The design becomes drawings, and the drawings become an application. |
| Building warrant | The house is **sliced open in section**. The wall build-up **explodes into its layers**, which stack up in the window and turn into a U-value. | Technical detail, calculated. |
| Construction | A **time-lapse**: the sun sweeps overhead, shadows race across the ground, two cranes swing, scaffold climbs and falls, and white turns into real materials floor by floor. | Months pass, and the building is built. |
| Completion | A **ring of inspection checkpoints** orbits the finished house and ticks off one by one, while completion certificates gather into the window. | Checked over and signed off. |
| Time back | The 60-minute ring returns and **56 segments fall away**, then a **pencil starts sketching a new house** beside the finished one. | The hour comes back, and goes into design. |

**Colour codes the paperwork.** Each application keeps one hue everywhere: its sheets, its card in the window, its ledger segment and its status beacon. The colours come from the product palette in DESIGN.md: planning `#6c86c6`, warrant `#488b85`, completion `#7c9d70`. Without reading a word, a visitor sees "blue things → blue application".

**The Architect Pro window is a real piece of UI**, not a diagram. It uses the product's actual vocabulary (document labels, "from Location plan" source tags, the Pay step, the background progress card with an ETA), so the homepage looks like the software it sells.

**Motion rules**
- Everything is a pure function of scroll, as today: scrolling backwards replays exactly.
- **Cause, then effect.** The camera looks at the thing that happens next: the sheet before it flies, the section before it explodes. Nothing important happens off-screen.
- **Each chapter's three beats get the same rhythm** (Collect & read → Fill & finalise → Pay & background), so the second and third times are faster and still legible.
- **Physical easing.** Sheets lift, turn and settle like paper; cranes ease in and out; nothing slides at a constant speed except clocks.
- Restraint: no glow, no lens flares, no particle confetti. The current paper-and-ink presentation-model look stays. Impressive comes from choreography and craft, not effects.

**Silent test (acceptance).** Screenshots at each chapter's key frame, with all copy hidden, are shown in sequence. Each must be explainable as one of: "drawing it", "making the application", "calculating the wall", "building it", "checking it", "time back". Any frame that isn't is redone.

## The story

One house, one continuous camera. Five chapters in the dock: **Planning · Building warrant · Construction · Completion · Time back.** Each application chapter follows the same three beats, so the pattern is learned once and recognised twice more:

> **Collect & read** → **Fill & finalise** → **Pay, and it runs in the background**

Running across the whole story is a **time ledger**: two thin bars pinned in the corner. "By hand" grows 15 → 40 → 60 min; "Architect Pro" grows 1 → 2.5 → 4 min. The saving builds up as you scroll, instead of being announced once at the end.

### 0. Opening (hero)
- Scene: blank tinted paper, with a 60-segment ring faintly drawn: "One project. Three applications. About an hour of portal work."
- Headline: **From first sketch to completion certificate.** Sub: "Architect Pro prepares and submits planning, building warrant and completion for you."

### 1. Planning: about 15 min by hand, 1 min with Architect Pro
- **Scene** (close to today): the red line is drawn, the plan inks itself, and the walls rise as a white massing model. Elevations and the location plan peel off the model as sheets.
- **Collect & read:** the sheets fly into the Architect Pro window. Each gets a scan line and a label: *Location plan · 1:1250 · Rev A*, *Proposed elevations · 1:100*. Caption: **"Your drawings, collected and read automatically."**
- **Fill & finalise:** form fields fill line by line (site address, applicant, proposal description), each with a small "from Location plan" or "from project" tag. Caption: **"Read into the householder application. Nothing typed twice."**
- **Pay:** the window shows *Householder application ready · Planning fee £xxx (added by you) · Pay*. A cursor taps Pay, and the window shrinks to a background card: *Submitting… 0:58*. Caption: **"Add the fee and pay. It does the portal in the background."**
- Result: a few scrolls later, the card shows *Planning permission: Approved* (tracked reply).

### 2. Building warrant: about 25 min by hand, 1.5 min with Architect Pro
- **Scene:** the model cuts open into a section, with technical sheets alongside: sections, structural calcs, drainage, fire strategy, energy.
- **U-value moment:** the wall build-up (brick, cavity, insulation, block, plasterboard) slides out of the section as layers into the window. The U-value calculator stacks them and shows **0.17 W/m²K · ISO 6946**, with a tick against the target. The report drops into the warrant pack. Caption: **"U-values calculated to ISO standards, with a report ready for the warrant."** The layers come from the model, not from dropped-in documents, because that feature isn't live yet. When it ships, this beat can gain a "drop in a specification" step.
- **Collect & read → Fill & finalise:** same beats, faster now that the visitor knows them. Caption: **"Full building warrant ready. Fee calculated for you."**
- **Pay** → it runs in the background. Card: *Building warrant: Approved*.

### 3. Construction (no paperwork; a breather that shows time passing)
- **Scene:** the site comes alive. The ground is excavated, foundations are poured, scaffold wraps the walls, and **two little tower cranes** swing materials in. The massing model turns into real materials floor by floor, and the sun moves across the sky.
- Caption: **"While it's built, everything stays in the project record."** The background card quietly logs warrant documents and inspection dates.
- Purpose: shows the gap between warrant and completion, and makes completion feel earned.

### 4. Completion: about 20 min by hand, 1.5 min with Architect Pro
- **Scene:** the cranes and scaffold leave, the garden and hedges go in, and the house is finished. An **inspection walk-round** follows: a ring of checkpoints around the house (fire, energy, drainage, electrical) each get a tick.
- **Collect & read:** completion documents fly in (EPC, Statement of Sustainability, Certificate of Construction, Form Q, Fire Safety Design Summary) and are read and matched to the certificate. Caption: **"Completion certificates gathered and read. Details pulled from the warrant."**
- **Fill & finalise:** *Completion certificate ready · No fee*. It submits in the background. Card: *Completion certificate: Accepted*.

### 5. Time back
- **Scene:** golden hour aerial of the finished house. The 60-minute ring returns: 4 segments stay lit, and 56 fade to outline.
- The ledger finishes: **60 min → 4 min.**
- A pencil line sketches a *new* house on the paper beside it, which is the point of the whole thing. Headline: **"56 minutes back on every project. Spend them on architecture."**
- CTA: *Book a demo* · *Replay* (the site's current primary action). Then the small-print disclaimer, updated.

### Screen layout (desktop)

```
┌──────────────────────────────────────────────────────────────┐
│ Architect Pro           Features  Pricing  Sign in  [Demo]   │
│                                         ┌──────────────────┐ │
│                                         │ Architect Pro    │ │
│            3D scene                     │ ▸ Location plan ✓│ │
│     (house, sheets, cranes)             │ ▸ Elevations   ✓ │ │
│                                         │ Site address ▓▓▓ │ │
│ 01 ── Planning                          │ Fee £xxx  [Pay]  │ │
│ Your drawings, collected                └──────────────────┘ │
│ and read automatically.                 By hand   ████ 15m   │
│ One short line of detail.               Arch Pro  ▏ 1m       │
│ Planning · Warrant · Construction · Completion · Time back   │
└──────────────────────────────────────────────────────────────┘
```

On phones, the window sits at the top (where the status panel is today), the copy sits at the bottom, and the ledger shrinks to one line under the window.

## Copy principles

- One headline per beat, five to eight words, and only one short body line.
- Use the user's own phrases where they fit: "documents all collected and automatically read", "a full householder application and building warrant ready", "all you have to do is pay", "back to what is actually enjoyable: drawing and architecture".
- Show numbers once and keep them consistent everywhere (headline, ledger, ring, small print, Features page).

## Constraints the build must keep

- Everything currently checked by `scripts/verify-homepage.browser.mjs`: server-rendered rail, reload/rotation/back-navigation restore, WebGL loss recovery, WebGL-unavailable fallback, no-JavaScript transcript, reduced motion, 8 viewport sizes from 320×568 to 932×430, no API calls, no console errors. That script's chapter counts and progress points will be updated to the new chapters.
- Performance on phones: the new props (cranes, scaffold, layers) use instanced or merged geometry. Texture memory stays at or below today's.
- `src/pages/features.astro` imports `MANUAL_MIN` and `AUTO_MIN` from `story.js`, so those exports stay.
- Small print continues to say the example and times are illustrative, and that decisions rest with the planning authority and verifier.

## Rough size

This is a project, not a tweak: roughly the same size as the original story build. It covers a new story timeline and copy, the Architect Pro window and ledger (HTML/CSS overlay), construction and inspection props in 3D, a longer camera path, and updated verification. I'd build it in stages that each work on their own: (1) new timeline, copy and window over the existing scene; (2) construction props; (3) completion and inspection; (4) time-back ending and polish.

## Open questions for you

1. ~~**U-value from documents.**~~ Answered: not live yet. The story shows the ISO calculation and the report, without a drop-in step.
2. ~~**Planning fee.**~~ Answered: entered by hand. Only the warrant fee is shown as calculated.
3. ~~**Approach.**~~ Answered: A.

## Left to the builder

Exact camera framings, colour worlds per chapter, prop modelling detail, easing and timings, and the exact sample values in the window (for example the fee amount and the U-value). All of it stays inside the story, copy and constraints above.
