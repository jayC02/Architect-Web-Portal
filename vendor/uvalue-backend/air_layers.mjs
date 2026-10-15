/**
 * Independent air-layer helpers; no BuildDesk matching has been established.
 * R is m² K/W; h is W/(m² K); dimensions are millimetres.
 * Scope: large, plane, parallel, opaque cavities only, no indoor air exchange.
 * Air voids, glazing, crawl spaces, roof spaces and inclined convection models
 * require different procedures and are deliberately excluded.
 */
export const AIR_LAYER_REFERENCES = Object.freeze({
  table_and_ventilation: 'https://cdn.standards.iteh.ai/samples/40968/eef030b005bd4146b90cddaf78c64f06/ISO-6946-2007.pdf',
  uk_conventions_2019: 'https://www.cibse.org/media/wzrjrf3l/conventions-for-u-value-calculations.pdf',
  emissivity_equations_and_example: 'https://www.anit.it/wp-content/uploads/groups-file-access/MANUALE-ANIT-Isolanti-riflettenti.pdf',
  standard_2017: 'https://standards.iteh.ai/catalog/standards/iso/aaeda7a7-bc14-4d8d-9b4e-110600d5df6a/iso-6946-2017',
});

const directionIndex = Object.freeze({ up: 1, horizontal: 2, down: 3 });
// ISO 6946:2007 Table 2 (2017 Table 8): thickness, up, horizontal, down.
const table = Object.freeze([
  [0, 0, 0, 0], [5, .11, .11, .11], [7, .13, .13, .13],
  [10, .15, .15, .15], [15, .16, .17, .17], [25, .16, .18, .19],
  [50, .16, .18, .21], [100, .16, .18, .22], [300, .16, .18, .23],
]);
const stillAirResistance = Object.freeze({ up: .10, horizontal: .13, down: .17 });

function finite(x, label, allowZero = false) {
  if (typeof x !== 'number' || !Number.isFinite(x) || (allowZero ? x < 0 : x <= 0)) {
    throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return x;
}
function heatFlow(x) {
  if (!Object.hasOwn(directionIndex, x)) throw new RangeError('heat_flow must be up, horizontal or down');
  return x;
}
function emissivity(x, label) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < .02 || x > 1) {
    throw new RangeError(`${label} must be between 0.02 and 1`);
  }
  return x;
}
function geometry(input) {
  const d = finite(input.thickness_mm, 'thickness_mm');
  if (d > 300) throw new RangeError('Cavities thicker than 300 mm require an unheated-space heat balance');
  for (const key of ['width_mm', 'height_mm']) {
    if (finite(input[key], key) <= 10 * d) throw new RangeError(`${key} must exceed 10 times thickness_mm; small air voids require a separate method`);
  }
  if (input.parallel_faces === false) throw new RangeError('Non-parallel cavity faces require a separate method');
  if (input.internal_air_exchange === true) throw new RangeError('Air layers exchanging air with the indoor environment are unsupported');
  if (input.glazing === true) throw new RangeError('Glazing cavities require the glazing standards');
  if (input.mechanical_ventilation === true) throw new RangeError('Mechanical ventilation requires a separate heat-flow model');
  if (input.ventilation !== undefined && input.ventilation !== 'unventilated') {
    throw new RangeError('This resistance helper is for unventilated cavities; use airLayerVentilationPlan for external ventilation');
  }
  return d;
}

/**
 * method='table': high-emissivity design table, interpolated in thickness.
 * method='iso_6946_annex_d': R=1/(ha+hr), normal 10°C, ΔT≤5K only.
 * Required geometry asserts applicability; all physical assumptions above apply.
 * A reference is required for ε<0.2. Its certification status is not verified.
 */
export function unventilatedAirLayerResistance(input) {
  const dmm = geometry(input);
  const flow = heatFlow(input.heat_flow);
  const e1 = emissivity(input.emissivity_1 ?? .9, 'emissivity_1');
  const e2 = emissivity(input.emissivity_2 ?? .9, 'emissivity_2');
  const method = input.method ?? 'table';
  if ((input.mean_temperature_c ?? 10) !== 10) throw new RangeError('Only the normal-building mean cavity temperature of 10°C is supported');
  const deltaT = finite(input.temperature_difference_k ?? 5, 'temperature_difference_k');
  if (deltaT > 5) throw new RangeError('Temperature differences above 5 K need the separately validated ISO 6946 Table D.2 procedure');
  const warnings = [];
  let resistance, ha, hr, effectiveEmittance;
  if (method === 'table') {
    if (e1 < .8 || e2 < .8) throw new RangeError('The high-emissivity table needs both emissivities ≥0.8; choose iso_6946_annex_d');
    const idx = directionIndex[flow];
    const upper = table.findIndex(row => row[0] >= dmm);
    const lo = table[upper - 1], hi = table[upper];
    resistance = dmm === hi[0] ? hi[idx] :
      lo[idx] + (hi[idx] - lo[idx]) * (dmm - lo[0]) / (hi[0] - lo[0]);
  } else if (method === 'iso_6946_annex_d') {
    if ((e1 < .2 || e2 < .2) && (typeof input.emissivity_evidence !== 'string' || !input.emissivity_evidence.trim())) {
      throw new RangeError('Emissivity below 0.2 requires emissivity_evidence; UK conventions require accredited product certification');
    }
    const dm = dmm / 1000;
    const convection = { horizontal: 1.25, up: 1.95, down: .12 * dm ** -.44 }[flow];
    ha = Math.max(.025 / dm, convection);
    effectiveEmittance = 1 / (1 / e1 + 1 / e2 - 1);
    // ISO convention uses σ=5.67e-8, rather than substituting another constant.
    const blackbody = 4 * 5.67e-8 * 283.15 ** 3;
    hr = effectiveEmittance * blackbody;
    resistance = 1 / (ha + hr);
    if (e1 < .2 || e2 < .2) warnings.push('The supplied emissivity evidence has not been checked for accredited product certification.');
    if (e1 >= .8 && e2 >= .8) warnings.push('The analytical result differs slightly from the rounded high-emissivity design table.');
  } else throw new RangeError('method must be table or iso_6946_annex_d');
  return {
    resistance, resistance_unit: 'm2 K/W', method, heat_flow: flow,
    thickness_mm: dmm, width_mm: input.width_mm, height_mm: input.height_mm,
    emissivity_1: e1, emissivity_2: e2, mean_temperature_c: 10,
    temperature_difference_k: deltaT, ha, hr, effective_emittance: effectiveEmittance,
    emissivity_evidence: input.emissivity_evidence ?? null, warnings,
    references: method === 'table' ? [AIR_LAYER_REFERENCES.table_and_ventilation] :
      [AIR_LAYER_REFERENCES.emissivity_equations_and_example, AIR_LAYER_REFERENCES.uk_conventions_2019],
  };
}

/**
 * Outside-to-inside layer order. This creates a plan, never mutates layers.
 * Supply ONE opening-area field, matching orientation:
 * vertical: opening_area_mm2_per_m; horizontal: opening_area_mm2_per_m2.
 * For small nonzero openings, explicitly confirm no through-flow arrangement
 * and no insulation between the cavity and the outdoors (6946 exception).
 * For A>500 explicitly confirm openings_allow_through_flow=true.
 * These rules describe naturally externally ventilated opaque cavities only.
 */
export function airLayerVentilationPlan(input) {
  const flow = heatFlow(input.heat_flow);
  if (!['vertical', 'horizontal'].includes(input.orientation)) throw new RangeError('orientation must be vertical or horizontal; inclined cavities are unsupported');
  if ((input.orientation === 'vertical') !== (flow === 'horizontal')) throw new RangeError('orientation does not match heat_flow');
  const key = input.orientation === 'vertical' ? 'opening_area_mm2_per_m' : 'opening_area_mm2_per_m2';
  const otherKey = input.orientation === 'vertical' ? 'opening_area_mm2_per_m2' : 'opening_area_mm2_per_m';
  if (input[otherKey] !== undefined) throw new RangeError(`Use ${key} for this orientation; do not mix opening-area units`);
  const area = finite(input[key], key, true);
  if (!Number.isInteger(input.layer_count) || input.layer_count < 2) throw new RangeError('layer_count must be an integer ≥2');
  const index = input.cavity_layer_index;
  if (!Number.isInteger(index) || index < 0 || index >= input.layer_count - 1) throw new RangeError('cavity_layer_index must leave at least one layer toward indoors');
  if (input.mechanical_ventilation === true) throw new RangeError('Mechanical ventilation requires a separate heat-flow model');
  if (input.internal_air_exchange === true) throw new RangeError('Indoor air exchange is unsupported');
  const exposedEmissivity = emissivity(input.exposed_surface_emissivity ?? .9, 'exposed_surface_emissivity');
  if (exposedEmissivity < .8) throw new RangeError('Low-emissivity surfaces exposed to ventilated cavities need a validated Annex C still-air surface resistance');
  if (area > 0 && area <= 500) {
    if (input.openings_allow_through_flow !== false || input.insulation_between_cavity_and_exterior !== false) {
      throw new RangeError('Small openings need openings_allow_through_flow=false and insulation_between_cavity_and_exterior=false to apply the unventilated exception');
    }
  }
  if (area > 500 && input.openings_allow_through_flow !== true) throw new RangeError('Confirm openings_allow_through_flow=true for a ventilated cavity');
  const ventilation = area <= 500 ? 'unventilated' : area < 1500 ? 'slightly_ventilated' : 'well_ventilated';
  const weight = ventilation === 'unventilated' ? 0 : ventilation === 'well_ventilated' ? 1 : (area - 500) / 1000;
  return {
    ventilation, opening_area_value: area,
    opening_area_unit: input.orientation === 'vertical' ? 'mm2/m horizontal length' : 'mm2/m2 surface area',
    unventilated_weight: 1 - weight, well_ventilated_weight: weight,
    well_ventilated_external_surface_resistance: stillAirResistance[flow],
    well_ventilated_first_retained_layer_index: index + 1,
    disregard_layer_indices_for_well_ventilated: Array.from({ length: index + 1 }, (_, i) => i),
    retained_layer_indices_for_well_ventilated: Array.from({ length: input.layer_count - index - 1 }, (_, i) => index + 1 + i),
    instructions: ventilation === 'unventilated' ? ['Keep all layers and apply the unventilated cavity resistance.'] : [
      'Calculate the unventilated endpoint with all layers and normal surface resistances.',
      'Calculate the well-ventilated endpoint after dropping the cavity and all layers toward outdoors; replace exterior R with the still-air value given here.',
      'Blend the two total resistances using the supplied weights; take the reciprocal afterward. Do not blend cavity R values or endpoint U values.',
      'Remap correction layer indices for retained layers; exclude removed-layer corrections. Apply validated U corrections only after obtaining the blended base resistance.',
    ],
    references: [AIR_LAYER_REFERENCES.table_and_ventilation, AIR_LAYER_REFERENCES.uk_conventions_2019],
  };
}

/** ISO 6946 ventilation interpolation, using UNCORRECTED total endpoint R. */
export function interpolateVentilatedResistance({ unventilated_total_resistance, well_ventilated_total_resistance, well_ventilated_weight }) {
  const ru = finite(unventilated_total_resistance, 'unventilated_total_resistance');
  const rv = finite(well_ventilated_total_resistance, 'well_ventilated_total_resistance');
  const w = finite(well_ventilated_weight, 'well_ventilated_weight', true);
  if (w > 1) throw new RangeError('well_ventilated_weight must be between 0 and 1');
  return (1 - w) * ru + w * rv;
}
