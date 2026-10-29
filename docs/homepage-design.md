# Public homepage

The public `/` route introduces planning-permission and building-warrant preparation before sign-in. The surface contract is `.impeccable/surfaces/src-pages-index-astro.md`. Shared primitives and the separate public typography roles live in `DESIGN.md`; this document records only the homepage's structure, behaviour and asset provenance.

## Structure

`src/components/home/HomePage.astro` contains the public navigation, offer, interactive workbench, preparation workflow, illustrative connected project, questions and account-creation action. `ApplicationDemo.tsx` owns the browser-only demonstration. `src/styles/homepage.css` scopes the public system to `.home-page`, while `.application-demo` deliberately uses a familiar system UI family.

The workbench follows three steps: drawings arrive automatically, AI fills the application details after **Prepare example**, then **Submit example** runs an automatic submission simulation. Planning offers three sample documents; building warrant adds the specification. The desktop drawing viewer moves into a disclosure on phones. The plan artwork is exact orthographic SVG geometry, with a visible distinction between the existing plan and proposed extension.

## Behaviour and truth

- Drawing intake starts when the workbench enters the viewport. All example files appear in sequence; preparation stays disabled until every file has arrived. Received files can be previewed.
- **Prepare example** starts a bounded AI activity sequence. The site, applicant, application type and proposal fill progressively, with source labels and a typewriter treatment. No additional animation dependency is required.
- Preparation stops at the prepared state. **Submit example** is the second and final demo action; it automatically steps through opening the example portal, entering details, attaching documents and completing the simulated submission.
- Completion reveals the user-requested comparison: **1 minute with Architect Pro versus 25 minutes manually**, with **24 minutes back**. These are illustrative supplied values, not measured duration or a performance guarantee. The comparison is explicitly labelled and appears only after completion.
- Application-type changes, restart and unmount cancel all timers. A cancelled preparation or submission cannot advance another run. Restart clears entered fields, received documents and completion results.
- Reduced motion removes the animated waits and movement while retaining both deliberate button clicks and the resulting states. No sequence loops continuously.
- Stage headings receive focus after user-initiated navigation. Controls expose pressed, current and disabled states; progress is announced politely outside the busy content area. The final account link leads to registration.
- All information is illustrative and stays in browser state. The demonstration uploads no documents, calls no AI service and submits no application. It does not demonstrate council approval.

`npm run verify:homepage` checks the full two-click flow, cancellation during both timed stages, both application types, keyboard interaction, reduced motion, account navigation and overflow from 320px to 1600px using the isolated preview. Screenshots and the verification report are written to ignored local output folders.

## Typeface provenance

Manrope is self-hosted for public content at weights 400, 600 and 700. The existing dashboard typography is preserved, and the working demo uses Segoe UI Variable Text / Segoe UI. The font files are `public/fonts/manrope-regular.ttf`, `manrope-semibold.ttf` and `manrope-bold.ttf`.

`public/fonts/README.md` records the original Google Fonts stylesheet and exact font-file URLs, fetched on 22 October 2026. `public/fonts/Manrope-LICENSE.txt` contains the SIL Open Font License 1.1 supplied with these files. No external font request is needed when the homepage renders.

The small labels within plan and document previews are artefact metadata, not a general body-text scale. Keep the public text roles in `DESIGN.md` authoritative for future public content.
