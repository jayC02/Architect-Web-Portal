import assert from 'node:assert/strict';
import { calculateUValue, formatUValue, uValueInputSchema } from '../src/lib/u-value/calculator';
import { draftInputs, emptyCalculation, newLayer, parseStoredDraft, restoredDraft } from '../src/lib/u-value/draft';
import { materialLambda } from '../src/lib/u-value/materials';

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const solid = (id = 'insulation', thicknessMm = 100, lambda = 0.04, extra: object = {}) => ({
  id, kind: 'solid', name: id, thicknessMm, lambda, source: 'Referenced design value: test fixture', ...extra,
});
const inputs = (extra: object = {}) => ({ element: 'wall', layers: [solid()], correctionsAssessed: true, ...extra });
const timber = { name: 'Timber', lambda: 0.13, fraction: 0.15, group: 'studs', source: 'Referenced timber design value' };
const cavity = (ventilation: string, openings = 1000) => ({ id: 'cavity', kind: 'air', name: 'Cavity', thicknessMm: 50, resistance: 0.18, ventilation, openings, source: 'Cavity resistance assessed for heat direction and surface emissivity' });

check('millimetres convert to metres; homogeneous ISO 6946 reference', () => {
  const result = calculateUValue(inputs()); near(result.totalResistance, 2.67); near(result.uValue, 1 / 2.67);
  assert.equal(result.displayUValue, '0.37'); near(result.approximationErrorPercent, 0);
});
check('surface resistances and explicit heat-flow direction', () => {
  near(calculateUValue(inputs({ element: 'roof' })).rsi, 0.10);
  near(calculateUValue(inputs({ element: 'exposed-floor' })).rsi, 0.17);
  near(calculateUValue(inputs({ element: 'roof', heatFlow: 'horizontal' })).uValue, 1 / 2.67);
});
check('declared resistance accepts zero-resistance membrane', () => {
  near(calculateUValue(inputs({ layers: [solid(), { id: 'membrane', kind: 'resistance', name: 'Membrane', thicknessMm: 0, resistance: 0, source: 'Negligible resistance' }] })).uValue, 1 / 2.67);
});
check('parallel paths and isothermal planes use the combined method', () => {
  const result = calculateUValue(inputs({ layers: [solid('insulation', 100, 0.04, { bridge: timber })] }));
  const upper = 1 / (0.85 / 2.67 + 0.15 / (0.17 + 0.1 / 0.13));
  const lower = 0.17 + 0.1 / (0.85 * 0.04 + 0.15 * 0.13);
  near(result.upperResistance, upper); near(result.lowerResistance, lower); near(result.uValue, 2 / (upper + lower));
  near(result.paths.reduce((sum, path) => sum + path.fraction, 0), 1);
});
check('aligned layers keep two paths; independent groups form four', () => {
  const aligned = calculateUValue(inputs({ layers: [solid('a', 50, 0.04, { bridge: timber }), solid('b', 50, 0.04, { bridge: timber })] }));
  const independent = calculateUValue(inputs({ layers: [solid('a', 50, 0.04, { bridge: timber }), solid('b', 50, 0.04, { bridge: { ...timber, group: 'battens' } })] }));
  assert.equal(aligned.paths.length, 2); assert.equal(independent.paths.length, 4);
  near(independent.paths[3].fraction, 0.15 * 0.15); assert.notEqual(aligned.uValue, independent.uValue);
});
check('invalid alignment, metal framing and approximation outside scope are rejected', () => {
  assert.throws(() => calculateUValue(inputs({ layers: [solid('a', 50, 0.04, { bridge: timber }), solid('b', 50, 0.04, { bridge: { ...timber, fraction: 0.2 } })] })), /same area fraction/);
  assert.throws(() => calculateUValue(inputs({ layers: [solid('a', 200, 0.02, { bridge: { ...timber, lambda: 5, fraction: 0.1 } })] })), /ratio exceeds 1.5/);
  assert.throws(() => calculateUValue(inputs({ layers: [solid('a', 100, 0.04, { bridge: { ...timber, lambda: 50 } })] })), /Metal framing/);
  for (const construction of ['steel-frame', 'inverted-roof', 'specialist']) assert.throws(() => calculateUValue(inputs({ construction })), /specialist calculation/);
});
check('well-ventilated cavity removes outer layers and uses sheltered Rse', () => {
  const result = calculateUValue(inputs({ layers: [solid(), cavity('well'), solid('outer', 100, 0.7)] }));
  near(result.uValue, 1 / 2.76); near(result.rse, 0.13); assert.deepEqual(result.ignoredLayerIds, ['cavity', 'outer']);
  const conflictedOuter = [solid('a', 20, 0.04, { bridge: timber }), solid('b', 20, 0.04, { bridge: { ...timber, fraction: 0.2 } })];
  near(calculateUValue(inputs({ layers: [solid(), cavity('well'), ...conflictedOuter] })).uValue, 1 / 2.76);
});
check('slightly ventilated total R interpolates at both endpoints and midpoint', () => {
  const fullR = 0.17 + 2.5 + 0.18 + 0.1 / 0.7;
  for (const [openings, fraction] of [[0, 0], [500, 0], [1000, 0.5], [1500, 1], [2000, 1]]) {
    const result = calculateUValue(inputs({ layers: [solid(), cavity('slightly', openings), solid('outer', 100, 0.7)] }));
    near(result.uValue, 1 / ((1 - fraction) * fullR + fraction * 2.76));
  }
});
// BRE RdSAP 10 June 2026, Appendix S ground-floor equations. This checks the
// ISO 13370 uniform-slab formula independently, including the lambda numerator
// (rather than 2 lambda) in the dt >= B' branch. It does not implement RdSAP.
check('ground slab reference: both ISO 13370 regimes', () => {
  const layers = [solid('concrete', 150, 1.7), solid('insulation', 50, 0.036)];
  const dt = 0.35 + 2 * (0.17 + 0.15 / 1.7 + 0.05 / 0.036 + 0.04);
  for (const [area, perimeter] of [[100, 40], [40, 28]]) {
    const b = 2 * area / perimeter;
    const expected = dt >= b ? 2 / (0.457 * b + dt) : 4 * Math.log(1 + Math.PI * b / dt) / (Math.PI * b + dt);
    const result = calculateUValue(inputs({ element: 'ground-slab', layers, ground: { area, perimeter, wallThicknessMm: 350, soilLambda: 2, configuration: 'uniform-slab', source: 'Assessed soil conditions' } }));
    near(result.uValue, expected); near(result.ground!.equivalentThickness, dt); near(result.ground!.characteristicDimension, b);
  }
});
check('unsupported ground configurations and missing soil data cannot pass silently', () => {
  const ground = { area: 100, perimeter: 40, wallThicknessMm: 300, soilLambda: 2, configuration: 'uniform-slab', source: 'Soil report' };
  for (const configuration of ['edge-insulated', 'suspended', 'basement', 'flowing-groundwater']) assert.throws(() => calculateUValue(inputs({ element: 'ground-slab', ground: { ...ground, configuration } })), /specialist ISO 13370/);
  assert.throws(() => calculateUValue(inputs({ element: 'ground-slab', ground, layers: [cavity('unventilated')] })), /homogeneous layers/);
  assert.throws(() => calculateUValue(inputs({ element: 'ground-slab' })), /ground-floor area/);
  assert.deepEqual(calculateUValue(inputs({ element: 'ground-slab', ground: { ...ground, source: '' } })).missingSources, ['Soil conductivity']);
});
check('corrections include small contributions; target uses the unrounded result', () => {
  const result = calculateUValue(inputs({ target: 0.374, corrections: [{ name: 'Fixings', deltaU: 0.001, source: 'Assessed fixings calculation' }] }));
  near(result.uValue, 1 / 2.67 + 0.001); assert.equal(result.displayUValue, '0.38'); assert.equal(result.targetMet, false);
  assert.equal(calculateUValue(inputs({ target: 0.37 })).displayUValue, '0.37'); assert.equal(calculateUValue(inputs({ target: 0.37 })).targetMet, false);
  assert.equal(formatUValue(0.0949), '0.095'); assert.equal(formatUValue(1.24), '1.2');
});
check('product thickness and declared conductivity cannot be silently overridden', () => {
  near(materialLambda('rockwool-flexi', 120)!, 0.038); near(materialLambda('rockwool-flexi', 140)!, 0.035);
  assert.throws(() => calculateUValue(inputs({ layers: [solid('pir', 125, 0.022, { productId: 'sopratherm-ga4000' })] })), /not listed/);
  assert.throws(() => calculateUValue(inputs({ layers: [solid('pir', 100, 0.020, { productId: 'sopratherm-ga4000' })] })), /conductivity differs/);
  assert.ok(calculateUValue(inputs({ layers: [solid('pir', 100, 0.022, { productId: 'sopratherm-ga4000' })] })).uValue > 0);
});
check('invalid physical inputs, duplicate IDs and result spoofing fail validation', () => {
  for (const lambda of [0, -1, Infinity, NaN]) assert.throws(() => calculateUValue(inputs({ layers: [solid('a', 100, lambda)] })));
  assert.throws(() => calculateUValue(inputs({ layers: [solid('same'), solid('same')] })), /unique identifier/);
  assert.throws(() => calculateUValue(inputs({ result: { uValue: 0.1 } })));
});
check('draft recovery validates structure; blank numbers do not become zero', () => {
  const draft = emptyCalculation(); draft.layers = [newLayer('a')];
  assert.equal(parseStoredDraft({ title: 'Corrupt', layers: [{}] }), null);
  assert.equal(parseStoredDraft({ ...draft, corrections: null }), null);
  assert.equal(parseStoredDraft({ ...draft, layers: [draft.layers[0], draft.layers[0]] }), null);
  assert.deepEqual(parseStoredDraft(draft), draft);
  assert.throws(() => uValueInputSchema.parse(draftInputs(draft)));
  const validated = uValueInputSchema.parse(inputs({ heatFlow: 'horizontal', target: 0.4 }));
  assert.deepEqual(uValueInputSchema.parse(draftInputs(restoredDraft(validated))), validated);
});
console.log(`${checks} calculation and validation groups passed.`);
