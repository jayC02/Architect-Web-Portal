# Public homepage

On 11 November 2026 the user selected `D:\Jayveer\Documents\websites\Web Development\architectpro-scroll-experiment` for the public website. The experiment is integrated directly into the Astro `/` route; there is no iframe or separately hosted bundle. Its original source directory is untouched.

## Ownership and structure

`src/components/home/HomePage.astro` renders the 3D story rail, initial HTML chapter, account navigation, existing brand asset, metadata and font preload before graphics initialization. `scroll-story/markup.js` owns this markup and a no-JavaScript transcript. There is no Simple view or view-switch control. Rendering the rail on the server gives reload restoration its full scrollable height before client code runs.

`scroll-story/main.js` owns progress restoration, chapter controls, graphics recovery and GSAP ScrollTrigger. `story.js` retains the experiment's six acts, camera poses and colour worlds. `scene/` contains the original procedural house, street, paperwork, portal and document textures. There are no downloaded models, raster scenes or external font requests. CSS in `src/styles/scroll-home.css` is scoped to `.scroll-home` so authentication and working-product pages retain their styling. Three.js 0.182.0 and GSAP 3.15.1 match the selected experiment.

## Behaviour and truth

- Native scrolling drives Site, Design, The portal, Automation, Tracking and Time back. Chapter buttons jump to the original act positions; Replay returns to the beginning. Scrolling backwards recomputes the same pose.
- Sign in and Create workspace stay available throughout, linking to `/login` and `/register`. The ending links to registration. Privacy and terms remain in the footer.
- The fictional project and the user's selected 30-minute versus 3-minute comparison are illustrative. Actual times vary; planning and building-standard decisions belong to the relevant authorities. The chapter dock labels the story illustrative throughout.
- This story reads no project or customer records, uploads no drawings and makes no AI or submission calls. Existing session-aware root redirects and legacy authentication query handling remain in `src/pages/index.astro`.
- As requested on 12 November, every supported browser opens in 3D, including reduced-motion and landscape phones. Reduced motion removes decorative CSS animation and the scrub delay; it never switches modes. Short portrait and landscape viewports use compact layouts.
- Three.js loads dynamically after the self-hosted fonts. Failed loading and unavailable WebGL show an explanation within the existing stage while native scrolling and HTML chapter controls continue to work. The page never replaces itself with another view.
- Normalized progress is saved in per-tab session storage and restored before loading the graphics. Storage failures are caught. Toolbar height changes never refresh the rail; width changes refresh its measurements while keeping progress and the existing canvas. Device classification remains fixed for the visit.
- Lost WebGL contexts dispose and recreate only graphics, preserving the copy, controls and scroll position. Recovery attempts are bounded to avoid a renderer-allocation loop. Leaving the surface releases its listeners, timers, animation triggers, textures and GPU contexts. Rendering pauses while hidden or offscreen.
- Mobile static document textures use 60% resolution and free their drawing canvases after GPU upload. Dynamic portal/record canvases remain available for repainting. Renderer density is capped at 1.5x on phones; mobile GPUs use the default power preference.
- The mobile update frames the model above the copy, uses a wider lens with gentler tilt on portrait screens, and raises the design shots. Neighbouring blocks and trees ease below the ground when they obstruct the camera; garden trees move only when very close to the lens. Floor slabs grow from the wall tops instead of passing close to the camera. These changes retain the earlier depth precision, fixed ground-layer order and full-street shadow coverage.
- Chapter controls expose the current step and chapter changes are announced politely. Copy and navigation remain HTML above the canvas, and graphics recovery leaves those elements and their focus intact.

## Visual treatment and provenance

The selected experiment's paper worlds, linework, camera motion, building materials and document textures carry the art direction. Overlay reds, greens, ochres and secondary text were darkened slightly for readable contrast. The existing `public/brand/architect-pro-logo.png` is used in navigation.

Space Grotesk (400, 500 and 700) was copied with the experiment's SIL Open Font License to `public/fonts/scroll-story/`. The experiment sourced these files from its parent project's installed font copy. Original authors: the Space Grotesk Project Authors, as recorded in `OFL.txt`. The house and textures are procedural source assets from the experiment; no new raster artwork ships.

The former `ApplicationDemo.tsx` and `homepage.css` remain as reusable source but are no longer loaded by the public homepage. Dashboard typography and behaviour are preserved.

## Verification

Run `npm run preview:homepage` for the isolated browser preview. It excludes application middleware and credentials and uses a simulated session only for redirect checks. `npm run verify:homepage` covers all chapters, scrolling back, Replay, keyboard navigation, reduced-motion 3D startup, reload restoration, toolbar resizing, rotation without canvas replacement, real WebGL loss/recovery, texture canvas release, mobile overflow, missing WebGL, unavailable 3D code, no JavaScript, blocked storage, account and legal navigation, session redirects and asset/runtime errors. It writes screenshots and a report to ignored `output/homepage-preview/scroll-story/`.

Run `npm run check` and `npm run build` for application diagnostics and production compilation. Browser preview results do not certify a production deployment or real-device GPU performance.
