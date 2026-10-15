import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateConstruction,runOperation} from './calculations.mjs';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const construction={element:'supplied_u',u_value_w_m2k:1,evidence:'Synthetic consistently bounded component'};
const common={no_heat_gains:true,all_external_paths_to_same_temperature:true,component_boundaries_consistent:true};
const solve=input=>runOperation('unheated-network',{...common,...input});

test('One unheated node recovers the independently published two-node reduction factor',()=>{
  const r=solve({nodes:[{id:'garage',external_heat_loss_coefficient_w_k:3.05}],inside_elements:[{id:'wall',node_id:'garage',area_m2:8.16,construction}],links:[],inside_temperature_c:20,outside_temperature_c:0});
  near(r.inside_elements[0].effective_u_value_w_m2k,3.05/(8.16+3.05));near(r.effective_heat_loss_coefficient_w_k,8.16*3.05/11.21);
  assert.ok(r.relative_heat_imbalance<1e-12);
});
test('Coupled spaces match an independent 2x2 solution and conserve heat',()=>{
  const r=solve({nodes:[{id:'A',external_heat_loss_coefficient_w_k:10},{id:'B',external_heat_loss_coefficient_w_k:20}],
    inside_elements:[{id:'wall',node_id:'A',area_m2:10,construction}],links:[{from_node_id:'A',to_node_id:'B',heat_loss_coefficient_w_k:5}],inside_temperature_c:20,outside_temperature_c:0});
  near(r.nodes[0].normalized_temperature,10/24);near(r.nodes[1].normalized_temperature,2/24);
  near(r.effective_heat_loss_coefficient_w_k,10*(1-10/24));near(r.external_heat_loss_coefficient_w_k,10*10/24+20*2/24);
  near(r.nodes[1].temperature_c,20*2/24);assert.ok(r.relative_heat_imbalance<1e-12);
});
test('Unequal boundary U-values share one space reduction without fabricating equal-U assumptions',()=>{
  const r=solve({nodes:[{id:'A',external_heat_loss_coefficient_w_k:10}],inside_elements:[{id:'a',node_id:'A',area_m2:10,construction},
    {id:'b',node_id:'A',area_m2:10,construction:{...construction,u_value_w_m2k:.5}}],links:[]});
  near(r.inside_elements[0].temperature_reduction_factor,.4);near(r.inside_elements[1].effective_u_value_w_m2k,.2);near(r.effective_heat_loss_coefficient_w_k,6);
});
test('A warm-only anchored space has no exterior heat loss; isolated unanchored nodes reject',()=>{
  const input={nodes:[{id:'A',external_heat_loss_coefficient_w_k:0}],inside_elements:[{id:'wall',node_id:'A',area_m2:10,construction}],links:[]};
  near(solve(input).effective_heat_loss_coefficient_w_k,0);
  assert.throws(()=>solve({...input,nodes:[...input.nodes,{id:'isolated',external_heat_loss_coefficient_w_k:0}]}),/unanchored/);
});
test('Network validates node references, ids, passive assumptions and inside boundary surface R',()=>{
  const input={nodes:[{id:'A',external_heat_loss_coefficient_w_k:10}],inside_elements:[{id:'wall',node_id:'A',area_m2:10,construction}],links:[]};
  assert.throws(()=>solve({...input,links:[{from_node_id:'A',to_node_id:'missing',heat_loss_coefficient_w_k:1}]}),/Unknown/);
  assert.throws(()=>solve({...input,nodes:[...input.nodes,...input.nodes]}),/unique/);
  assert.throws(()=>solve({...input,no_heat_gains:false}),/contract/);
  assert.throws(()=>solve({...input,inside_elements:[{...input.inside_elements[0],construction:{element:'layered_wall',layers:[{resistance:2.5}]}}]}),/still-air/);
});
test('Ventilated cavity exception fields remain available through the strict API schema',()=>{
  const r=calculateConstruction({element:'layered_wall',layers:[{kind:'material',thickness_mm:100,conductivity:.77},
    {kind:'air',thickness_mm:25,width_mm:3000,height_mm:3000,orientation:'vertical',opening_area_mm2_per_m:100,
      openings_allow_through_flow:false,insulation_between_cavity_and_exterior:false},
    {kind:'material',thickness_mm:100,conductivity:.04}]});assert.ok(r.u_value>0);
});
