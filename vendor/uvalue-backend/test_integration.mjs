import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateUValue} from './uvalue_engine.mjs';
const near=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const wall={element:'layered_wall',layers:[{resistance:.5},
  {kind:'air',thickness_mm:50,width_mm:3000,height_mm:2400,orientation:'vertical',
    opening_area_mm2_per_m:1000,openings_allow_through_flow:true},
  {resistance:2.5}]};
const ground={area_m2:63.4375,exposed_perimeter_m:23.25,wall_thickness_m:.35,
  soil_conductivity_w_mk:2,rsi_m2k_w:.17,rse_m2k_w:.04,basement_depth_m:0,edge_insulation:'none'};
const roof={element:'layered_roof',layers:[{name:'Above-membrane insulation (synthetic)',resistance:4},
  {name:'Deck and internal finish (synthetic)',resistance:.86}]};
const rain={kind:'inverted_roof_rain',layer_indices:[0],rainfall_mm_per_day:3,fx_w_day_m2k_mm:.04,
  ballast_excluded:true,rainfall_evidence:'Synthetic verification input',
  drainage_evidence:'BBA Information 4 f=1,x=.04',design_conductivity_evidence:'Synthetic verification R input'};

test('Calculated high-emissivity cavity preserves Scottish timber-wall reference',()=>{
  const timber=JSON.parse(readFileSync(new URL('./example-timber-wall.json',import.meta.url)));
  timber.layers[1]={kind:'air',thickness_mm:50,width_mm:3000,height_mm:2400};
  near(calculateUValue(timber).u_value,.2968006937291516);
});
test('Slight ventilation blends complete construction R, not U or cavity R',()=>{
  const r=calculateUValue(wall);
  // Full endpoint: .13 + .04 + .5 + .18 + 2.5 = 3.35.
  // Sheltered endpoint: .13 + .13 + 2.5 = 2.76. At A=1000, R=3.055.
  near(r.r_total,3.055);near(r.u_value,1/3.055);
  near(r.ventilation.unventilated_endpoint.r_total,3.35);
  near(r.ventilation.well_ventilated_endpoint.r_total,2.76);
  assert.equal(r.path_resistances,null);
});
test('Well-ventilated cavity removes outward layers and uses sheltered surface R',()=>{
  const input=structuredClone(wall);input.layers[1].opening_area_mm2_per_m=1500;
  const a=calculateUValue(input);input.layers[0].resistance=100;
  near(a.u_value,1/2.76);near(calculateUValue(input).u_value,a.u_value);
  assert.deepEqual(a.ventilation.disregard_layer_indices_for_well_ventilated,[0,1]);
});
test('Slab dispatcher derives construction R without adding surface resistances twice',()=>{
  const r=calculateUValue({element:'slab_on_ground',ground,layers:[{thickness_mm:100,conductivity:.020}]});
  near(r.floor_resistance_m2k_w,5);near(r.u_value,.15078584963975558);
  assert.equal(r.u_value_2dp,.15);
  const supplied=calculateUValue({element:'slab_on_ground',ground:{...ground,floor_resistance_m2k_w:5}});
  near(supplied.u_value,r.u_value);
});
test('Suspended dispatcher counts each deck surface once and separates underfloor ground path',()=>{
  const r=calculateUValue({element:'suspended_ground_floor',layers:[{resistance:.2}],ground:{
    area_m2:80,exposed_perimeter_m:40,wall_thickness_m:.3,soil_conductivity_w_mk:1.5,
    rsi_m2k_w:.17,rse_m2k_w:.04,edge_insulation:'none',floor_height_m:.3,
    underfloor_wall_u_value_w_m2k:1.5,ventilation_opening_area_per_perimeter_m2_m:.003,
    annual_wind_speed_10m_m_s:5,wind_shielding_factor:.05,ventilation:'natural',base_depth_m:0,
    base_insulation_resistance_m2k_w:0}});
  near(r.deck_u_value_w_m2k,1/.54);near(r.u_value,.7261029951014984);
  near(r.equivalent_ground_thickness_m,.615);
});
test('Inverted roof applies rain correction and combines the small-correction threshold',()=>{
  const a=calculateUValue({...roof,corrections:[rain]});
  near(a.u_uncorrected,.2);near(a.delta_u_total,.0768);near(a.u_value,.2768);
  assert.equal(a.corrections[0].drainage_evidence,rain.drainage_evidence);
  const reduced=calculateUValue({...roof,corrections:[{...rain,fx_w_day_m2k_mm:.001}]});
  near(reduced.delta_u_total,.00192);assert.equal(reduced.corrections_omitted,true);
  const smallRoof={...roof,layers:[{resistance:3},{resistance:1.86}]};
  const combined=calculateUValue({...smallRoof,corrections:[{...rain,fx_w_day_m2k_mm:.003},
    {kind:'airgap',layer_index:0,level:1}]});
  near(combined.delta_u_total,.00684);assert.equal(combined.corrections_omitted,false);
  near(combined.u_value,.20684);
});
test('Reject ambiguous ground, ventilation and correction combinations',()=>{
  assert.throws(()=>calculateUValue({...wall,corrections:[{kind:'airgap',layer_index:2,level:1}]}),/separate validation/);
  assert.throws(()=>calculateUValue({...wall,ground}),/explicit ground-floor/);
  assert.throws(()=>calculateUValue({element:'slab_on_ground',ground:{...ground,floor_resistance_m2k_w:5},layers:[{resistance:5}]}),/not both/);
  assert.throws(()=>calculateUValue({element:'slab_on_ground',ground,fractions:[.8,.2],layers:[{resistances:[5,1]}]}),/homogeneous/);
  assert.throws(()=>calculateUValue({...roof,element:'exposed_floor',corrections:[rain]}),/requires a roof/);
  assert.throws(()=>calculateUValue({...roof,corrections:[{...rain,ballast_excluded:false}]}),/ballast_excluded/);
  assert.throws(()=>calculateUValue({...roof,corrections:[rain,rain]}),/one inverted-roof/);
  assert.throws(()=>calculateUValue({...roof,element:'exposed_floor',corrections:[{kind:'airgap',layer_index:0,level:1}]}),/downward/);
  assert.throws(()=>calculateUValue({...wall,layers:[wall.layers[0],{...wall.layers[1],ventilation:'well_ventilated'},wall.layers[2]]}),/does not match/);
  assert.throws(()=>calculateUValue({...wall,layers:[wall.layers[0],{...wall.layers[1],mechanical_ventilation:true},wall.layers[2]]}),/Mechanical/);
  assert.throws(()=>calculateUValue({...wall,layers:[wall.layers[0],{...wall.layers[1],method:'iso_6946_annex_d',
    emissivity_2:.2},wall.layers[2]]}),/exposed_surface_emissivity/);
});
