/**
 * Independent SI ground methods: perimeter insulation, basements and crawlspaces.
 * Equations are from published ISO 13370:2007 sections 9.2–9.5, CIBSE Guide A
 * and French government Th-Bat guidance. Current ISO 13370:2017 conformity and
 * national conventions still require review. No proprietary source is included.
 */
import {calculateSlabOnGround, characteristicFloorDimension} from './ground_floors.mjs';

export const GROUND_EXTENSION_SOURCES = Object.freeze({
  iso_13370_2007: 'https://standards.iteh.ai/catalog/standards/iso/61c7dae0-c1a6-4fb0-8e27-a4ee225d757c/iso-13370-2007',
  iso_13370_1998_edge: 'https://standards.iteh.ai/catalog/standards/iso/120de0aa-ee34-458c-b934-c702515b18a7/iso-13370-1998',
  iso_13370_2017_preview: 'https://cdn.standards.iteh.ai/samples/65716/0fc4017ab7f449d0bfd649e4b4b2f1fe/ISO-13370-2017.pdf',
  cibse_guide_a: 'https://s3.amazonaws.com/fonteva-customer-media/00D8E0000008w4FUAQ/Guide%20A%202015%20%28reprint%202016%29%20b.pdf',
  french_government_th_bat: 'https://rt-re-batiment.developpement-durable.gouv.fr/IMG/pdf/4-fascicule_parois_opaques_methodes.pdf',
  builddesk_published_example: 'https://docs.planning.org.uk/20220113/194/R4TFT9HFHRK00/wilf19vw7svc87lv.pdf',
});

function numeric(value, key, zero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (zero ? value < 0 : value <= 0)) {
    throw new RangeError(`${key} must be a finite ${zero ? 'non-negative' : 'positive'} number`);
  }
  return value;
}

function checkKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Ground input must be an object');
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new RangeError(`Unsupported ground input: ${key}`);
  }
}

const COMMON = ['element', 'name', 'area_m2', 'exposed_perimeter_m', 'wall_thickness_m',
  'soil_conductivity_w_mk', 'rsi_m2k_w', 'rse_m2k_w', 'edge_insulation',
  'flowing_groundwater', 'embedded_heating'];
const BASEMENT = [...COMMON, 'basement_depth_m', 'floor_resistance_m2k_w',
  'wall_resistance_m2k_w', 'wall_rsi_m2k_w', 'wall_rse_m2k_w'];
const WARNINGS = ['Steady-state ground heat transfer only. Seasonal heat flows, embedded heating and flowing groundwater are outside this method.',
  'Wall/floor junction thermal bridging is separate; current standard and national conventions require review.'];

function scope(input, elements, edge = false) {
  if (input.element !== undefined && !elements.includes(input.element)) {
    throw new RangeError(`This method requires element ${elements.join(' or ')}`);
  }
  if (!edge && input.edge_insulation !== 'none') throw new RangeError('Specify edge_insulation: "none" for this method');
  for (const key of ['flowing_groundwater', 'embedded_heating']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
    if (input[key]) throw new RangeError(`${key} is outside the supported method`);
  }
}

function geometry(input) {
  return {
    area_m2: numeric(input.area_m2, 'area_m2'),
    exposed_perimeter_m: numeric(input.exposed_perimeter_m, 'exposed_perimeter_m'),
    characteristic_dimension_m: characteristicFloorDimension(input.area_m2, input.exposed_perimeter_m),
    wall_thickness_m: numeric(input.wall_thickness_m, 'wall_thickness_m'),
    soil_conductivity_w_mk: numeric(input.soil_conductivity_w_mk, 'soil_conductivity_w_mk'),
    rsi_m2k_w: numeric(input.rsi_m2k_w, 'rsi_m2k_w', true),
    rse_m2k_w: numeric(input.rse_m2k_w, 'rse_m2k_w', true),
  };
}

function rounded(u, detail, area) {
  numeric(u, 'calculated u_value');
  return {...detail, u_value: u, u_value_5dp: Number(u.toFixed(5)), u_value_2dp: Number(u.toFixed(2)),
    ...(area === undefined ? {} : {heat_loss_coefficient_w_k: numeric(area * u, 'heat loss coefficient')})};
}

function logGroundU(lambda, b, d) {
  return 2 * lambda * Math.log1p(Math.PI * b / d) / (Math.PI * b + d);
}

function floorTerms(input) {
  const g = geometry(input);
  const z = numeric(input.basement_depth_m, 'basement_depth_m', true);
  const rf = numeric(input.floor_resistance_m2k_w, 'floor_resistance_m2k_w', true);
  const dt = numeric(g.wall_thickness_m + g.soil_conductivity_w_mk * (g.rsi_m2k_w + rf + g.rse_m2k_w), 'equivalent floor thickness');
  const adjusted = numeric(dt + .5 * z, 'depth-adjusted floor thickness');
  const wellInsulated = adjusted >= g.characteristic_dimension_m;
  const u = wellInsulated ? g.soil_conductivity_w_mk / (.457 * g.characteristic_dimension_m + adjusted) :
    logGroundU(g.soil_conductivity_w_mk, g.characteristic_dimension_m, adjusted);
  numeric(u, 'basement floor U');
  return {...g, basement_depth_m: z, floor_resistance_m2k_w: rf,
    equivalent_ground_thickness_m: dt, depth_adjusted_ground_thickness_m: adjusted,
    branch: wellInsulated ? 'well_insulated' : 'uninsulated_or_moderately_insulated',
    basement_floor_u_value_w_m2k: u};
}

function wallTerms(input) {
  const lambda = numeric(input.soil_conductivity_w_mk, 'soil_conductivity_w_mk');
  const w = numeric(input.wall_thickness_m, 'wall_thickness_m');
  const rf = numeric(input.floor_resistance_m2k_w, 'floor_resistance_m2k_w', true);
  const rw = numeric(input.wall_resistance_m2k_w, 'wall_resistance_m2k_w', true);
  const rsi = numeric(input.rsi_m2k_w, 'rsi_m2k_w', true);
  const rse = numeric(input.rse_m2k_w, 'rse_m2k_w', true);
  const wrsi = numeric(input.wall_rsi_m2k_w, 'wall_rsi_m2k_w', true);
  const wrse = numeric(input.wall_rse_m2k_w, 'wall_rse_m2k_w', true);
  const z = numeric(input.basement_depth_m, 'basement_depth_m');
  const dt = numeric(w + lambda * (rsi + rf + rse), 'equivalent floor thickness');
  const dw = numeric(lambda * (wrsi + rw + wrse), 'equivalent wall thickness');
  // ISO 13370 explicitly substitutes dw for dt in this wall factor when dw<dt.
  const couplingD = Math.min(dt, dw);
  const u = 2 * lambda / Math.PI * (1 + .5 * couplingD / (couplingD + z)) * Math.log1p(z / dw) / z;
  numeric(u, 'basement wall U');
  return {soil_conductivity_w_mk: lambda, wall_thickness_m: w,
    floor_resistance_m2k_w: rf, wall_resistance_m2k_w: rw, rsi_m2k_w: rsi, rse_m2k_w: rse,
    wall_rsi_m2k_w: wrsi, wall_rse_m2k_w: wrse, basement_depth_m: z,
    equivalent_ground_thickness_m: dt, equivalent_wall_thickness_m: dw,
    wall_coupling_thickness_m: couplingD, wall_formula_uses_wall_thickness_instead_of_floor: dw < dt,
    basement_wall_u_value_w_m2k: u};
}

/**
 * One full-perimeter edge detail. R is insulation/foundation R, excluding soil.
 * extent_m is horizontal width or vertical depth; thickness_m is through-flow
 * thickness. Ri'=R-d/λg. ΔΨ=-λg/π[ln(1+kD/dt)-ln(1+kD/(dt+λgRi'))],
 * with k=1 horizontal, k=2 vertical. Output is W/(m·K), usually negative.
 */
export function calculateEdgeInsulationCorrection(input) {
  checkKeys(input, ['soil_conductivity_w_mk', 'equivalent_ground_thickness_m', 'orientation',
    'extent_m', 'thickness_m', 'resistance_m2k_w']);
  const lambda = numeric(input.soil_conductivity_w_mk, 'soil_conductivity_w_mk');
  const dt = numeric(input.equivalent_ground_thickness_m, 'equivalent_ground_thickness_m');
  if (!['horizontal', 'vertical'].includes(input.orientation)) throw new RangeError('orientation must be horizontal or vertical');
  const extent = numeric(input.extent_m, 'extent_m');
  const thickness = numeric(input.thickness_m, 'thickness_m');
  const r = numeric(input.resistance_m2k_w, 'resistance_m2k_w');
  const ri = r - thickness / lambda;
  if (ri < 0) throw new RangeError('Edge insulation resistance must not be less than the resistance of the replaced soil');
  const additional = numeric(lambda * ri, 'additional equivalent thickness', true);
  const distance = extent * (input.orientation === 'vertical' ? 2 : 1);
  // Algebraically the difference of the two source logarithms, avoiding
  // cancellation for a small additional resistance.
  const difference = Math.log1p(distance / dt * additional / (dt + additional + distance));
  const delta = -lambda / Math.PI * difference;
  if (!Number.isFinite(delta)) throw new RangeError('Edge correction must be finite');
  return {...input, additional_resistance_m2k_w: ri,
    additional_equivalent_thickness_m: additional, edge_correction_w_mk: delta};
}

/** Uniform slab plus alternative full-perimeter edge details; choose strongest. */
export function calculateSlabWithEdgeInsulation(input) {
  checkKeys(input, [...COMMON, 'floor_resistance_m2k_w', 'basement_depth_m',
    'edge_insulation_small_extent', 'edge_junction_thermal_bridge_free']);
  scope(input, ['slab_on_ground', 'slab_with_edge_insulation'], true);
  if (input.edge_insulation_small_extent !== true) throw new RangeError('Confirm edge_insulation_small_extent: true; the analytical edge method assumes a narrow edge detail');
  if (input.edge_junction_thermal_bridge_free !== true) throw new RangeError('Confirm edge_junction_thermal_bridge_free: true; significant junction bridges need numerical analysis');
  if (!Array.isArray(input.edge_insulation) || !input.edge_insulation.length || input.edge_insulation.length > 16) {
    throw new RangeError('edge_insulation must contain 1 to 16 alternative full-perimeter details');
  }
  const {edge_insulation, edge_insulation_small_extent, edge_junction_thermal_bridge_free, ...baseInput} = input;
  const base = calculateSlabOnGround({...baseInput, element: 'slab_on_ground', edge_insulation: 'none'});
  const details = edge_insulation.map(edge => {
    checkKeys(edge, ['orientation', 'extent_m', 'thickness_m', 'resistance_m2k_w']);
    return calculateEdgeInsulationCorrection({...edge, soil_conductivity_w_mk: base.soil_conductivity_w_mk,
      equivalent_ground_thickness_m: base.equivalent_ground_thickness_m});
  });
  const selected = details.reduce((best, item, index) => item.edge_correction_w_mk < details[best].edge_correction_w_mk ? index : best, 0);
  const delta = details[selected].edge_correction_w_mk * base.exposed_perimeter_m / base.area_m2;
  const u = base.u_value + delta;
  if (u <= 0) throw new RangeError('Edge dimensions are outside the analytical method: correction would make U non-positive');
  return rounded(u, {...base, element: 'slab_on_ground', method: 'iso_13370_steady_state_slab_edge_insulation',
    uncorrected_u_value: base.u_value, edge_insulation: details, selected_edge_detail_index: selected,
    edge_correction_w_m2k: delta, warnings: [...WARNINGS,
      'Each candidate represents the full perimeter. The greatest reduction is used; alternatives are not added.',
      'This analytical edge correction assumes narrow insulation and no significant thermal bridge in the detail.']}, base.area_m2);
}

/** Basement floor only; Rf excludes surfaces, ground and hardcore. z may be 0. */
export function calculateBasementFloor(input) {
  checkKeys(input, [...COMMON, 'floor_resistance_m2k_w', 'basement_depth_m']);
  scope(input, ['basement_floor', 'heated_basement_floor']);
  const terms = floorTerms(input);
  return rounded(terms.basement_floor_u_value_w_m2k, {...terms, element: 'basement_floor',
    method: 'iso_13370_steady_state_basement_floor', warnings: [...WARNINGS]}, terms.area_m2);
}

/** Below-ground basement wall only; separate floor/wall surface conventions. */
export function calculateBasementWall(input) {
  checkKeys(input, BASEMENT.filter(key => key !== 'area_m2'));
  scope(input, ['basement_wall', 'heated_basement_wall']);
  const terms = wallTerms(input);
  let area;
  if (input.exposed_perimeter_m !== undefined) area = numeric(input.exposed_perimeter_m, 'exposed_perimeter_m') * terms.basement_depth_m;
  return rounded(terms.basement_wall_u_value_w_m2k, {...terms,
    ...(area === undefined ? {} : {below_ground_wall_area_m2: area}), element: 'basement_wall',
    method: 'iso_13370_steady_state_basement_wall', warnings: [...WARNINGS,
      'The wall and floor ground paths are coupled. Wall U is an approximation to its contribution to whole-basement heat transfer.']}, area);
}

function basementTerms(input) {
  const floor = floorTerms(input);
  const wall = wallTerms(input);
  const wallArea = floor.basement_depth_m * floor.exposed_perimeter_m;
  const floorH = floor.area_m2 * floor.basement_floor_u_value_w_m2k;
  const wallH = wallArea * wall.basement_wall_u_value_w_m2k;
  const totalH = numeric(floorH + wallH, 'basement ground heat loss');
  return {...floor, ...wall, below_ground_wall_area_m2: wallArea,
    total_ground_contact_area_m2: floor.area_m2 + wallArea,
    basement_floor_heat_loss_coefficient_w_k: floorH,
    basement_wall_heat_loss_coefficient_w_k: wallH,
    basement_ground_heat_loss_coefficient_w_k: totalH};
}

/** Whole heated basement. u_value is averaged over A+zP, not floor area alone. */
export function calculateHeatedBasement(input) {
  checkKeys(input, BASEMENT);
  scope(input, ['heated_basement']);
  const terms = basementTerms(input);
  return rounded(terms.basement_ground_heat_loss_coefficient_w_k / terms.total_ground_contact_area_m2,
    {...terms, element: 'heated_basement', method: 'iso_13370_steady_state_heated_basement',
      floor_area_normalised_u_value_w_m2k: terms.basement_ground_heat_loss_coefficient_w_k / terms.area_m2,
      u_value_reference_area: 'floor_plus_below_ground_walls', warnings: [...WARNINGS,
        'The reported U averages the floor and below-ground wall area. Above-ground walls are assessed separately.']},
    terms.total_ground_contact_area_m2);
}

function deckU(value) {
  const uf = numeric(value, 'deck_u_value_w_m2k');
  if (uf > 1 / .34 + 1e-12) throw new RangeError('deck_u_value_w_m2k must include 0.17 m²K/W on each face of the deck');
  return uf;
}

/**
 * External-air-ventilated, unheated basement. Hext=A Ubf+zP Ubw+hP Uw+.33 nV;
 * U=1/(1/Uf+A/Hext), referenced to the floor separating room and basement.
 * Deck Uf includes both downward surface resistances and repeating bridges.
 * Basement floor resistance is distinct from the resistance of that deck.
 */
export function calculateUnheatedBasement(input) {
  checkKeys(input, [...BASEMENT, 'deck_u_value_w_m2k', 'above_ground_wall_height_m',
    'above_ground_wall_u_value_w_m2k', 'ventilation', 'air_changes_per_hour', 'basement_air_volume_m3']);
  scope(input, ['unheated_basement']);
  if (input.ventilation !== 'external_air') throw new RangeError('Unheated basement ventilation must be external_air');
  const terms = basementTerms(input);
  const uf = deckU(input.deck_u_value_w_m2k);
  const h = numeric(input.above_ground_wall_height_m, 'above_ground_wall_height_m', true);
  const uw = numeric(input.above_ground_wall_u_value_w_m2k, 'above_ground_wall_u_value_w_m2k', true);
  const n = numeric(input.air_changes_per_hour, 'air_changes_per_hour', true);
  const volume = numeric(input.basement_air_volume_m3, 'basement_air_volume_m3');
  const wallH = numeric(h * terms.exposed_perimeter_m * uw, 'above-ground wall heat loss', true);
  const ventH = numeric(.33 * n * volume, 'ventilation heat loss', true);
  const externalH = numeric(terms.basement_ground_heat_loss_coefficient_w_k + wallH + ventH, 'basement external heat loss');
  const u = 1 / (1 / uf + terms.area_m2 / externalH);
  return rounded(u, {...terms, element: 'unheated_basement', method: 'iso_13370_steady_state_unheated_basement',
    deck_u_value_w_m2k: uf, deck_surface_resistance_each_m2k_w: .17,
    above_ground_wall_height_m: h, above_ground_wall_u_value_w_m2k: uw,
    air_changes_per_hour: n, basement_air_volume_m3: volume,
    above_ground_wall_heat_loss_coefficient_w_k: wallH, ventilation_heat_loss_coefficient_w_k: ventH,
    basement_external_heat_loss_coefficient_w_k: externalH, temperature_reduction_factor: u / uf,
    u_value_reference_area: 'separating_floor', warnings: [...WARNINGS,
      'The basement receives no active heating or internal/solar gains, and its ventilation air comes from outside.']}, terms.area_m2);
}

/**
 * Natural suspended floor including insulation on the ground and deep voids.
 * z<=0.5 m uses the unmodified ground logarithm; z>0.5 m uses Ubf+zP Ubw/A.
 * The floor_height_m input remains height of the upper deck surface above
 * exterior ground. No edge insulation or non-exterior supply air is supported.
 */
export function calculateSuspendedGroundFloorExtended(input) {
  checkKeys(input, [...COMMON, 'deck_u_value_w_m2k', 'floor_height_m',
    'underfloor_wall_u_value_w_m2k', 'ventilation_opening_area_per_perimeter_m2_m',
    'annual_wind_speed_10m_m_s', 'wind_shielding_factor', 'ventilation',
    'base_depth_m', 'base_insulation_resistance_m2k_w', 'below_ground_wall_resistance_m2k_w',
    'wall_rsi_m2k_w', 'wall_rse_m2k_w']);
  scope(input, ['suspended_ground_floor']);
  if (input.ventilation !== 'natural') throw new RangeError('Only natural external-air ventilation is supported by this method');
  const g = geometry(input);
  const uf = deckU(input.deck_u_value_w_m2k);
  const z = numeric(input.base_depth_m, 'base_depth_m', true);
  const rg = numeric(input.base_insulation_resistance_m2k_w, 'base_insulation_resistance_m2k_w', true);
  const dg = numeric(g.wall_thickness_m + g.soil_conductivity_w_mk * (g.rsi_m2k_w + rg + g.rse_m2k_w), 'equivalent base thickness');
  let ug = logGroundU(g.soil_conductivity_w_mk, g.characteristic_dimension_m, dg);
  let deep = {};
  if (z > .5) {
    const terms = basementTerms({...g, basement_depth_m: z, floor_resistance_m2k_w: rg,
      wall_resistance_m2k_w: input.below_ground_wall_resistance_m2k_w,
      wall_rsi_m2k_w: input.wall_rsi_m2k_w, wall_rse_m2k_w: input.wall_rse_m2k_w});
    ug = terms.basement_ground_heat_loss_coefficient_w_k / g.area_m2;
    deep = {basement_floor_u_value_w_m2k: terms.basement_floor_u_value_w_m2k,
      basement_wall_u_value_w_m2k: terms.basement_wall_u_value_w_m2k,
      below_ground_wall_area_m2: terms.below_ground_wall_area_m2,
      equivalent_wall_thickness_m: terms.equivalent_wall_thickness_m};
  } else if (['below_ground_wall_resistance_m2k_w', 'wall_rsi_m2k_w', 'wall_rse_m2k_w'].some(key => input[key] !== undefined)) {
    throw new RangeError('Below-ground wall inputs apply only when base_depth_m exceeds 0.5 m');
  }
  const h = numeric(input.floor_height_m, 'floor_height_m', true);
  const uw = numeric(input.underfloor_wall_u_value_w_m2k, 'underfloor_wall_u_value_w_m2k', true);
  const e = numeric(input.ventilation_opening_area_per_perimeter_m2_m, 'ventilation_opening_area_per_perimeter_m2_m', true);
  const v = numeric(input.annual_wind_speed_10m_m_s, 'annual_wind_speed_10m_m_s', true);
  const fw = numeric(input.wind_shielding_factor, 'wind_shielding_factor', true);
  if (fw > 1) throw new RangeError('wind_shielding_factor must be between 0 and 1');
  const wallPath = numeric(2 * h * uw / g.characteristic_dimension_m, 'wall path', true);
  const ventilationPath = numeric(1450 * e * v * fw / g.characteristic_dimension_m, 'ventilation path', true);
  const ux = numeric(wallPath + ventilationPath, 'underfloor external U', true);
  const u = 1 / (1 / uf + 1 / numeric(ug + ux, 'underfloor total U'));
  return rounded(u, {...g, ...deep, element: 'suspended_ground_floor',
    method: 'iso_13370_steady_state_natural_suspended_extended',
    deck_u_value_w_m2k: uf, deck_surface_resistance_each_m2k_w: .17, base_depth_m: z,
    base_insulation_resistance_m2k_w: rg, floor_height_m: h,
    underfloor_wall_u_value_w_m2k: uw, ventilation_opening_area_per_perimeter_m2_m: e,
    annual_wind_speed_10m_m_s: v, wind_shielding_factor: fw,
    equivalent_ground_thickness_m: dg, ground_u_value_w_m2k: ug,
    ground_path_method: z > .5 ? 'deep_void_floor_and_walls' : 'shallow_void_ground_logarithm',
    underfloor_wall_path_u_value_w_m2k: wallPath, ventilation_path_u_value_w_m2k: ventilationPath,
    underfloor_external_u_value_w_m2k: ux, total_equivalent_resistance_m2k_w: 1 / u,
    warnings: [...WARNINGS, 'The 0.5 m void-depth boundary selects different analytical ground approximations; values can change across this boundary.']}, g.area_m2);
}

/** Mix heat-loss coefficients, not differently area-normalised U-values. */
export function combinePartlyHeatedBasement(input) {
  checkKeys(input, ['heated_heat_loss_coefficient_w_k', 'unheated_heat_loss_coefficient_w_k', 'heated_ground_contact_fraction']);
  const heated = numeric(input.heated_heat_loss_coefficient_w_k, 'heated_heat_loss_coefficient_w_k');
  const unheated = numeric(input.unheated_heat_loss_coefficient_w_k, 'unheated_heat_loss_coefficient_w_k');
  const fraction = numeric(input.heated_ground_contact_fraction, 'heated_ground_contact_fraction', true);
  if (fraction > 1) throw new RangeError('heated_ground_contact_fraction must be between 0 and 1');
  return {method: 'iso_13370_partly_heated_basement_heat_loss_mixture',
    heat_loss_coefficient_w_k: heated * fraction + unheated * (1 - fraction), ...input,
    warnings: ['Both supplied heat-loss coefficients must represent the same whole-basement geometry and temperature difference.',
      'Weighting is by the proportion of basement ground-contact area that is heated.']};
}
