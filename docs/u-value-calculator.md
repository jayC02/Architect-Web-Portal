# U-value calculations in Architect Pro

Open **U-values** in the navigation. Build layers from inside to outside, choose referenced products or enter referenced design values, then create a report. Calculations can be standalone or associated with an existing project. The report page provides **Print / save PDF** using the browser's print dialog.

## Implemented scope

- Opaque walls, roofs and floors exposed to outside air: homogeneous resistance and the combined upper/lower method for repeating timber or masonry bridging, based on [ISO 6946:2017](https://www.iso.org/standard/65708.html).
- Uniform slabs at ground level: characteristic dimension B′ = 2A/P and both equivalent-thickness branches, based on [ISO 13370:2017](https://www.iso.org/standard/65716.html).
- Unventilated, slightly ventilated and well-ventilated cavities. Resistance can be supplied with its basis or calculated from a high-emissivity table or the supported surface-emissivity model. Calculated cavities require plane parallel faces, dimensions greater than ten times thickness, mean temperature 10°C and temperature difference no greater than 5 K. Low emissivity requires product evidence. Reflective ventilated cavities need a separate assessment.
- Heat-flow direction controls internal surface resistance: upwards 0.10, horizontal 0.13, downwards 0.17 m²K/W. Exposed external resistance is 0.04; a well-ventilated boundary uses sheltered external resistance equal to internal resistance.
- Calculated air-gap corrections at levels 0/1/2 and restricted perpendicular round-fixing corrections, including recessed penetration. Fixings must not connect metal sheets at both ends or be counted in framing already. The main insulation path supplies homogeneous R for fixing calculations; air gaps use equivalent layer R. Both methods require an assessment reference. Downward-flow air-gap convection and calculated corrections interacting with ventilated boundaries are rejected. Other corrections can be entered as independently assessed ΔU values. All corrections are included, even below 3%.
- Optional user-selected targets and clause references. Comparisons use unrounded results; display uses two significant figures. Meeting a target is not a whole-building compliance decision.

The combined approximation rejects resistance ratios exceeding 1.5. Layers sharing a bridge group have aligned framing and matching area fractions; separate groups use independent fractions. Up to four groups are supported. Slight ventilation interpolates resistances and records both endpoint bounds in the report.

Steel framing, inverted roofs, glazing, suspended ground floors, basement floors, separate slab edge insulation and flowing-groundwater adjustments require other methods and cannot be issued as supported calculations here. Condensation, junction Ψ-values and whole-building energy models are outside scope. This implementation is not BRE-accredited or independently certified software, and does not claim complete implementation of every BR 443 convention.

## Material declarations

The initial library contains SOPRATHERM GA4000, Knauf Loft Roll 44, ROCKWOOL Flexi and Gyproc WallBoard 9.5/12.5 mm. It records source links and constrains thicknesses and declared conductivity, including Flexi's thickness-dependent conductivity. References were checked on 14 October 2026. The author must establish whether the declaration is an appropriate design value for moisture, ageing and application; choose Custom material for a different referenced design value. The library is deliberately limited to sourced declarations.

Every included layer and bridge needs a reference before a report can be saved. Ground slabs also require a soil conductivity reference. Ignored outer layers beyond a well-ventilated cavity remain visible in the report.

## Saved reports and access

The server validates inputs and recalculates results. Each report stores inputs, results, project/practice context, author, creation date, method and engine versions and an input fingerprint. Calculated corrections include their inputs and working. Reports are immutable through the app: **Load copy** and **Edit a copy** create a new working calculation, and its next save creates a separate report. Legacy reports retain their saved results; old inputs and local drafts receive defaults only when restored for editing.

Session authentication and organisation-scoped queries protect the calculator, list, detail endpoint and report. The new table has RLS enabled and browser `anon` / `authenticated` grants revoked; this app's existing server-side session model remains authoritative. Retry request IDs are scoped to organisations and recover duplicate concurrent saves without replacing the original snapshot. Working drafts are stored locally under organisation/user-specific keys and validated before recovery. Requests time out with inputs retained.

## Deployment and verification

The additive Prisma migration is `20261014180000_u_value_calculations`. It creates only the calculation table, its indices and foreign keys and applies access restrictions in one transaction. It has already been applied to the configured Architect Pro database. Other environments should run the established Prisma migration deployment step before publishing the portal build. The shared database has six applied migrations absent from this checkout; do not reset or rewrite its history. This engine integration requires no further schema changes or separate calculation service.

- `npm run test:u-values`: the supplied package's 123 tests, portal mathematical references, engine-adapter checks including published single/two-bridged wall examples and 40 varied section mappings, validation, immutable saves, concurrent retries, ownership, authentication and CSRF checks.
- `node node_modules/tsx/dist/cli.mjs scripts/verify-u-values.ts`: local browser fixture using the actual React components and saving service, checking desktop/mobile interaction, retry recovery, editing copies, draft recovery and PDF output. Uses fixture storage; does not connect to a production account.
- The ground-floor checks independently reproduce both branches published in [BRE's June 2026 RdSAP 10 specification](https://bregroup.com/documents/d/bre-group/rdsap-10-specification-2026-06-07). This calculator does not implement RdSAP itself.

## Supplied engine integration

The user supplied `uvalue-backend.zip`, release 4.0.0, on 15 October 2026. Its SHA-256 is `e966a97d35de7a3ce6f39d08b75f4c168b2f105d633e3b28b2bcd23e1b462c49`. All 69 manifest entries were verified, all 123 supplied tests passed here, and all 16 example constructions passed the package's actual HTTP smoke check. The source, tests and original scope documents are retained under `vendor/uvalue-backend`; integration changes are documented in `ARCHITECT-PRO.md` there.

The portal imports the mathematical functions directly and adapts its inside-to-outside layer order to the engine's outside-to-inside convention. It preserves material references and product constraints. Zero-resistance membranes remain in the report build-up and are omitted only from resistance arithmetic. The standalone service's optional API-key authentication is not used in place of portal session authentication.

The package additionally contains basement, edge-insulation, suspended-floor, roof-space, tapered-roof, opening/component, project heat-loss and numerical-mesh methods. Those specialist inputs are not yet exposed by the current portal form. Passing their supplied tests does not establish full normative conformity or exact BuildDesk/Elmhurst equivalence; the supplied METHODS.md and builddesk-findings.md retain those boundaries.

Calculation method version: `AP-THERMAL-2.0.0`; supplied engine version: `4.0.0`. Before extending supported systems, add source-backed reference cases and increment the method version. Existing report results must remain unchanged.
