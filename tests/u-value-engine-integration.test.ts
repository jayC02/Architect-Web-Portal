import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateUValue, uValueInputSchema, U_VALUE_METHOD_VERSION } from '../src/lib/u-value/calculator';
import { draftInputs, emptyCalculation, parseStoredDraft, restoredDraft } from '../src/lib/u-value/draft';
import { calculateUValue as engine } from '../vendor/uvalue-backend/uvalue_engine.mjs';

const near = (actual: number, expected: number, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const source = 'Referenced physical inputs for validation';
const solid = (id: string, thicknessMm = 100, lambda = 0.04, bridge: object | null = null) => ({ id, kind: 'solid', name: id, thicknessMm, lambda, bridge, source });
const cavity = { id: 'air', kind: 'air', name: 'Cavity', thicknessMm: 50, resistance: 0.18, ventilation: 'unventilated', source };
const input = { element: 'wall', layers: [solid('insulation')], correctionsAssessed: true };
const airgap = { kind: 'airgap', layerId: 'insulation', level: 1, source };
const fixing = { kind: 'fastener', layerId: 'insulation', conductivity: 50, diameterMm: Math.sqrt(40 / Math.PI), countPerM2: 4, penetration: 'full', applicabilityConfirmed: true, source };

// Scottish Government Annex 6.B physical inputs. Its original published
// threshold omission is an optional policy in the library; the portal includes
// every correction, so compare to its explicit omit_small_corrections:false mode.
const timber: any = JSON.parse(readFileSync('vendor/uvalue-backend/example-timber-wall.json', 'utf8'));
const timberInput = { ...input, layers: [solid('plasterboard', 12.5, 0.21),
  solid('insulation', 140, 0.04, { name: 'Timber', lambda: 0.12, fraction: 0.15, group: 'studs', source }),
  solid('sheathing', 9, 0.13), cavity, solid('brick', 102, 0.77)], automaticCorrections: [airgap] };
const single = calculateUValue(timberInput);
near(single.upperResistance, 3.435, 0.001); near(single.lowerResistance, 3.304, 0.001);
assert.equal(single.displayUValue, '0.30'); near(single.uValue, engine({ ...timber, omit_small_corrections: false }).u_value);
assert.equal(single.engineVersion, '4.0.0'); assert.equal(single.methodVersion, U_VALUE_METHOD_VERSION);
assert.equal(single.correctionDetails.length, 1); assert.match(single.correctionDetails[0].working, /ΔUg/);

const two = calculateUValue({ ...input, layers: [solid('lining', 12.5, 0.21),
  solid('insulation', 89, 0.038, { name: 'Studs', lambda: 0.13, fraction: 0.118, group: 'studs', source }),
  solid('block', 125, 0.11, { name: 'Mortar', lambda: 0.88, fraction: 0.067, group: 'mortar', source }), cavity, solid('brick', 102, 0.77)], automaticCorrections: [airgap] });
near(two.upperResistance, 3.617, 0.002); near(two.lowerResistance, 3.136, 0.002); assert.equal(two.displayUValue, '0.30');
assert.equal(two.paths.length, 4);

const full = calculateUValue({ ...input, automaticCorrections: [fixing] });
near(full.correction, 0.016 * (2.5 / 2.67) ** 2);
const recessed = calculateUValue({ ...input, automaticCorrections: [{ ...fixing, penetration: 'recessed', penetrationMm: 50 }] });
near(recessed.correction, full.correction / 4);
const bridge = { name: 'Timber', lambda: 0.13, fraction: 0.15, group: 'frame', source };
near(calculateUValue({ ...input, layers: [solid('insulation', 100, 0.04, bridge)], automaticCorrections: [fixing] }).correction, full.correction);
near(calculateUValue({ ...input, automaticCorrections: [{ ...fixing, conductivity: 0.5 }] }).correction, 0);
assert.match(full.correctionDetails[0].working, /mm²/);
for (const extra of [{ applicabilityConfirmed: false }, { penetration: 'recessed', penetrationMm: 150 }, { penetration: 'recessed' }, { penetrationMm: 50 }]) {
  assert.throws(() => calculateUValue({ ...input, automaticCorrections: [{ ...fixing, ...extra }] }));
}
assert.throws(() => calculateUValue({ ...input, element: 'exposed-floor', automaticCorrections: [airgap] }), /downward heat flow/);
assert.throws(() => calculateUValue({ ...input, automaticCorrections: [airgap, airgap] }), /one air-gap/);
assert.throws(() => calculateUValue({ ...input, automaticCorrections: [{ ...airgap, layerId: 'deleted' }] }), /Choose a solid insulation/);
assert.throws(() => calculateUValue({ ...input, layers: [solid('insulation'), { ...cavity, ventilation: 'well' }, solid('outer')], automaticCorrections: [fixing] }), /ventilated boundary/);

const table = { ...cavity, airMode: 'table', resistance: null, widthMm: 2000, heightMm: 2500 };
for (const [heatFlow, expected] of [['horizontal', 0.18], ['upwards', 0.16], ['downwards', 0.21]] as const) {
  const result = calculateUValue({ ...input, heatFlow, layers: [solid('insulation'), table] });
  near(result.layerResults[1].resistance, expected);
}
const reflective = { ...table, airMode: 'emissivity', emissivity1: 0.9, emissivity2: 0.08, emissivityEvidence: 'ANIT worked example; mathematical fixture, not a product certificate' };
near(calculateUValue({ ...input, layers: [solid('insulation'), reflective] }).layerResults[1].resistance, 0.602, 0.002);
assert.throws(() => calculateUValue({ ...input, layers: [solid('insulation'), { ...reflective, emissivityEvidence: '' }] }), /emissivity_evidence/);
assert.throws(() => calculateUValue({ ...input, layers: [solid('insulation'), { ...table, widthMm: 500 }] }), /exceed 10 times/);
assert.throws(() => calculateUValue({ ...input, layers: [solid('insulation'), { ...reflective, ventilation: 'well' }, solid('outer')] }), /Reflective ventilated/);
const reversed = calculateUValue({ ...input, layers: [solid('insulation'), { ...table, ventilation: 'well' }, solid('outer')] });
near(reversed.totalResistance, 2.76); assert.deepEqual(reversed.ignoredLayerIds, ['air', 'outer']);

const membrane = { id: 'membrane', kind: 'resistance', name: 'Negligible membrane', thicknessMm: 0, resistance: 0, source };
near(calculateUValue({ ...input, layers: [membrane] }).totalResistance, 0.17);
near(calculateUValue({ ...input, layers: [membrane, solid('insulation')] }).uValue, 1 / 2.67);
const withFeatures = uValueInputSchema.parse({ ...input, layers: [solid('insulation'), reflective], automaticCorrections: [fixing, airgap] });
assert.deepEqual(uValueInputSchema.parse(draftInputs(restoredDraft(withFeatures))), withFeatures);

// Recover version-1 local drafts and snapshots without changing issued results.
const legacyDraft: any = emptyCalculation(); delete legacyDraft.automaticCorrections;
assert.deepEqual(parseStoredDraft(legacyDraft)?.automaticCorrections, []);
const legacyInput: any = { ...input, layers: [solid('insulation'), cavity] };
assert.equal(restoredDraft(legacyInput).layers[1].airMode, 'assessed');

// Deterministic varied section fractions detect alignment/unit adapter mistakes.
for (let index = 1; index <= 40; index++) {
  const fraction = 0.08 + index / 1000, thickness = 50 + index;
  const result = calculateUValue({ ...input, layers: [solid('lining', 12.5, 0.21), solid('insulation', thickness, 0.04, { ...bridge, fraction })] });
  const expected = engine({ element: 'layered_wall', heat_flow: 'horizontal', rsi: 0.13, rse: 0.04,
    fractions: [1 - fraction, fraction], omit_small_corrections: false,
    layers: [{ name: 'insulation', thickness_mm: thickness, conductivities: [0.04, 0.13] }, { name: 'lining', thickness_mm: 12.5, conductivity: 0.21 }] });
  near(result.uValue, expected.u_value);
}
console.log('PASS published timber-wall examples, correction units/applicability, cavity references, layer order, legacy drafts and 40 varied section mappings.');
