import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateUValue,airGapCorrection,fastenerCorrection} from './uvalue_engine.mjs';
const timber=JSON.parse(readFileSync(new URL('./example-timber-wall.json',import.meta.url)));
const near=(actual,expected,tolerance)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);

test('Scottish Government single bridged layer worked example, including correction omission',()=>{
  const r=calculateUValue(timber);
  near(r.r_upper,3.435,0.001);near(r.r_lower,3.304,0.001);near(r.r_total,3.369,0.001);
  near(r.delta_u_total,0.006,0.0005);assert.equal(r.corrections_omitted,true);
  assert.equal(r.u_value_2dp,0.30);assert.equal(r.total_thickness_mm,313.5);
});

test('Scottish Government two bridged layers; use exact intersection fractions',()=>{
  const fractions=[.933*.882,.067*.882,.933*.118,.067*.118];
  const r=calculateUValue({element:'layered_wall',fractions,layers:[
    {thickness_mm:102,conductivity:.77},{thickness_mm:50,resistance:.18},
    {thickness_mm:125,conductivities:[.11,.88,.11,.88]},
    {thickness_mm:89,conductivities:[.038,.038,.13,.13]},
    {thickness_mm:12.5,conductivity:.21}],corrections:[{kind:'airgap',layer_index:3,level:1}]});
  // Published document has inconsistent intermediate totals; compare physical
  // input table and independently calculated result, not its typographical errors.
  near(r.r_upper,3.617,0.002);near(r.r_lower,3.136,0.002);
  assert.equal(r.u_value_2dp,.30);assert.equal(r.corrections_omitted,true);
});

test('Homogeneous limit and arbitrary section splitting preserve U',()=>{
  const plain={element:'layered_wall',layers:[{thickness_mm:100,conductivity:.04}]};
  const a=calculateUValue(plain),b=calculateUValue({...plain,fractions:[.2,.3,.5]});
  near(a.u_value,1/2.67,1e-12);near(a.r_upper,a.r_lower,1e-12);near(a.u_value,b.u_value,1e-12);
});

test('Insulation improvement decreases U; section order does not matter',()=>{
  const a=calculateUValue(timber);const changed=structuredClone(timber);changed.layers[3].thickness_mm=200;
  assert.ok(calculateUValue(changed).u_value<a.u_value);
  const reordered=structuredClone(timber);reordered.fractions.reverse();reordered.layers[3].conductivities.reverse();
  near(calculateUValue(reordered).u_value,a.u_value,1e-12);
});

test('Corrections combine before applying the 3% omission threshold',()=>{
  const base={element:'layered_wall',layers:[{thickness_mm:100,conductivity:.04}]};
  const single=calculateUValue({...base,corrections:[{kind:'airgap',layer_index:0,level:1}]});
  const fastener={kind:'fastener',layer_index:0,conductivity:50,area_mm2:10,count_per_m2:1.2};
  const fastenerOnly=calculateUValue({...base,corrections:[fastener]});
  const combined=calculateUValue({...base,corrections:[{kind:'airgap',layer_index:0,level:1},fastener]});
  assert.equal(single.corrections_omitted,true);assert.equal(fastenerOnly.corrections_omitted,true);
  assert.equal(combined.corrections_omitted,false);assert.ok(combined.u_value>single.u_value);
});

test('Full-depth fastener units and zero-density boundary',()=>{
  const data={conductivity:50,area_mm2:10,count_per_m2:4,insulation_thickness_mm:100,insulation_resistance:2.5,total_resistance:2.5};
  // Hand calculation: 0.8 * 50 * 0.000010 * 4 / 0.100 = 0.016.
  near(fastenerCorrection(data),.016,1e-12);
  assert.equal(fastenerCorrection({...data,count_per_m2:0}),0);
  assert.equal(airGapCorrection(0,2.5,2.67),0);
});

test('Reject unsupported physical cases and bad input instead of returning plausible U',()=>{
  assert.throws(()=>calculateUValue({...timber,element:'ground_floor'}),/Ground floors/);
  assert.throws(()=>calculateUValue({...timber,fractions:[.9,.15]}),/sum to 1/);
  assert.throws(()=>calculateUValue({...timber,layers:[{thickness_mm:100,conductivity:0}]}),/positive/);
  assert.throws(()=>calculateUValue({...timber,layers:[{thickness_mm:100,conductivities:[.04]}]}),/section count/);
  assert.throws(()=>calculateUValue({...timber,layers:[{resistance:.18,ventilation:'well_ventilated'}]}),/outside/);
  assert.throws(()=>calculateUValue({...timber,corrections:[{kind:'airgap',layer_index:99,level:1}]}),/invalid/);
});
