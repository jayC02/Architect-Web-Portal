import { emptyCalculation, emptyMethodDraft } from '../../src/lib/u-value/draft';
import { additionalMethods, type AdditionalMethod } from '../../src/lib/u-value/methods';

const g = { area_m2: 80, exposed_perimeter_m: 36, wall_thickness_m: .3, soil_conductivity_w_mk: 2, rsi_m2k_w: .17, rse_m2k_w: .04 };
const wall = { wall_resistance_m2k_w: 80 / 1000 / .03 + .2 / 2, wall_rsi_m2k_w: .13, wall_rse_m2k_w: .04 };
const basement = { ...g, basement_depth_m: 2, floor_resistance_m2k_w: 4, ...wall };
export const examples: Record<AdditionalMethod, Record<string, number | string>> = {
  edge_insulated_slab: { ...g, floor_resistance_m2k_w: 80 / 1000 / .03, orientation: 'vertical', extent_m: .6, thickness_m: .08, resistance_m2k_w: 80 / 1000 / .03 },
  inverted_roof: { above_r: 4, below_r: .86, rainfall_mm_per_day: 3, fx_w_day_m2k_mm: .04, rainfall_evidence: 'Site heating-season weather data', drainage_evidence: 'Assessed system drainage factor', design_conductivity_evidence: 'Moisture-adjusted product data' },
  unheated_space: { u: .4, hi: 8.16, he: 3.05 },
  suspended_ground_floor: { ...g, deck_u_value_w_m2k: .3, floor_height_m: .3, underfloor_wall_u_value_w_m2k: 1.5, ventilation_opening_area_per_perimeter_m2_m: .003, annual_wind_speed_10m_m_s: 5, wind_shielding_factor: .05, base_depth_m: 0, base_insulation_resistance_m2k_w: 0 },
  basement_floor: { ...g, basement_depth_m: 2, floor_resistance_m2k_w: 4 },
  basement_wall: Object.fromEntries(Object.entries(basement).filter(([key]) => key !== 'area_m2')),
  heated_basement: basement,
  unheated_basement: { ...basement, deck_u_value_w_m2k: .3, above_ground_wall_height_m: .4, above_ground_wall_u_value_w_m2k: 1.5, air_changes_per_hour: .5, basement_air_volume_m3: 192 },
  ceiling_insulated_roof: { ceiling_r: 5, roof_covering: 'sheeted_or_tiles_with_underlay' },
  rafter_roof_flat_ceiling: { rafter_r: 5, ceiling_r: .05, pitch_degrees: 30 },
  tapered_roof: { base_resistance_m2k_w: .34, conductivity_w_mk: .025 },
  window: { total_area_m2: 2 }, door: { total_area_m2: 2 }, supplied_u: { u_value_w_m2k: .25 },
};
export function methodExample(method: AdditionalMethod) {
  const draft = { ...emptyCalculation(), title: additionalMethods[method].label, element: method, correctionsAssessed: true, methodData: emptyMethodDraft(method) };
  draft.methodData.values = Object.fromEntries(Object.entries(examples[method]).map(([k, v]) => [k, String(v)]));
  draft.methodData.source = 'Test construction assessment: geometry, build-up, design values and applicability verified.';
  draft.methodData.applicabilityConfirmed = true;
  if (method === 'window' || method === 'door') {
    draft.methodData.components = [{ name: 'Frame', kind: 'frame', area: '.3', u: '1.5', source: 'Assessed frame geometry and value' }, { name: 'Infill', kind: method === 'window' ? 'glazing' : 'panel', area: '1.7', u: '1.1', source: 'Assessed infill design value' }];
    draft.methodData.edges = [{ name: 'Infill perimeter', length: '5.4', psi: '.04', source: 'Assessed compatible edge value' }];
  }
  if (method === 'tapered_roof') draft.methodData.regions = [{ name: 'One-way fall', shape: 'rectangle', area: '60', thickness1: '80', thickness2: '160', thickness3: '' }, { name: 'Triangle', shape: 'triangle', area: '40', thickness1: '80', thickness2: '120', thickness3: '160' }];
  return draft;
}
