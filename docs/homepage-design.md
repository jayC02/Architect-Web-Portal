# Public homepage

On 11 November 2026 the user selected `D:\Jayveer\Documents\websites\Web Development\architectpro-scroll-experiment` for the public website. The experiment is integrated directly into the Astro `/` route; there is no iframe or separately hosted bundle. Its original source directory is untouched.

## Ownership and structure

`src/components/home/HomePage.astro` renders the complete ordinary story, account navigation, existing brand asset, metadata and font preload. `scroll-story/markup.js` shares this markup with the client-side fallback. The page remains readable and its account links work without JavaScript.

`scroll-story/main.js` owns view switching, chapter controls and GSAP ScrollTrigger. `story.js` retains the experiment's six acts, camera poses and colour worlds. `scene/` contains the original procedural house, street, paperwork, portal and document textures. There are no downloaded models, raster scenes or external font requests. CSS in `src/styles/scroll-home.css` is scoped to `.scroll-home` so authentication and working-product pages retain their styling. Three.js 0.182.0 and GSAP 3.15.1 match the selected experiment.

## Behaviour and truth

- Native scrolling drives Site, Design, The portal, Automation, Tracking and Time back. Chapter buttons jump to the original act positions; Replay returns to the beginning. Scrolling backwards recomputes the same pose.
- Sign in and Create workspace stay available throughout, linking to `/login` and `/register`. The ending links to registration. Privacy and terms remain in the footer.
- The fictional project and the user's selected 30-minute versus 3-minute comparison are illustrative. Actual times vary; planning and building-standard decisions belong to the relevant authorities. The chapter dock labels the story illustrative throughout.
- This story reads no project or customer records, uploads no drawings and makes no AI or submission calls. Existing session-aware root redirects and legacy authentication query handling remain in `src/pages/index.astro`.
- Reduced motion and screens narrower than 1000px with less than 700px height start in Simple view. Users can explicitly request 3D. A live preference change to reduced motion also returns to the ordinary page.
- Three.js loads dynamically for the 3D view, after the self-hosted fonts. Failed loading, unavailable WebGL and lost GPU contexts recover to the ordinary story. A generation guard prevents an old asynchronous load from mounting after a view change.
- View changes release animation triggers, canvas resources, textures and GPU contexts. The scene pauses while hidden or offscreen. Crossing the phone breakpoint rebuilds the scene while preserving story progress.
- Chapter controls expose the current step, the simple-view switch exposes its pressed state and keeps keyboard focus through replacement, and chapter changes are announced politely. Copy and navigation remain HTML above the canvas.

## Visual treatment and provenance

The selected experiment's paper worlds, linework, camera motion, building materials and document textures carry the art direction. Overlay reds, greens, ochres and secondary text were darkened slightly for readable contrast. The existing `public/brand/architect-pro-logo.png` is used in navigation.

Space Grotesk (400, 500 and 700) was copied with the experiment's SIL Open Font License to `public/fonts/scroll-story/`. The experiment sourced these files from its parent project's installed font copy. Original authors: the Space Grotesk Project Authors, as recorded in `OFL.txt`. The house and textures are procedural source assets from the experiment; no new raster artwork ships.

The former `ApplicationDemo.tsx` and `homepage.css` remain as reusable source but are no longer loaded by the public homepage. Dashboard typography and behaviour are preserved.

## Verification

Run `npm run preview:homepage` for the isolated browser preview. It excludes application middleware and credentials and uses a simulated session only for redirect checks. `npm run verify:homepage` covers all chapters, scrolling back, Replay, keyboard navigation, view-switch races, mobile overflow, reduced motion, missing WebGL, unavailable 3D code, no JavaScript, account and legal navigation, session redirects and asset/runtime errors. It writes screenshots and a report to ignored `output/homepage-preview/scroll-story/`.

Run `npm run check` and `npm run build` for application diagnostics and production compilation. Browser preview results do not certify a production deployment or real-device GPU performance.
