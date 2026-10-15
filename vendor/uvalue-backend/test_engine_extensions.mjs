import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {calculateUValue}from'./uvalue_engine.mjs';
import {createMaterialMesh}from'./thermal_mesh.mjs';
const fixture=n=>JSON.parse(readFileSync(new URL('./'+n,import.meta.url),'utf8'));
const near=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
test('Rafter dispatcher retains SEAI flat-ceiling result and separate ceiling layers',()=>{
  const r=calculateUValue(fixture('example-rafter-roof.json'));assert.equal(r.u_value_2dp,.18);
  near(r.ceiling_construction.r_total,.15);assert.equal(r.area_basis,'flat_ceiling');
});
test('Roof local-area allowances remain included below the ISO correction omission threshold',()=>{
  const roof={element:'layered_roof',layers:[{resistance:4.86}],roof_allowances:{hatch:{insulation_thickness_mm:50,insulation_conductivity_w_mk:.04}}};
  near(calculateUValue(roof).u_value,.203);
  assert.throws(()=>calculateUValue({...roof,roof_inclusions:{total_area_m2:10,inclusions:[]}}),/double counting/);
});
test('Unheated-space dispatcher applies published b factor with matching cold-side surface',()=>{
  const r=calculateUValue(fixture('example-unheated-space-wall.json'));
  near(r.unheated_space_adjustment.adjustment_factor,3.05/(8.16+3.05));
  near(r.u_value,r.u_inside_to_unheated*3.05/11.21);
  assert.throws(()=>calculateUValue({...fixture('example-unheated-space-wall.json'),rse:.04}),/still-air/);
});
test('Detailed bridge heat loss uses explicit reference area and is never silently omitted',()=>{
  const construction={element:'layered_wall',area_m2:10,layers:[{resistance:2.5}],
    detailed_bridges:[{kind:'point',chi_w_k:.001,count:1,evidence:'Synthetic independently assessed point bridge',not_already_included:true}]};
  near(calculateUValue(construction).u_value,1/2.67+.0001);
  assert.throws(()=>calculateUValue({...construction,detailed_bridges:[{...construction.detailed_bridges[0],not_already_included:false}]}),/not_already/);
  const roof=calculateUValue({...construction,element:'layered_roof',layers:[{resistance:4.86}],
    detailed_bridges:[{kind:'point',chi_w_k:.1,count:1,evidence:'Synthetic bridge',not_already_included:true}],
    roof_inclusions:{total_area_m2:10,inclusions:[{area_m2:1,u_value_w_m2k:2}]}});
  near(roof.u_value,.39);near(roof.heat_loss_coefficient_w_k,3.9);
});
test('Basement dispatch separates deck, basement floor and wall paths',()=>{
  const heated=calculateUValue(fixture('example-heated-basement.json'));
  near(heated.floor_resistance_m2k_w,4);near(heated.wall_resistance_m2k_w,80/1000/.03+.2/2);
  near(heated.u_value,heated.heat_loss_coefficient_w_k/(80+2*36));
  const unheated=calculateUValue(fixture('example-unheated-basement.json'));
  near(unheated.floor_resistance_m2k_w,.1);near(unheated.deck_u_value_w_m2k,1/(.34+2.5+.022/.13));
});
test('Recessed correction dispatcher uses metallic depth and homogeneous path R',()=>{
  const r=calculateUValue(fixture('example-recessed-fastener.json'));near(r.delta_u_total,.001);near(r.u_value,.251);
  const bridged={element:'layered_wall',fractions:[.9,.1],layers:[{thickness_mm:100,conductivities:[.04,.13]}],
    corrections:[{kind:'fastener',layer_index:0,conductivity:50,area_mm2:10,count_per_m2:4}],omit_small_corrections:false};
  assert.throws(()=>calculateUValue(bridged),/unbridged_section_index/);
  const r2=calculateUValue({...bridged,corrections:[{...bridged.corrections[0],unbridged_section_index:0}]});
  near(r2.delta_u_total,.016*(2.5/2.67)**2);
});
test('Numerical metal geometry resolves the physical regions and converges under refinement',()=>{
  const input=fixture('example-steel-mesh.json');const r=calculateUValue(input);
  assert.equal(r.u_value_2dp,.27);assert.ok(r.mesh_relative_change<=.005);assert.ok(r.relative_heat_imbalance<1e-5);
  const mesh=createMaterialMesh(input.mesh.geometry);assert.ok(mesh.conductivities.flat().includes(50));
  const g={width_mm:10,height_mm:10,base_conductivity_w_mk:.04,max_cell_size_mm:1,regions:[]};
  assert.throws(()=>createMaterialMesh({...g,max_cell_size_mm:1e-12}),/512/);
  assert.throws(()=>createMaterialMesh({...g,regions:[{x_mm:0,y_mm:0,width_mm:20,height_mm:5,conductivity_w_mk:.2}]}),/exceeds/);
});
test('Combined method refuses marked metal bridges and invalid resistance-limit spread',()=>{
  assert.throws(()=>calculateUValue({element:'layered_wall',layers:[{resistance:2.5,linear_metal_bridge:true}]}),/numerical/);
  assert.throws(()=>calculateUValue({element:'layered_wall',fractions:[.5,.5],layers:[{resistances:[100,.01]}]}),/more than 1.5/);
});
