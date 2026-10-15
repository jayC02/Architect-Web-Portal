import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSlabOnGround, calculateSuspendedGroundFloor,
  calculateSuspendedFloorFromReference, characteristicFloorDimension,
} from './ground_floors.mjs';

const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const slab = {
  area_m2: 8.75 * 7.25, exposed_perimeter_m: 8.75 + 7.25 + 7.25,
  wall_thickness_m: .35, soil_conductivity_w_mk: 2, floor_resistance_m2k_w: 5,
  rsi_m2k_w: .17, rse_m2k_w: .04, basement_depth_m: 0, edge_insulation: 'none',
};
const suspended = {
  area_m2: 80, exposed_perimeter_m: 40, wall_thickness_m: .3,
  soil_conductivity_w_mk: 1.5, rsi_m2k_w: .17, rse_m2k_w: .04,
  deck_u_value_w_m2k: 1 / (.17 + .2 + .17), floor_height_m: .3,
  underfloor_wall_u_value_w_m2k: 1.5,
  ventilation_opening_area_per_perimeter_m2_m: .003,
  annual_wind_speed_10m_m_s: 5, wind_shielding_factor: .05,
  ventilation: 'natural', base_depth_m: 0, base_insulation_resistance_m2k_w: 0,
  edge_insulation: 'none',
};

test('Irish government TGD L 2022 Example A4: published ISO 13370:2017 well-insulated slab', () => {
  // Source p54 (PDF p59): Rf=100 mm/.020=5, area=63.4375,
  // exposed perimeter=23.25 (one party wall excluded), dt=10.77, U=.15.
  const r = calculateSlabOnGround(slab);
  near(r.characteristic_dimension_m, 5.456989247311828);
  near(r.equivalent_ground_thickness_m, 10.77);
  assert.equal(r.branch, 'well_insulated');
  assert.equal(r.u_value_2dp, .15);
  near(r.u_value, .15078584963975558);
  near(r.heat_loss_coefficient_w_k, r.u_value * 63.4375);
});

test('CIBSE Guide A 2015 Examples 3.4 and 3.5: uninsulated and moderately insulated slab', () => {
  // Source p3-16 (PDF p143). Its examples explicitly use Rsi=.14, not .17.
  // 3.4: A=660, P=120, w=.3, λg=1.5, Rf=0; published B=11, dt=.57, U=.35.
  const a = calculateSlabOnGround({...slab, area_m2: 660, exposed_perimeter_m: 120,
    wall_thickness_m: .3, soil_conductivity_w_mk: 1.5, floor_resistance_m2k_w: 0, rsi_m2k_w: .14});
  near(a.characteristic_dimension_m, 11); near(a.equivalent_ground_thickness_m, .57);
  assert.equal(a.branch, 'uninsulated_or_moderately_insulated');
  assert.equal(a.u_value_2dp, .35);
  // 3.5: A=48, P=20 (garage omitted from A), Rf=.7; dt=1.62, published U=.42.
  const b = calculateSlabOnGround({...slab, area_m2: 48, exposed_perimeter_m: 20,
    wall_thickness_m: .3, soil_conductivity_w_mk: 1.5, floor_resistance_m2k_w: .7, rsi_m2k_w: .14});
  near(b.characteristic_dimension_m, 4.8); near(b.equivalent_ground_thickness_m, 1.62);
  assert.equal(b.u_value_2dp, .42);
});

test('CIBSE Example 3.6 suspended deck reference: published U0=.69, Rf=2.04 gives U=.30', () => {
  const r = calculateSuspendedFloorFromReference({reference_u_value_w_m2k: .69,
    reference_deck_resistance_m2k_w: .2, deck_resistance_m2k_w: 2.04});
  near(r.u_value, .3040183292210081);
  assert.equal(r.u_value_2dp, .30);
  // This checks the published reference adjustment; it does not pretend the
  // table's undocumented boundary/geometry assumptions were independently known.
});

test('Naturally ventilated suspended floor: explicit SAP formula fixture and dimensionally separate paths', () => {
  // A=80, P=40 gives B=4. The official SAP S5.5 descriptions give the equations.
  // Numbers are independently evaluated arithmetic fixtures, not published test outputs.
  const r = calculateSuspendedGroundFloor(suspended);
  near(r.characteristic_dimension_m, 4); near(r.equivalent_ground_thickness_m, .615);
  near(r.underfloor_wall_path_u_value_w_m2k, .225);
  near(r.ventilation_path_u_value_w_m2k, .271875);
  near(r.underfloor_external_u_value_w_m2k, .496875);
  near(r.u_value, .7261029951014984);
  assert.equal(r.u_value_2dp, .73);
  assert.ok(r.u_value < suspended.deck_u_value_w_m2k);
});

test('Reference adjustment and direct suspended heat balance agree when reference conditions are identical', () => {
  const r0 = calculateSuspendedGroundFloor(suspended);
  const reference = calculateSuspendedFloorFromReference({reference_u_value_w_m2k: r0.u_value,
    reference_deck_resistance_m2k_w: .2, deck_resistance_m2k_w: 3});
  const direct = calculateSuspendedGroundFloor({...suspended, deck_u_value_w_m2k: 1 / (.34 + 3)});
  near(reference.u_value, direct.u_value);
});

test('Insulation, exposed perimeter, soil conductivity and ventilation follow physical trends', () => {
  const a = calculateSlabOnGround(slab);
  assert.ok(calculateSlabOnGround({...slab, floor_resistance_m2k_w: 8}).u_value < a.u_value);
  assert.ok(calculateSlabOnGround({...slab, exposed_perimeter_m: 30}).u_value > a.u_value);
  assert.ok(calculateSlabOnGround({...slab, soil_conductivity_w_mk: 3.5}).u_value > a.u_value);
  const b = calculateSuspendedGroundFloor(suspended);
  assert.ok(calculateSuspendedGroundFloor({...suspended, deck_u_value_w_m2k: .2}).u_value < b.u_value);
  assert.ok(calculateSuspendedGroundFloor({...suspended, annual_wind_speed_10m_m_s: 10}).u_value > b.u_value);
  assert.ok(calculateSuspendedGroundFloor({...suspended, ventilation_opening_area_per_perimeter_m2_m: .006}).u_value > b.u_value);
  assert.ok(calculateSuspendedGroundFloor({...suspended, underfloor_wall_u_value_w_m2k: .5}).u_value < b.u_value);
});

test('Ground slab branch boundary uses >= B and has only the published formula approximation step', () => {
  const input = {...slab, area_m2: 100, exposed_perimeter_m: 40, soil_conductivity_w_mk: 1,
    wall_thickness_m: 1, rsi_m2k_w: 0, rse_m2k_w: 0, floor_resistance_m2k_w: 4};
  const at = calculateSlabOnGround(input);
  const below = calculateSlabOnGround({...input, floor_resistance_m2k_w: 4 - 1e-8});
  assert.equal(at.branch, 'well_insulated');
  assert.equal(below.branch, 'uninsulated_or_moderately_insulated');
  near(at.u_value, 1 / (5 * 1.457));
  // 0.457 is a published rounded coefficient: its two formulas are not exactly continuous.
  assert.ok(Math.abs(at.u_value - below.u_value) / at.u_value < .001);
});

test('Zero wind/openings are limits; very high ventilation approaches the standalone deck U', () => {
  const a = calculateSuspendedGroundFloor({...suspended, annual_wind_speed_10m_m_s: 0});
  const b = calculateSuspendedGroundFloor({...suspended, ventilation_opening_area_per_perimeter_m2_m: 0});
  near(a.u_value, b.u_value); assert.equal(a.ventilation_path_u_value_w_m2k, 0);
  const extreme = calculateSuspendedGroundFloor({...suspended, annual_wind_speed_10m_m_s: 1e12});
  assert.ok(extreme.u_value < suspended.deck_u_value_w_m2k);
  near(extreme.u_value, suspended.deck_u_value_w_m2k, 1e-9);
});

test('Reject omitted soil/geometry, non-finite and invalid units rather than infer them', () => {
  for (const key of ['area_m2', 'exposed_perimeter_m', 'wall_thickness_m', 'soil_conductivity_w_mk', 'floor_resistance_m2k_w', 'rsi_m2k_w', 'rse_m2k_w']) {
    const input = {...slab}; delete input[key];
    assert.throws(() => calculateSlabOnGround(input), /finite/);
  }
  assert.throws(() => characteristicFloorDimension(10, 0), /positive/);
  assert.throws(() => calculateSlabOnGround({...slab, area_m2: Infinity}), /finite/);
  assert.throws(() => calculateSlabOnGround({...slab, wall_thickness_m: '0.35'}), /finite/);
  assert.throws(() => calculateSlabOnGround({...slab, wall_thickness_mm: 350}), /Unsupported/);
  assert.throws(() => calculateSuspendedGroundFloor({...suspended, wind_shielding_factor: 2}), /between 0 and 1/);
  assert.throws(() => calculateSuspendedGroundFloor({...suspended, deck_u_value_w_m2k: 4}), /each face/);
  assert.throws(() => calculateSuspendedFloorFromReference({reference_u_value_w_m2k: 1,
    reference_deck_resistance_m2k_w: 2, deck_resistance_m2k_w: 3}), /remaining/);
});

test('Reject unsupported physical conditions instead of quietly dropping them', () => {
  assert.throws(() => calculateSlabOnGround({...slab, edge_insulation: 'vertical'}), /separate method/);
  assert.throws(() => calculateSlabOnGround({...slab, basement_depth_m: 1}), /Basement/);
  assert.throws(() => calculateSlabOnGround({...slab, flowing_groundwater: true}), /outside/);
  assert.throws(() => calculateSlabOnGround({...slab, embedded_heating: true}), /outside/);
  assert.throws(() => calculateSlabOnGround({...slab, element: 'exposed_floor'}), /requires element/);
  assert.throws(() => calculateSuspendedGroundFloor({...suspended, ventilation: 'mechanical'}), /naturally/);
  assert.throws(() => calculateSuspendedGroundFloor({...suspended, base_depth_m: .25}), /below-ground/);
  assert.throws(() => calculateSuspendedGroundFloor({...suspended, base_insulation_resistance_m2k_w: .5}), /Insulated/);
  assert.throws(() => calculateSlabOnGround({...slab, corrections: [{kind: 'edge'}]}), /Unsupported/);
});
