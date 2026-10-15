# BuildDesk U: calculation investigation

Investigation dates: 14–15 October 2026. Scope: U-value mathematics only.

## Target identity

Installed executable: `C:\Program Files (x86)\BuildDesk UK 3.4\U\BuildDeskU.exe`.
File version: `3.04.0518`; size: 15,663,104 bytes.
SHA-256: `9c8a568d6ae3ecadec9a8bdd484733061c33d60573090dbbdf9612c07a7cca44`.

REA inspected the PE/CLI headers without executing the program. Its identity
inspection is retained as `ev_e55f7e39ca2ce31d1a4def2c87c2d833262d7211f1481a9bf7f71dcd4e7097a5`;
the linked summary is `ev_9f546d4443ff77b9b823680810edae2c952efd4dc2c25bbfe6327175d529c8a9`.
The executable is x86 PE32 with no CLI metadata. Separate byte inspection
found the VB5! header and MSVBVM60 dependency: evidence of native VB6 compilation.

## Ghidra findings

The executable was imported into the existing Ghidra project `TEST`, under
`/BuildDesk-UValue/BuildDeskU.exe`. Background auto-analysis finished and reported
8,700 functions. Ghidra's direct local API was used for focused decompilation;
the REA Ghidra provider itself was not configured.

The small `htdll32.dll` was also inspected. Its exports concern number parsing,
string conversion, and divide-by-zero handling, so it was not the U-value engine.
The calculation routines are in the main executable.

Public method names were recovered from the VB6 object metadata. Public type
descriptors supply vtable offsets; method-link tables supply code thunks; their
relative jumps lead to the implementation addresses in `calculation-routines.json`.
This parsing was execution-free. Layout references:
[python-vb](https://github.com/williballenthin/python-vb/blob/master/vb/__init__.py),
[visualbasic-rs](https://github.com/ATRAPSLLC/visualbasic-rs/tree/main/src/vb), and
[Gen Digital's function-prototype research](https://www.gendigital.com/blog/insights/research/recovery-of-function-prototypes-in-visual-basic-6-executables).

Observed in decompiled calculation code:

- `Calc_Rt1` / `Calc_Rt2` compute separate total-resistance limits.
- `CalcUWertInhomogen` averages those limits, takes the reciprocal, and applies
  correction terms. It calls the limits at vtable offsets 0x12c and 0x130.
- Air-gap correction code selects coefficients 0.00, 0.01, and 0.04 for internal
  codes 2, 3, and 4, and squares a resistance ratio. Public API levels 0, 1,
  and 2 in our module are intentionally independent of those internal codes.
- Fastener correction code contains factor 0.8, diameter-squared × pi / 4,
  and resistance-ratio arithmetic. Its complete input-selection and exclusion
  logic still needs validation. Our module implements the documented
  full-depth and restricted recessed simplified cases.
- UK-specific combined calculation is a separate, substantially larger routine,
  including alternative weighting and extra corrections. It is not fully reproduced.
- The native divide helper at 0xb375a6 uses two stack float arguments, an x87
  float return, and RET 8. Ghidra's prototype was corrected after assembly review.
- The UK thermal dispatch at 0xe2ce1c contains logarithmic ground branches,
  the coefficient 0.457, and pi constants. This supports identifying the ground
  calculation family; indirect VB calls prevent a complete branch reconstruction.
- `CalcUwertDS418InvertedRoofDeltaUr` at 0xef7fa8 iterates marked layers,
  selects precipitation options, contains a 0.04 cooling constant, and squares
  a resistance ratio. Its DS418 name and unresolved options mean it is not proof
  that every branch matches the implemented ISO 6946 rain procedure.

The main program's original bytes were not changed. Defined functions and the
helper prototype are analysis-database annotations. Decompiler output retains
VB runtime and indirect-call type limitations; recovered pseudocode is not
original VB source. No claim of complete program decompilation is made.

## What was verified

The independent module reproduces the published timber-wall result of 0.30
W/(m² K), with upper/lower resistance limits approximately 3.435 and 3.304.
It also reproduces the final result of the two-bridged-layer worked example.
Version 2 also reproduces the Irish government slab Example A4 (0.15078585,
published 0.15), two CIBSE slab examples, and a published suspended-floor
reference adjustment. The general suspended heat balance is checked against
explicit arithmetic fixtures and physical trends, not a populated BuildDesk case.
Air-layer checks include a published reflective-cavity example. Version 3 adds basements, perimeter insulation, roof families,
unheated spaces and a 2D numerical solver. Eighty-four automated tests cover the
stated methods, units, boundaries, integration, bundling and input rejection.

BuildDesk's default wall surface resistances of 0.13 and 0.04 were observed in
its desktop input dialog. A new unsaved wall was opened, but automated material
dragging did not create a usable test construction. Therefore no populated
BuildDesk runtime result was used as a golden test. Elmhurst equivalence also
remains unverified.

## Version 3 coverage and remaining uncertainty

The deliverable is now an original offline browser app with a broader calculation
engine. Its methods and source references are recorded in `METHODS.md`. Two
published below-ground wall outputs from a BuildDesk 3.4.5 report are reproduced;
this is distinct from testing our installed version 3.04.0518. The numerical
solver is independently checked against two public ISO 10211 benchmark cases.

REA passively inspected the existing Elmhurst wall page again, without changing
the page or collecting storage credentials. Evidence:
`ev_198761fb18aed224a1acd9e3fa84e9025844f20eb3939eafc3f651ccb2d7ada7`.
It showed the unsaved zero-layer wall, U = 5.88, and Details, Environment,
Unheated Space, Layers and Results stages. This supports the observed workflow,
not equivalence for a populated construction. Earlier frontend inspection found
the calculation request sent to Elmhurst's server; the server engine was not
available as downloaded client code. No server-side implementation was recovered.

Exact native rounding, UK dispatch, Digest 465 branch selection and complete
fastener exemptions remain unresolved. The app uses independently implemented
published equations with explicit scope checks. It contains no copied proprietary
UI, executable or complete material database, and it does not claim certification.
