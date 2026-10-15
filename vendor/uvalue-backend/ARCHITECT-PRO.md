# Architect Pro integration

User-supplied independent calculation package, version 4.0.0, received 15 October 2026.

Original ZIP SHA-256: `e966a97d35de7a3ce6f39d08b75f4c168b2f105d633e3b28b2bcd23e1b462c49`.
All 69 entries in its supplied SHA256SUMS.txt were verified before import. All 123 original tests passed locally.

Integration changes:

- Removed only the standalone CLI block at the end of `uvalue_engine.mjs`, avoiding Node-only dynamic imports and top-level await in the portal's browser bundle. Exported calculation code is unchanged. The original file remains in the supplied ZIP; its original checksum is retained in SHA256SUMS.txt.
- Exported the existing `calculatePlaneLayers` function directly so the browser build can omit unused specialist dispatch and numerical-solver code. Its mathematical implementation is unchanged.
- Added `uvalue_engine.d.mts` for the restricted functions consumed by the portal.
- Added `backend/calculations.d.mts` for the strict adapter used by the additional portal method forms. The adapter's original JavaScript and mathematics are unchanged.

The portal imports the mathematical functions directly. It uses its existing authenticated APIs, organisation ownership and saved reports, rather than starting this package's standalone HTTP service. Its input adapter retains inside-to-outside layer entry and reverses it for the engine. Zero-resistance membranes are retained in report inputs and omitted only from resistance arithmetic. The portal always includes assessed corrections, even when their sum is below 3%.

Specialist methods remain available in the package and its tests, but are not enabled by the portal form without the corresponding validated inputs. None of these changes establish exact BuildDesk/Elmhurst equivalence, certification or complete normative conformity. See METHODS.md for the supplied engine's validation boundaries.
