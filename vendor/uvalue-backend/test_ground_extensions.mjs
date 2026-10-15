import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSlabOnGround, calculateSuspendedGroundFloor} from './ground_floors.mjs';
import {calculateEdgeInsulationCorrection, calculateSlabWithEdgeInsulation,
  calculateBasementFloor, calculateBasementWall, calculateHeatedBasement,
  calculateUnheatedBasement, calculateSuspendedGroundFloorExtended,
  combinePartlyHeatedBasement} from './ground_extensions.mjs';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to be within ${tolerance} of ${expected}`);
const common = {area_m2: 75, exposed_perimeter_m: 35, wall_thickness_m: .3,
  soil_conductivity_w_mk: 2, rsi_m2k_w: .17, rse_m2k_w: .04, edge_insulation: 'none'};
const basement = {...common, basement_depth_m: 2.5, floor_resistance_m2k_w: 0,
  wall_resistance_m2k_w: .3 / 1.7 + .05 / .035, wall_rsi_m2k_w: .13, wall_rse_m2k_w: .04};
const floorInput = () => Object.fromEntries(Object.entries(basement).filter(([key]) => !key.startsWith('wall_r')));
const wallInput = () => Object.fromEntries(Object.entries(basement).filter(([key]) => key !== 'area_m2'));
const cellar = {...basement, deck_u_value_w_m2k: 1 / .54, above_ground_wall_height_m: .5,
  above_ground_wall_u_value_w_m2k: .8, ventilation: 'external_air',
  air_changes_per_hour: .3, basement_air_volume_m3: 225};
const suspended = {...common, area_m2: 80, exposed_perimeter_m: 40, soil_conductivity_w_mk: 1.5,
  deck_u_value_w_m2k: 1 / .54, floor_height_m: .3, underfloor_wall_u_value_w_m2k: 1.5,
  ventilation_opening_area_per_perimeter_m2_m: .003, annual_wind_speed_10m_m_s: 5,
  wind_shielding_factor: .05, ventilation: 'natural', base_depth_m: 0,
  base_insulation_resistance_m2k_w: 0};

test('published horizontal edge equation evaluated with a simple 4/3 logarithm fixture', () => {
  // dt=1, λRi'=1, D=1: the two logarithms combine to ln(4/3).
  const r = calculateEdgeInsulationCorrection({soil_conductivity_w_mk: 2,
    equivalent_ground_thickness_m: 1, orientation: 'horizontal', extent_m: 1,
    thickness_m: .1, resistance_m2k_w: .55});
  near(r.additional_equivalent_thickness_m, 1);
  near(r.edge_correction_w_mk, -2 / Math.PI * Math.log(4 / 3));
});

test('published vertical edge equation uses twice the depth and matches horizontal width', () => {
  const base = {soil_conductivity_w_mk: 2, equivalent_ground_thickness_m: 1,
    thickness_m: .1, resistance_m2k_w: .55};
  const vertical = calculateEdgeInsulationCorrection({...base, orientation: 'vertical', extent_m: .5});
  const horizontal = calculateEdgeInsulationCorrection({...base, orientation: 'horizontal', extent_m: 1});
  near(vertical.edge_correction_w_mk, -2 / Math.PI * Math.log(4 / 3));
  near(vertical.edge_correction_w_mk, horizontal.edge_correction_w_mk);
});

test('edge slab chooses greatest reduction, never sums alternate details', () => {
  const edge = {orientation: 'horizontal', extent_m: .5, thickness_m: .03, resistance_m2k_w: 1.02};
  const base = {...common, area_m2: 660, exposed_perimeter_m: 120, soil_conductivity_w_mk: 1.5,
    rsi_m2k_w: .14, floor_resistance_m2k_w: 0, basement_depth_m: 0};
  const one = calculateSlabWithEdgeInsulation({...base, edge_insulation: [edge],
    edge_insulation_small_extent: true, edge_junction_thermal_bridge_free: true});
  const alternatives = calculateSlabWithEdgeInsulation({...base,
    edge_insulation: [edge, {...edge, orientation: 'vertical', extent_m: .5}],
    edge_insulation_small_extent: true, edge_junction_thermal_bridge_free: true});
  assert.equal(alternatives.selected_edge_detail_index, 1);
  assert.ok(alternatives.u_value < one.u_value);
  near(alternatives.heat_loss_coefficient_w_k, alternatives.u_value * 660);
  near(alternatives.u_value - alternatives.uncorrected_u_value,
    alternatives.edge_insulation[1].edge_correction_w_mk * 120 / 660);
});

test('insulation replacing equal-resistance soil gives zero correction', () => {
  const r = calculateEdgeInsulationCorrection({soil_conductivity_w_mk: 2,
    equivalent_ground_thickness_m: .8, orientation: 'vertical', extent_m: .8,
    thickness_m: .1, resistance_m2k_w: .05});
  near(r.edge_correction_w_mk, 0);
});

test('zero-depth basement floor matches published Irish slab fixture', () => {
  const input = {...common, area_m2: 63.4375, exposed_perimeter_m: 23.25,
    wall_thickness_m: .35, floor_resistance_m2k_w: 5, basement_depth_m: 0};
  const floor = calculateBasementFloor(input);
  const slab = calculateSlabOnGround(input);
  near(floor.u_value, .15078584964017397, 1e-10);
  near(floor.u_value, slab.u_value);
});

test('basement floor arithmetic fixture and floor-depth physical trend', () => {
  const input = floorInput();
  const r = calculateBasementFloor(input);
  near(r.characteristic_dimension_m, 30 / 7);
  near(r.equivalent_ground_thickness_m, .72);
  near(r.depth_adjusted_ground_thickness_m, 1.97);
  near(r.u_value, .5335082246098167);
  assert.ok(calculateBasementFloor({...input, basement_depth_m: 4}).u_value < r.u_value);
  assert.ok(calculateBasementFloor({...input, floor_resistance_m2k_w: 5}).u_value < r.u_value);
});

test('published BuildDesk 3.4.5 retaining-wall outputs match within input rounding', () => {
  // Balbougie Steading published calculation, PDF pages 77 and 83 (zero based).
  const input = {...wallInput(), exposed_perimeter_m: 6, basement_depth_m: 1.25,
    soil_conductivity_w_mk: 2, floor_resistance_m2k_w: 5};
  const hemp = calculateBasementWall({...input, wall_thickness_m: .718, wall_resistance_m2k_w: 1.754});
  near(hemp.equivalent_ground_thickness_m, 11.138);
  near(hemp.equivalent_wall_thickness_m, 3.847, .00101);
  near(hemp.u_value, .395, .0005);
  assert.equal(hemp.u_value_2dp, .39);
  near(hemp.heat_loss_coefficient_w_k, 3, .05);
  const plaster = calculateBasementWall({...input, wall_thickness_m: .683, wall_resistance_m2k_w: 1.882});
  near(plaster.equivalent_ground_thickness_m, 11.103);
  near(plaster.equivalent_wall_thickness_m, 4.105, .00101);
  near(plaster.u_value, .375, .0005);
  assert.equal(plaster.u_value_2dp, .37);
  near(plaster.heat_loss_coefficient_w_k, 2.8, .05);
});

test('wall coupling substitution uses smaller wall-equivalent thickness', () => {
  const input = {...wallInput(), floor_resistance_m2k_w: 5, wall_resistance_m2k_w: .1};
  const wall = calculateBasementWall(input);
  near(wall.wall_coupling_thickness_m, .54);
  assert.ok(wall.equivalent_ground_thickness_m > wall.equivalent_wall_thickness_m);
  near(wall.u_value, calculateBasementWall({...input, floor_resistance_m2k_w: 20}).u_value);
  assert.ok(calculateBasementWall({...input, wall_resistance_m2k_w: 2}).u_value < wall.u_value);
});

test('whole basement reports ground-contact U and correctly summed H', () => {
  const r = calculateHeatedBasement(basement);
  near(r.total_ground_contact_area_m2, 162.5);
  near(r.heat_loss_coefficient_w_k, 66.4259338942459);
  near(r.u_value, r.heat_loss_coefficient_w_k / 162.5);
  near(r.floor_area_normalised_u_value_w_m2k, r.heat_loss_coefficient_w_k / 75);
  assert.notEqual(r.u_value, r.floor_area_normalised_u_value_w_m2k);
});

test('unheated basement steady heat balance and separate ventilation contribution', () => {
  const r = calculateUnheatedBasement(cellar);
  near(r.ventilation_heat_loss_coefficient_w_k, 22.275);
  near(r.above_ground_wall_heat_loss_coefficient_w_k, 14);
  near(r.basement_external_heat_loss_coefficient_w_k, 102.7009338942459);
  near(r.u_value, .7872306557784796);
  near(r.temperature_reduction_factor, .42510455412037906);
  assert.ok(r.u_value < cellar.deck_u_value_w_m2k);
  assert.ok(calculateUnheatedBasement({...cellar, air_changes_per_hour: 3}).u_value > r.u_value);
  assert.ok(calculateUnheatedBasement({...cellar, deck_u_value_w_m2k: .25}).u_value < r.u_value);
});

test('extended suspended model preserves original uninsulated reference case', () => {
  const simple = calculateSuspendedGroundFloor(suspended);
  const extended = calculateSuspendedGroundFloorExtended(suspended);
  near(extended.u_value, simple.u_value);
  near(extended.ground_u_value_w_m2k, simple.ground_u_value_w_m2k);
  assert.equal(extended.ground_path_method, 'shallow_void_ground_logarithm');
});

test('ground-base insulation reduces suspended-floor heat loss independently of deck insulation', () => {
  const bare = calculateSuspendedGroundFloorExtended(suspended);
  const insulated = calculateSuspendedGroundFloorExtended({...suspended, base_insulation_resistance_m2k_w: 3});
  assert.ok(insulated.u_value < bare.u_value);
  assert.ok(insulated.ground_u_value_w_m2k < bare.ground_u_value_w_m2k);
  near(insulated.underfloor_external_u_value_w_m2k, bare.underfloor_external_u_value_w_m2k);
  near(insulated.equivalent_ground_thickness_m, 5.115);
  const deck = calculateSuspendedGroundFloorExtended({...suspended, deck_u_value_w_m2k: .2});
  near(deck.equivalent_ground_thickness_m, bare.equivalent_ground_thickness_m);
});

test('deep suspended base includes below-ground walls on floor-area basis', () => {
  const input = {...suspended, base_depth_m: 1.5, base_insulation_resistance_m2k_w: 1,
    below_ground_wall_resistance_m2k_w: .5, wall_rsi_m2k_w: .13, wall_rse_m2k_w: .04};
  const r = calculateSuspendedGroundFloorExtended(input);
  const basementResult = calculateHeatedBasement({...common, area_m2: 80, exposed_perimeter_m: 40,
    soil_conductivity_w_mk: 1.5, basement_depth_m: 1.5, floor_resistance_m2k_w: 1,
    wall_resistance_m2k_w: .5, wall_rsi_m2k_w: .13, wall_rse_m2k_w: .04});
  near(r.ground_u_value_w_m2k, basementResult.heat_loss_coefficient_w_k / 80);
  assert.equal(r.ground_path_method, 'deep_void_floor_and_walls');
  assert.ok(r.u_value < r.deck_u_value_w_m2k);
});

test('partly heated basement mixes H for the common geometry and preserves endpoints', () => {
  const input = {heated_heat_loss_coefficient_w_k: 100, unheated_heat_loss_coefficient_w_k: 40,
    heated_ground_contact_fraction: .25};
  near(combinePartlyHeatedBasement(input).heat_loss_coefficient_w_k, 55);
  near(combinePartlyHeatedBasement({...input, heated_ground_contact_fraction: 0}).heat_loss_coefficient_w_k, 40);
  near(combinePartlyHeatedBasement({...input, heated_ground_contact_fraction: 1}).heat_loss_coefficient_w_k, 100);
});

test('rejects unsupported features, extra keys and ambiguous surface/geometry inputs', () => {
  assert.throws(() => calculateHeatedBasement({...basement, edge_insulation: []}), /edge_insulation/);
  assert.throws(() => calculateHeatedBasement({...basement, flowing_groundwater: true}), /groundwater/);
  assert.throws(() => calculateHeatedBasement({...basement, embedded_heating: true}), /embedded/);
  assert.throws(() => calculateHeatedBasement({...basement, area_m2: 0}), /area/);
  assert.throws(() => calculateHeatedBasement({...basement, unexpected: 2}), /Unsupported/);
  assert.throws(() => calculateBasementWall({...wallInput(), basement_depth_m: 0}), /basement_depth/);
  assert.throws(() => calculateBasementWall({...wallInput(), wall_rsi_m2k_w: undefined}), /wall_rsi/);
  assert.throws(() => calculateUnheatedBasement({...cellar, deck_u_value_w_m2k: 4}), /each face/);
  assert.throws(() => calculateUnheatedBasement({...cellar, ventilation: 'internal_air'}), /external_air/);
  assert.throws(() => calculateSuspendedGroundFloorExtended({...suspended, base_depth_m: 1}), /wall_resistance/);
  assert.throws(() => calculateSuspendedGroundFloorExtended({...suspended, below_ground_wall_resistance_m2k_w: .5}), /exceeds/);
  assert.throws(() => combinePartlyHeatedBasement({heated_heat_loss_coefficient_w_k: 20,
    unheated_heat_loss_coefficient_w_k: 10, heated_ground_contact_fraction: 1.1}), /between/);
});

test('edge method rejects unsupported detail applicability and negative added resistance', () => {
  const edge = {orientation: 'vertical', extent_m: .8, thickness_m: .08, resistance_m2k_w: 2};
  const input = {...common, floor_resistance_m2k_w: 0, basement_depth_m: 0, edge_insulation: [edge]};
  assert.throws(() => calculateSlabWithEdgeInsulation(input), /small_extent/);
  assert.throws(() => calculateSlabWithEdgeInsulation({...input, edge_insulation_small_extent: true}), /thermal_bridge/);
  assert.throws(() => calculateSlabWithEdgeInsulation({...input, edge_insulation_small_extent: true,
    edge_junction_thermal_bridge_free: true, edge_insulation: [{...edge, perimeter_fraction: .5}]}), /Unsupported/);
  assert.throws(() => calculateEdgeInsulationCorrection({...edge, soil_conductivity_w_mk: 2,
    equivalent_ground_thickness_m: .8, resistance_m2k_w: .01}), /replaced soil/);
});
