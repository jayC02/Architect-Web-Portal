import test from 'node:test';
import assert from 'node:assert/strict';
import { unventilatedAirLayerResistance as air, airLayerVentilationPlan as plan,
  interpolateVentilatedResistance as blend } from './air_layers.mjs';

const near = (a, b, t = 1e-12) => assert.ok(Math.abs(a-b) <= t, `${a} differs from ${b}`);
const cavity = { thickness_mm: 50, width_mm: 2000, height_mm: 2500, heat_flow: 'horizontal' };
const vent = { orientation: 'vertical', heat_flow: 'horizontal', cavity_layer_index: 1,
  layer_count: 4, opening_area_mm2_per_m: 1000, openings_allow_through_flow: true };

test('ISO high-emissivity table: direction, narrow and wide cavities', () => {
  assert.equal(air(cavity).resistance, .18);
  assert.equal(air({ ...cavity, heat_flow: 'up' }).resistance, .16);
  assert.equal(air({ ...cavity, heat_flow: 'down' }).resistance, .21);
  assert.equal(air({ ...cavity, thickness_mm: 5 }).resistance, .11);
  assert.equal(air({ ...cavity, thickness_mm: 300, width_mm: 3100, height_mm: 4000, heat_flow: 'down' }).resistance, .23);
});

test('ISO table interpolates in thickness and never extrapolates', () => {
  // Independent mid-point between 15 mm (0.17) and 25 mm (0.18).
  near(air({ ...cavity, thickness_mm: 20 }).resistance, .175);
  // Between 0 and 5 mm: half the tabulated 0.11.
  near(air({ ...cavity, thickness_mm: 2.5 }).resistance, .055);
  assert.throws(() => air({ ...cavity, thickness_mm: 301 }), /300 mm/);
});

test('Low-emissivity calculation agrees with independent ANIT worked example', () => {
  const r = air({ ...cavity, method: 'iso_6946_annex_d', emissivity_1: .9,
    emissivity_2: .08, emissivity_evidence: 'ANIT pp. 10-12 mathematical fixture; not a product certificate' });
  // ANIT rounds E=0.079, hr=0.41, R=0.602; preserve unrounded model maths.
  near(r.ha, 1.25);
  near(r.effective_emittance, .079, .001);
  near(r.hr, .41, .004);
  near(r.resistance, .602, .002);
  assert.match(r.warnings[0], /not been checked/);
});

test('Analytical low-emissivity model agrees with BR443 thin-wall examples', () => {
  const low = { ...cavity, method: 'iso_6946_annex_d', emissivity_1: .2, emissivity_2: .9 };
  // Published normal-building wall examples round to 0.44, 0.29 and 0.17.
  near(air({ ...low, thickness_mm: 25 }).resistance, .44, .005);
  near(air({ ...low, thickness_mm: 10 }).resistance, .29, .005);
  near(air({ ...low, thickness_mm: 5 }).resistance, .17, .005);
  near(air({ ...low, thickness_mm: 25, heat_flow: 'up' }).resistance, .34, .005);
  near(air({ ...low, thickness_mm: 25, heat_flow: 'down' }).resistance, .50, .005);
});

test('Low-emissivity model is symmetric, conduction limits narrow cavities', () => {
  const a = { ...cavity, method: 'iso_6946_annex_d', emissivity_1: .2, emissivity_2: .9 };
  near(air(a).resistance, air({ ...a, emissivity_1: .9, emissivity_2: .2 }).resistance);
  const small = air({ ...a, thickness_mm: 1 });
  near(small.ha, 25);
  assert.ok(small.resistance < .04);
  assert.ok(air(a).resistance > air(cavity).resistance);
});

test('Reject unsupported geometry, low-emissivity evidence and boundary conditions', () => {
  assert.throws(() => air({ ...cavity, width_mm: 500 }), /exceed 10 times/);
  assert.throws(() => air({ ...cavity, parallel_faces: false }), /Non-parallel/);
  assert.throws(() => air({ ...cavity, internal_air_exchange: true }), /indoor/);
  assert.throws(() => air({ ...cavity, glazing: true }), /glazing standards/);
  assert.throws(() => air({ ...cavity, emissivity_1: .2 }), /high-emissivity/);
  assert.throws(() => air({ ...cavity, emissivity_1: .1, method: 'iso_6946_annex_d' }), /emissivity_evidence/);
  assert.throws(() => air({ ...cavity, emissivity_1: .01, method: 'iso_6946_annex_d' }), /between 0.02/);
  assert.throws(() => air({ ...cavity, heat_flow: 'sideways' }), /heat_flow/);
  assert.throws(() => air({ ...cavity, temperature_difference_k: 6 }), /Table D.2/);
  assert.throws(() => air({ ...cavity, mean_temperature_c: 20 }), /10°C/);
});

test('Ventilation thresholds are inclusive at 500 and 1500 with explicit units', () => {
  const small = { ...vent, opening_area_mm2_per_m: 500, openings_allow_through_flow: false,
    insulation_between_cavity_and_exterior: false };
  assert.equal(plan(small).ventilation, 'unventilated');
  assert.equal(plan({ ...vent, opening_area_mm2_per_m: 500.01 }).ventilation, 'slightly_ventilated');
  assert.equal(plan({ ...vent, opening_area_mm2_per_m: 1499.99 }).ventilation, 'slightly_ventilated');
  assert.equal(plan({ ...vent, opening_area_mm2_per_m: 1500 }).ventilation, 'well_ventilated');
  assert.equal(plan({ ...vent, opening_area_mm2_per_m: 0, openings_allow_through_flow: false }).ventilation, 'unventilated');
});

test('Well-ventilated plan drops cavity and outdoors-facing layers, sets still-air R', () => {
  const p = plan({ ...vent, opening_area_mm2_per_m: 1800 });
  assert.deepEqual(p.disregard_layer_indices_for_well_ventilated, [0, 1]);
  assert.deepEqual(p.retained_layer_indices_for_well_ventilated, [2, 3]);
  assert.equal(p.well_ventilated_first_retained_layer_index, 2);
  assert.equal(p.well_ventilated_external_surface_resistance, .13);
  assert.equal(p.well_ventilated_weight, 1);
});

test('Horizontal cavity opening-area units and upward/downward still-air surfaces', () => {
  const p = { ...vent, orientation: 'horizontal', opening_area_mm2_per_m: undefined,
    opening_area_mm2_per_m2: 2000 };
  assert.equal(plan({ ...p, heat_flow: 'up' }).well_ventilated_external_surface_resistance, .10);
  assert.equal(plan({ ...p, heat_flow: 'down' }).well_ventilated_external_surface_resistance, .17);
});

test('Slightly ventilated interpolation acts on total R, not on cavity R or U', () => {
  const p = plan(vent);
  assert.equal(p.unventilated_weight, .5);
  const r = blend({ unventilated_total_resistance: 3, well_ventilated_total_resistance: 2,
    well_ventilated_weight: p.well_ventilated_weight });
  assert.equal(r, 2.5);
  assert.equal(1 / r, .4);
  assert.notEqual(1 / r, .5 * (1/3) + .5 * (1/2));
  near(blend({ unventilated_total_resistance: 3, well_ventilated_total_resistance: 2,
    well_ventilated_weight: .08 }), 2.92);
});

test('Ventilation helpers reject ambiguous physical cases and incompatible units', () => {
  assert.throws(() => plan({ ...vent, opening_area_mm2_per_m2: 1000 }), /do not mix/);
  assert.throws(() => plan({ ...vent, opening_area_mm2_per_m: 100 }), /Small openings/);
  assert.throws(() => plan({ ...vent, openings_allow_through_flow: false }), /Confirm/);
  assert.throws(() => plan({ ...vent, heat_flow: 'up' }), /does not match/);
  assert.throws(() => plan({ ...vent, cavity_layer_index: 3 }), /toward indoors/);
  assert.throws(() => plan({ ...vent, exposed_surface_emissivity: .2 }), /Annex C/);
  assert.throws(() => plan({ ...vent, mechanical_ventilation: true }), /Mechanical/);
  assert.throws(() => blend({ unventilated_total_resistance: 3, well_ventilated_total_resistance: 2,
    well_ventilated_weight: 1.1 }), /between 0 and 1/);
});
