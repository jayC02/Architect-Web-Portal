# REA / Ghidra handoff: remaining U-value evidence

Prepared 15 October 2026 for the user-owned BuildDesk UK 3.4 installation. Target reported by the user: `BuildDeskU.exe` version `3.04.0518`, SHA-256 `9c8a568d6ae3ecadec9a8bdd484733061c33d60573090dbbdf9612c07a7cca44`.

Architect Pro already has the independent 4.0.0 source package and its 123 regression tests. Do not repeat that reconstruction. The portal, reports, saved revisions, review workflow, templates and project integration are ordinary application work; they do not need further decompilation.

## Deliverable format — most valuable first

Return small, reproducible fixtures rather than another broad decompilation. For each case include:

1. Exact executable version/hash, calculation family, selected standard/UK setting and input units.
2. Every populated input: layer order, thickness, design conductivity, surface resistances, framing fraction/alignment, geometry, cavity and correction settings.
3. Screenshots of inputs and result; native saved construction if possible; exported native report.
4. Raw internal numerical outputs where observable, displayed U, total/upper/lower R, each ΔU, reference area and any heat-loss coefficient. State separately what was observed at runtime and what was inferred from code.
5. One changed input at a time with the corresponding output. Record unsupported/error cases as well as successful calculations.

No populated native BuildDesk result has yet been established as a golden comparison in the evidence supplied to this chat. Obtain that evidence before claiming native equivalence. Do not treat matching rounded U-values alone as a mathematical match.

## Priority 1: UK-specific light-steel route

- Identify the actual dispatch into the UK-specific combined method versus ordinary ISO 6946 upper/lower bounds.
- Recover the complete accepted stud geometry, web/flange/gauge/spacing inputs, insulation placement, contact assumptions, correction sequence and exclusions.
- Determine whether the method is a Digest 465 empirical correction, a table lookup or another method. Include published references if exposed by the software.
- Supply at least three populated constructions: insulation between studs, continuous insulation crossing studs, and a geometry/configuration that the program rejects or routes elsewhere.
- Include the non-steel limiting case and the native report's method wording.

This is the highest-value missing family. Architect Pro deliberately does not offer a generic “steel conductivity” shortcut or claim full ISO 10211 numerical qualification.

## Priority 2: fixing applicability and correction decisions

Supply paired cases for full-depth and recessed round fixings; metal/plastic or composite fixings; both ends touching metal sheet; perpendicular/angled fixings; a bridged insulation layer; and multiple insulation layers. Recover precisely which R is used in each resistance ratio and which penetration length drives alpha.

Test the combined correction sum immediately below, exactly at, and above 3% of uncorrected U, with two individually small corrections whose sum exceeds the threshold. Record the UK setting that determines omission. The portal currently includes every entered/calculated ΔU deliberately; an intentional convention difference must not be misdiagnosed as a numerical bug.

## Priority 3: inverted-roof dispatch and evidence

Trace the reported routine near `0xef7fa8` only if this address resolves in the identified binary. It is a user-reported lead, not an address independently verified in this workspace.

- Identify ISO 6946 rainfall versus any DS 418 / UK alternative dispatch.
- Recover rainfall/drainage factors, membrane position, R above membrane, moisture-adjusted design conductivity and ballast treatment.
- Supply a zero-rainfall limit and two nonzero examples with different membrane positions.
- State applicability restrictions for fixings, local tapers and water-flow-reducing layers.

## Priority 4: ground method selection and area conventions

Trace the reported routine near `0xe2ce1c` if it resolves. Obtain native input/result fixtures for uniform slabs on both branches, horizontal and vertical edge insulation, shallow/deep naturally ventilated suspended floors, heated basement and unheated basement.

- Record B′, equivalent ground thickness, exposed perimeter convention, surface resistances and soil class/conductivity.
- For basements, distinguish footprint-normalised U from floor-plus-wall U and compare H, not U alone.
- For edge insulation, recover full/partial perimeter handling and limits of the analytical shortcut.
- For suspended voids, test just below/above the 0.5 m depth branch and document native handling.
- Identify the standard edition and any UK-specific switch; older native behaviour is comparison evidence, not automatic authority for a current standard.

## Priority 5: rounding and presentation

Use cases near a two-significant-figure boundary and near a regulatory target. Determine whether comparisons use unrounded U, displayed U or another internal precision. Capture how corrections and reference areas are described in native reports.

## Not required from REA / Ghidra

Do not extract proprietary material databases, artwork or interface assets. Public manufacturer declarations and licensed references can support an independent library. Current standard interpretation and independent thermal-method review require standards documents and a competent reviewer; disassembly alone cannot establish conformity or certification.

## Work remaining outside native reconstruction

Complete a clause-by-clause review of implemented ground/roof methods against the applicable current standards and UK conventions; independently qualify any numerical solver before professional release of that family; expand the maintained design-material library; and validate real project reports with a thermal assessor. These are validation/data/product tasks, not reasons to wait for a complete BuildDesk decompilation.
