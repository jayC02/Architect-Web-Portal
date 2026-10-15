# Calculation methods and validation coverage

Version 3, 15 October 2026. Independent equations and an original browser interface;
no claim of complete recovery of Elmhurst's server or BuildDesk's UK dispatch.

## Plane layers and corrections

R = d/λ. For explicit section fractions f, the upper resistance limit is the
reciprocal of Σ(f/Rpath). The lower limit adds surfaces and each layer's reciprocal
Σ(f/Rsection). The combined R is the mean of those limits; base U is 1/R.
The engine rejects an upper/lower resistance ratio above 1.5 and explicit metal
bridge/numerical-analysis flags. Repeating metal framing needs a numerical model.

The [Scottish Government worked guide](https://www.gov.scot/publications/tables-of-u-values-and-thermal-conductivity/)
provides single- and two-bridged-layer validation. The two-layer example has
inconsistent rounded intermediate totals; checks use its physical inputs and
reported final U = 0.30, with sensible tolerance for printed intermediates.

Air-gap ΔU is level coefficient [0, 0.01, 0.04] × (insulation R/total R)².
Nonzero downward-flow convection corrections are rejected. The perpendicular
full-depth fastener expression uses α = 0.8; recessed penetration uses
α = 0.8 d1/d0 and R1 = d1/λinsulation. Both use the homogeneous path resistance
ignoring bridge effects. A bridged construction must explicitly identify that path.
Tests check the expected full-depth and half-depth values and correction ordering.

Sources: [BR443:2019](https://www.cibse.org/media/wzrjrf3l/conventions-for-u-value-calculations.pdf),
[MATEC fastener paper](https://www.matec-conferences.org/articles/matecconf/pdf/2019/31/matecconf_cesbp2019_02089.pdf)
and [JPA Designer manual](https://www.techlit.co.uk/downloads/JPAUserManualUK5.01.pdf).
Composite-fastener exemptions, angled screws, bracket/rail systems and both-end
metal-sheet contact are not inferred from the simplified inputs.

## Cavities and inverted roofs

Calculated cavities require width and height greater than ten times cavity
thickness, and thickness no greater than 300 mm. High-emissivity table values
are interpolated. The analytic low-emissivity subset assumes mean temperature
10°C and ΔT no greater than 5 K; emissivity below 0.2 needs evidence. The engine
supports one external slightly/well-ventilated cavity and exposes the endpoint
construction models. Multiple ventilated cavities or corrections interacting
with ventilation reject. A justified supplied R can be used for other assessed
cavities without claiming that the app derives it.

Sources: [ISO 6946:2007 publisher preview](https://cdn.standards.iteh.ai/samples/40968/eef030b005bd4146b90cddaf78c64f06/ISO-6946-2007.pdf),
BR443 and an [ANIT reflective-cavity example](https://www.anit.it/wp-content/uploads/groups-file-access/MANUALE-ANIT-Isolanti-riflettenti.pdf).

Inverted-roof rain ΔU = p × fx × (Rabove-membrane/Rtotal)². Inputs require
heating-season rainfall, drainage factor, moisture-adjusted design conductivity
evidence and confirmation that ballast is excluded. This homogeneous upward-roof
subset follows [BBA Information 4](https://www.bbacerts.co.uk/files/2022/06/17-06-74-Datasheet_Bulletin_No4i7.pdf).
Ponding, moisture uptake and taper-dependent correction integration are outside it.

## Ground floors and basements

B = 2A/P and dt = wall thickness + λsoil(Rsi + Rfloor + Rse). The slab uses
the logarithmic expression when dt < B, otherwise λsoil/(0.457B + dt).
The [Irish TGD L 2022 Example A4](https://assets.gov.ie/static/documents/technical-guidance-document-l-conservation-of-fuel-and-energy-dwellings-2022.pdf)
returns 0.15078585, matching published 0.15. Two independent CIBSE slab examples
and a suspended-floor reference adjustment are checked as well.

Full-perimeter edge insulation uses the published logarithmic Ψ reduction and
displaced-soil resistance. Horizontal and vertical alternatives are assessed
separately; the strongest applicable alternative is selected, not summed.
Explicit applicability confirmations are required. Partial perimeter coverage,
large extents and separate junction effects need further assessment.

Suspended U combines the deck resistance with parallel ground, underfloor-wall
and natural ventilation paths. Insulated bases and specified deep-void walls
are included. Separating deck surfaces and ground-path surfaces are distinct.
Tests use arithmetic fixtures, limiting behaviour, dimensional checks and a
published reference-adjustment example. A populated installed BuildDesk case
has not been compared.

Basement floor equivalent thickness includes half the basement depth. Basement
wall heat transfer uses coupled floor/wall equivalent thicknesses. Heated-basement
H adds floor and below-ground wall losses; reported U uses their combined area.
An unheated-basement balance includes basement floor/walls, above-ground envelope
and ventilation in series with the separating deck. Partly heated combination
is also available as a helper with explicit component areas and coefficients.

Sources: [BRE SAP 2012 Appendix S5.5](https://bregroup.com/documents/d/bre-group/sap-2012_9-92),
[CIBSE Guide A 2015, reprint 2016](https://s3.amazonaws.com/fonteva-customer-media/00D8E0000008w4FUAQ/Guide%20A%202015%20%28reprint%202016%29%20b.pdf),
published ISO 13370 editions and [French government Th-Bat guidance](https://rt-re-batiment.developpement-durable.gouv.fr/IMG/pdf/4-fascicule_parois_opaques_methodes.pdf).
Two below-ground wall cases match 0.395 and 0.375 in a
[published BuildDesk 3.4.5 report](https://docs.planning.org.uk/20220113/194/R4TFT9HFHRK00/wilf19vw7svc87lv.pdf).
This validates those published inputs, not the installed BuildDesk version's full behaviour.

All ground methods here are steady-state. Monthly/seasonal ground heat transfer,
embedded heating, flowing groundwater and mechanical underfloor ventilation
are excluded. The extended formulas use publicly available earlier-standard
methods; complete ISO 13370:2017 and applicable national-rule conformity still
require a full normative review.

## Pitched and tapered roofs

Ceiling-insulated roofs use natural, uninsulated roof-space R = 0.06/0.20/0.30
according to covering, plus external surface resistance. These are added to
each ceiling section path and the lower limit before recomputing the combined
result. Mechanical ventilation is excluded.

For rafter insulation above a flat ceiling, sloped material R and Rse multiply
cos(pitch), while flat ceiling R, its Rsi and roof void R = 0.16 remain unscaled.
The [SEAI DEAP June 2025 example](https://www.seai.ie/sites/default/files/publications/DEAP_Guidance_Document.pdf)
returns 0.18366591, matching displayed 0.18. Sloped ceilings use the ordinary
layered roof and its sloping area. Correction interactions in the flat-ceiling
rafter model are not yet implemented.

Tapered roofs integrate 1/R over planar triangular and one-axis rectangular
regions, then area-weight their U-values. The input base R excludes the tapered
insulation; supplied vertex/edge thicknesses are total insulation thicknesses.
Stable limiting expressions handle nearly constant thickness. Tests compare
with independent numerical area integration and a supplied-R example in
[CSTB's certification annex](https://www.cstb.fr/pdf/atec/GS05-F/AF2182595_V1.pdf).
That annex has inconsistent physical thickness/units in its table, so the check
explicitly uses its supplied resistance values. Curved/bilinear thickness fields,
metal bridges and local taper-dependent rain/fastener corrections are excluded.

Roof interruptions use actual local U and area with explicit nonoverlap, or
BR443's exact 0/25/50 mm hatch allowances at λ = 0.040 and removed-insulation
light allowance f(2 − Uroof). These area effects are always included. Combining
both representations rejects to prevent double counting.

## Unheated spaces and separately assessed bridges

A single unheated-space balance uses b = He/(Hi + He), with explicit aggregate
inside-to-space and space-to-outside heat-loss coefficients. Supplied gains,
ground coupling and coupled unheated nodes are not supported. The
[CYPE ISO 13789 report](https://info.cype.com/wp-content/uploads/2026/04/es-cypecad-mep-listados-factor-de-reduccion-b.pdf)
provides Hi = 8.16, He = 3.05 and rounded b = 0.27 for validation.

The restricted alternative adds Ru = Ai/[Σ(Ae Ue) + 0.33nV] to a construction
with the appropriate still-air cold-side surface. It requires an uninsulated
outer envelope and equal-U inner elements. Aggregate network H is reported
separately from the target component's H. No statutory ventilation default is guessed.

Supplied ΨL and χ×count terms divide by an explicit reference area and are added
after local roof adjustments. Inputs require evidence and confirmation that
the bridge was not already included. The engine does not calculate 3D χ values.

## Numerical 2D model

The original solver uses finite-volume conduction on a rectangular mesh with
harmonic face conductances and isotropic, constant conductivity. It accepts
temperature/surface resistance, adiabatic and paired periodic boundaries.
Rectangle geometry generates cuts at exact material boundaries. It checks
algebraic convergence, heat balance and at least one spatial refinement;
default allowed U change is 0.5% (at most 1%). Nonconvergence returns an error.

Tests reconstruct two publicly documented ISO 10211:2007 benchmark geometries
from [Buildingphysics' validation report](https://buildingphysics.com/download/iso/ISO_10211_HEAT2_HEAT3.pdf)
and [published fixtures](https://buildingphysics.com/download/iso/HEAT2_7_files_iso10211.zip):

- Case 1: all 28 reference temperatures within 0.1°C.
- Case 2: calculated heat flow approximately 9.4903 W/m against 9.5 W/m;
  all nine reference temperatures within 0.1°C.
- Homogeneous series resistance, parallel conduction, periodic boundaries,
  temperature-shift invariance and unsupported/nonconvergent cases also checked.

These checks support the implemented 2D conduction subset. They are not full
qualification against [ISO 10211:2017](https://www.iso.org/standard/65710.html).
The app does not implement 3D conduction, internal heat sources, anisotropy,
airflow or cavity radiation. The steel example uses explicit metal geometry;
it does not claim the proprietary Digest 465/BuildDesk light-steel method.

## Verification boundary

The automated suite contains 84 tests. The offline engine bundle returns the same
U-values as the source engine for all 14 examples. Browser checks cover examples,
editing, saved data, custom materials, switching methods and report preview.
Tests ran against the compiled file over a local HTTP preview because automated
browser navigation to `file://` is blocked. OS print/PDF and direct file launch
remain manual checks. The app source and complete example results are included.

Native routine findings are in [builddesk-findings.md](builddesk-findings.md).
Remaining reconstruction gaps include exact UK dispatch and native rounding,
full correction/exemption selection, the proprietary material catalogue and
matched populated Elmhurst/installed-BuildDesk calculations. The current app
rejects known unsupported combinations, but a caller must still establish that
the physical construction and supplied data satisfy each method's conditions.
