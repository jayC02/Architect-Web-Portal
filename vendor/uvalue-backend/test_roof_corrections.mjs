import test from 'node:test';
import assert from 'node:assert/strict';
import {invertedRoofRainCorrection} from './roof_corrections.mjs';
const data = {rainfall_mm_per_day:3, fx_w_day_m2k_mm:.04,
  insulation_resistance_above_membrane:4, total_resistance:5,
  rainfall_evidence:'Synthetic verification input: 3 mm/day',
  drainage_evidence:'BBA Information 4 butt-jointed boards/open cover, f=1 and x=.04',
  design_conductivity_evidence:'Synthetic verification input; R above membrane=4'};
test('Rain correction has independent hand-calculated magnitude and squared R ratio',()=>{
  assert.ok(Math.abs(invertedRoofRainCorrection(data)-.0768)<1e-12);
  assert.ok(Math.abs(invertedRoofRainCorrection({...data,total_resistance:10})-.0192)<1e-12);
});
test('Water-flow reduction and zero rainfall boundaries',()=>{
  assert.ok(Math.abs(invertedRoofRainCorrection({...data,fx_w_day_m2k_mm:.001})-.00192)<1e-12);
  assert.equal(invertedRoofRainCorrection({...data,rainfall_mm_per_day:0}),0);
});
test('Reject unjustified factors, impossible resistance ratio and missing provenance',()=>{
  assert.throws(()=>invertedRoofRainCorrection({...data,fx_w_day_m2k_mm:0}),/positive/);
  assert.throws(()=>invertedRoofRainCorrection({...data,fx_w_day_m2k_mm:.05}),/exceeds/);
  assert.throws(()=>invertedRoofRainCorrection({...data,total_resistance:3}),/exceeds/);
  assert.throws(()=>invertedRoofRainCorrection({...data,drainage_evidence:''}),/required/);
});
