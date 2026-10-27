# Public homepage

The public `/` route introduces planning-permission and building-warrant preparation before sign-in. The surface contract is `.impeccable/surfaces/src-pages-index-astro.md`. Shared primitives and the separate public typography roles live in `DESIGN.md`; this document records only the homepage's structure, behaviour and asset provenance.

## Structure

`src/components/home/HomePage.astro` contains the public navigation, offer, interactive workbench, preparation workflow, illustrative connected project, questions and account-creation action. `ApplicationDemo.tsx` owns the browser-only demonstration. `src/styles/homepage.css` scopes the public system to `.home-page`, while `.application-demo` deliberately uses a familiar system UI family.

The workbench follows three meaningful steps: select and inspect drawings, view prepared details, then complete an example review. Planning offers three sample documents; building warrant adds the specification. The desktop drawing viewer moves into a disclosure on phones. The plan artwork is exact orthographic SVG geometry, with a visible distinction between the existing plan and proposed extension.

## Behaviour and truth

- Application-type changes and restart reset the demonstration.
- The location plan and proposed drawing are required before preparation can continue.
- Visitors may edit the example proposal. Whitespace-only text blocks the review action and step navigation.
- Proposal edits clear review confirmations and any completed state. Document-selection changes also reset progress, so an earlier review cannot validate changed source material.
- Completing the three review confirmations enables the final example action; the resulting account link leads to registration.
- Step headings receive focus after navigation. Controls expose selected, current and disabled states, and progress is announced politely.
- All information is illustrative and stays in browser state. The demonstration uploads no documents, calls no AI service and submits no application. It does not demonstrate council approval.

## Typeface provenance

Manrope is self-hosted for public content at weights 400, 600 and 700. The existing dashboard typography is preserved, and the working demo uses Segoe UI Variable Text / Segoe UI. The font files are `public/fonts/manrope-regular.ttf`, `manrope-semibold.ttf` and `manrope-bold.ttf`.

`public/fonts/README.md` records the original Google Fonts stylesheet and exact font-file URLs, fetched on 22 October 2026. `public/fonts/Manrope-LICENSE.txt` contains the SIL Open Font License 1.1 supplied with these files. No external font request is needed when the homepage renders.

The small labels within plan and document previews are artefact metadata, not a general body-text scale. Keep the public text roles in `DESIGN.md` authoritative for future public content.
