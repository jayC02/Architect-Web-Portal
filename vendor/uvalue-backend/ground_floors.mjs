/**
 * Independent steady-state ground-floor U-value maths, with explicit SI inputs.
 *
 * Formula basis: BRE-hosted SAP 2012, Appendix S5.5 (ISO 13370 method).
 * The well-insulated slab equation is also reproduced in the Irish government
 * TGD L 2022, Example A4, explicitly citing ISO 13370:2017.
 * This implements a restricted method, not complete ISO 13370 certification.
 *
 * No proprietary or openFUVC source code is included. openFUVC was inspected
 * only as corroboration; the equations below were implemented independently
 * from published government descriptions.
 */

export const GROUND_FLOOR_SOURCES = Object.freeze({
  sap_2012_s5_5: 'https://bregroup.com/documents/d/bre-group/sap-2012_9-92',
  ireland_tgd_l_2022_a4: 'https://assets.gov.ie/static/documents/technical-guidance-document-l-conservation-of-fuel-and-energy-dwellings-2022.pdf',
  scotland_6c: 'https://www.gov.scot/publications/tables-of-u-values-and-thermal-conductivity/',
  cibse_guide_a_2015: 'https://s3.amazonaws.com/fonteva-customer-media/00D8E0000008w4FUAQ/Guide%20A%202015%20%28reprint%202016%29%20b.pdf',
  iso_13370_2017_scope: 'https://www.iso.org/obp/ui#iso:std:iso:13370:ed-3:v1:en',
});

const number = (value, label, allowZero = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return value;
};

const object = input => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Ground-floor input must be an object');
  }
};

const keys = (input, allowed) => {
  object(input);
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new RangeError(`Unsupported ground-floor input: ${key}`);
  }
};

const commonKeys = [
  'element', 'name', 'area_m2', 'exposed_perimeter_m', 'wall_thickness_m',
  'soil_conductivity_w_mk', 'rsi_m2k_w', 'rse_m2k_w', 'edge_insulation',
  'flowing_groundwater', 'embedded_heating',
];

function scope(input, expectedElement) {
  if (input.element !== undefined && input.element !== expectedElement) {
    throw new RangeError(`This method requires element ${expectedElement}`);
  }
  if (input.edge_insulation !== 'none') {
    throw new RangeError('Specify edge_insulation: "none"; edge insulation requires a separate method');
  }
  for (const key of ['flowing_groundwater', 'embedded_heating']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new TypeError(`${key} must be boolean`);
    }
    if (input[key]) throw new RangeError(`${key} is outside the supported ground-floor method`);
  }
}

/** A in m², exposed P in m; exclude walls adjoining similarly heated spaces. */
export function characteristicFloorDimension(area_m2, exposed_perimeter_m) {
  const b = 2 * number(area_m2, 'area_m2') / number(exposed_perimeter_m, 'exposed_perimeter_m');
  return number(b, 'characteristic floor dimension');
}

function geometry(input) {
  const area = number(input.area_m2, 'area_m2');
  const perimeter = number(input.exposed_perimeter_m, 'exposed_perimeter_m');
  return {
    area_m2: area,
    exposed_perimeter_m: perimeter,
    characteristic_dimension_m: characteristicFloorDimension(area, perimeter),
    perimeter_area_ratio_m_inv: perimeter / area,
    wall_thickness_m: number(input.wall_thickness_m, 'wall_thickness_m'),
    soil_conductivity_w_mk: number(input.soil_conductivity_w_mk, 'soil_conductivity_w_mk'),
    rsi_m2k_w: number(input.rsi_m2k_w, 'rsi_m2k_w', true),
    rse_m2k_w: number(input.rse_m2k_w, 'rse_m2k_w', true),
  };
}

function logarithmicGroundU(lambda, b, d) {
  // log1p is accurate where πB/d is small; all quantities use SI units.
  return 2 * lambda * Math.log1p(Math.PI * b / d) / (Math.PI * b + d);
}

function result(u, area, detail) {
  number(u, 'calculated u_value');
  const heatLoss = area === undefined ? undefined : number(u * area, 'heat loss coefficient');
  return {
    ...detail,
    u_value: u,
    u_value_5dp: Number(u.toFixed(5)),
    u_value_2dp: Number(u.toFixed(2)),
    ...(heatLoss === undefined ? {} : {heat_loss_coefficient_w_k: heatLoss}),
  };
}

/**
 * Slab directly on ground, uninsulated or with uniform all-over insulation.
 *
 * Required inputs: area_m2, exposed_perimeter_m, wall_thickness_m,
 * soil_conductivity_w_mk, floor_resistance_m2k_w (construction only, excluding
 * surfaces and ground), rsi_m2k_w, rse_m2k_w, edge_insulation:"none", and
 * basement_depth_m:0. Typical published downward Rsi/Rse are 0.17/0.04, but
 * callers must explicitly choose them rather than receiving hidden defaults.
 * Rf may be zero. Do not include hardcore resistance in Rf.
 *
 * dt = w + λg(Rsi + Rf + Rse), B = 2A/P.
 * dt < B: U = 2λg ln(1 + πB/dt) / (πB + dt).
 * dt >= B: U = λg / (0.457B + dt).
 */
export function calculateSlabOnGround(input) {
  keys(input, [...commonKeys, 'floor_resistance_m2k_w', 'basement_depth_m']);
  scope(input, 'slab_on_ground');
  if (number(input.basement_depth_m, 'basement_depth_m', true) !== 0) {
    throw new RangeError('Basement floors require a separate method; basement_depth_m must be 0');
  }
  const g = geometry(input);
  const rf = number(input.floor_resistance_m2k_w, 'floor_resistance_m2k_w', true);
  const d = number(g.wall_thickness_m + g.soil_conductivity_w_mk *
    (g.rsi_m2k_w + rf + g.rse_m2k_w), 'equivalent ground thickness');
  const branch = d < g.characteristic_dimension_m ? 'uninsulated_or_moderately_insulated' : 'well_insulated';
  const u = branch === 'well_insulated' ?
    g.soil_conductivity_w_mk / (0.457 * g.characteristic_dimension_m + d) :
    logarithmicGroundU(g.soil_conductivity_w_mk, g.characteristic_dimension_m, d);
  return result(u, g.area_m2, {
    element: 'slab_on_ground', method: 'iso_13370_steady_state_slab_subset',
    ...g, floor_resistance_m2k_w: rf, equivalent_ground_thickness_m: d, branch,
    warnings: ['Steady-state U only. Edge insulation, basements, flowing groundwater and embedded heating are outside this method. Wall/floor junction heat loss is separate.'],
  });
}

/**
 * Naturally ventilated suspended ground floor, uninsulated underfloor base at
 * external ground level. No mechanically ventilated or habitable basement.
 *
 * deck_u_value_w_m2k is Uf between the room and underfloor air, including both
 * downward surface resistances (normally 0.17 each) and repeating bridges.
 * Supply the deck engine's U; DO NOT supply an already ground-adjusted U.
 * rsi_m2k_w/rse_m2k_w here describe the ground path, not the deck surfaces.
 *
 * Extra required inputs: deck_u_value_w_m2k; floor_height_m (average upper
 * floor surface height above external ground); underfloor_wall_u_value_w_m2k;
 * ventilation_opening_area_per_perimeter_m2_m (e); annual_wind_speed_10m_m_s;
 * wind_shielding_factor (fw); ventilation:"natural"; base_depth_m:0;
 * base_insulation_resistance_m2k_w:0; edge_insulation:"none".
 *
 * dg = w + λg(Rsi + Rse).
 * Ug = 2λg ln(1 + πB/dg)/(πB + dg).
 * Ux = [2hUw + 1450 e v fw]/B.
 * U = 1/[1/Uf + 1/(Ug + Ux)].
 */
export function calculateSuspendedGroundFloor(input) {
  keys(input, [...commonKeys, 'deck_u_value_w_m2k', 'floor_height_m',
    'underfloor_wall_u_value_w_m2k', 'ventilation_opening_area_per_perimeter_m2_m',
    'annual_wind_speed_10m_m_s', 'wind_shielding_factor', 'ventilation',
    'base_depth_m', 'base_insulation_resistance_m2k_w']);
  scope(input, 'suspended_ground_floor');
  if (input.ventilation !== 'natural') {
    throw new RangeError('Only naturally ventilated underfloor spaces are supported');
  }
  if (number(input.base_depth_m, 'base_depth_m', true) !== 0) {
    throw new RangeError('Underfloor base must be at external ground level; below-ground voids require a separate method');
  }
  if (number(input.base_insulation_resistance_m2k_w, 'base_insulation_resistance_m2k_w', true) !== 0) {
    throw new RangeError('Insulated underfloor bases require a separate method');
  }
  const g = geometry(input);
  const uf = number(input.deck_u_value_w_m2k, 'deck_u_value_w_m2k');
  if (uf > 1 / 0.34 + 1e-12) {
    throw new RangeError('deck_u_value_w_m2k must include 0.17 m²K/W on each face of the deck');
  }
  const h = number(input.floor_height_m, 'floor_height_m', true);
  const uw = number(input.underfloor_wall_u_value_w_m2k, 'underfloor_wall_u_value_w_m2k', true);
  const e = number(input.ventilation_opening_area_per_perimeter_m2_m, 'ventilation_opening_area_per_perimeter_m2_m', true);
  const v = number(input.annual_wind_speed_10m_m_s, 'annual_wind_speed_10m_m_s', true);
  const fw = number(input.wind_shielding_factor, 'wind_shielding_factor', true);
  if (fw > 1) throw new RangeError('wind_shielding_factor must be between 0 and 1');
  const dg = number(g.wall_thickness_m + g.soil_conductivity_w_mk *
    (g.rsi_m2k_w + g.rse_m2k_w), 'equivalent ground thickness');
  // This subset uses the published uninsulated-base formula, not a slab formula
  // that incorporates the insulation resistance of the suspended deck.
  const ug = logarithmicGroundU(g.soil_conductivity_w_mk, g.characteristic_dimension_m, dg);
  const wallPath = 2 * h * uw / g.characteristic_dimension_m;
  const ventilationPath = 1450 * e * v * fw / g.characteristic_dimension_m;
  const ux = number(wallPath + ventilationPath, 'underfloor wall/ventilation U', true);
  const resistance = 1 / uf + 1 / number(ug + ux, 'ground/underfloor U');
  return result(1 / resistance, g.area_m2, {
    element: 'suspended_ground_floor', method: 'iso_13370_steady_state_natural_suspended_subset',
    ...g, deck_u_value_w_m2k: uf, deck_surface_resistance_each_m2k_w: .17, floor_height_m: h,
    underfloor_wall_u_value_w_m2k: uw,
    ventilation_opening_area_per_perimeter_m2_m: e,
    annual_wind_speed_10m_m_s: v, wind_shielding_factor: fw,
    equivalent_ground_thickness_m: dg, ground_u_value_w_m2k: ug,
    underfloor_wall_path_u_value_w_m2k: wallPath,
    ventilation_path_u_value_w_m2k: ventilationPath,
    underfloor_external_u_value_w_m2k: ux,
    total_equivalent_resistance_m2k_w: resistance,
    warnings: ['Steady-state U only, with a naturally ventilated void and uninsulated base at ground level. Junction heat loss and seasonal heat-flow calculations are separate.'],
  });
}

/**
 * Published-reference route, Scottish guide 6.C.3 / CIBSE Guide A Eq. 3.32.
 * Use only where a reference U0 applies to the same soil, geometry, ground,
 * ventilation and wall conditions. Both deck resistances exclude surfaces;
 * surface conventions must be the same. This helper does not verify U0's scope.
 * U = 1/[1/U0 - Rf0 + Rf]. (The guides' uninsulated deck Rf0 is 0.2.)
 */
export function calculateSuspendedFloorFromReference(input) {
  keys(input, ['reference_u_value_w_m2k', 'reference_deck_resistance_m2k_w', 'deck_resistance_m2k_w']);
  const u0 = number(input.reference_u_value_w_m2k, 'reference_u_value_w_m2k');
  const rf0 = number(input.reference_deck_resistance_m2k_w, 'reference_deck_resistance_m2k_w', true);
  const rf = number(input.deck_resistance_m2k_w, 'deck_resistance_m2k_w', true);
  const residual = 1 / u0 - rf0;
  number(residual, 'resistance remaining after removing reference deck');
  return result(1 / (residual + rf), undefined, {
    element: 'suspended_ground_floor', method: 'published_suspended_floor_reference_adjustment',
    ...input,
    warnings: ['Reference U0 applicability must be established separately; this adjustment changes only the floor-deck resistance.'],
  });
}
