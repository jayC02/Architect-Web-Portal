import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {examples} from './catalog.mjs';
import {schemaIssues,assertSchema,inspectJson,InputError} from './schema.mjs';
import {calculateConstruction,calculateBatch,calculateProject,solveThickness,runOperation} from './calculations.mjs';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const wall={element:'layered_wall',layers:[{kind:'material',name:'Insulation',thickness_mm:100,conductivity:.04}]};
const supplied=(u)=>({element:'supplied_u',u_value_w_m2k:u,evidence:'Synthetic test assessment'});
const construction=(id)=>examples().then(a=>structuredClone(a.find(e=>e.id===id).input));

test('All 16 documented examples meet the strict schema and return finite positive U',async()=>{
  const all=await examples();assert.equal(all.length,16);
  for(const e of all){assert.deepEqual(schemaIssues(e.input),[],e.id);assert.ok(calculateConstruction(e.input).u_value>0,e.id);}
});
test('Schema accepts each material representation, rejects ambiguity and identifies typo paths',()=>{
  for(const layer of [{kind:'material',conductivity:.04,thickness_mm:100},{kind:'material',conductivities:[.04],thickness_mm:100},{kind:'material',resistance:2.5},{kind:'material',resistances:[2.5]}])assert.deepEqual(schemaIssues({...wall,layers:[layer]}),[]);
  assert.throws(()=>assertSchema({...wall,layers:[{...wall.layers[0],resistance:2.5}]}),InputError);
  const issues=schemaIssues({...wall,layers:[{...wall.layers[0],conductivty:.04}]});assert.ok(issues.some(i=>i.path==='/layers/0/conductivty'));
  assert.throws(()=>assertSchema({...wall,unknown_option:true}),InputError);
});
test('JSON boundary rejects nonfinite values, reserved keys, cycles, exotic objects and resource excess',()=>{
  for(const value of [NaN,Infinity,undefined,new Date(),JSON.parse('{"metadata":{"__proto__":{}}}')])assert.throws(()=>inspectJson(value),InputError);
  const cyclic={};cyclic.loop=cyclic;assert.throws(()=>inspectJson(cyclic),/deeply nested/);
  assert.throws(()=>inspectJson([1,2,3],{maxNodes:2}),/too many/);
  assert.throws(()=>assertSchema({...wall,layers:[{...wall.layers[0],conductivity:'0.04'}]}),InputError);
});
test('Versioned adapter preserves the 14 engine reference values and explicit H',async()=>{
  const original=JSON.parse(await readFile(new URL('../example-results.json',import.meta.url),'utf8'));
  const all=await examples();for(let i=0;i<14;i++)near(calculateConstruction(all[i].input).u_value,original[i].result.u_value);
  const r=calculateConstruction({...wall,area_m2:12});near(r.heat_loss_coefficient_w_k,12/(2.5+.17));assert.equal(r.reference_area_m2,12);
});
test('Window formula matches supplied component arithmetic and published rounded worked result',()=>{
  const input={element:'window',opening:{total_area_m2:1.82,projected_areas_non_overlapping:true,component_boundaries_consistent:true,
    components:[{kind:'glazing',area_m2:1.32,u_value_w_m2k:.7,evidence:'Published F1 Composite worked input'},
      {kind:'frame',area_m2:.50,u_value_w_m2k:1,evidence:'Published worked input'}],edges:[{length_m:4.62,psi_w_mk:.04,evidence:'Published worked input'}]}};
  const r=calculateConstruction(input);near(r.u_value,(1.32*.7+.5+4.62*.04)/1.82);assert.equal(r.u_value_2dp,.88);
  const scaled=structuredClone(input);scaled.opening.total_area_m2*=2;for(const p of scaled.opening.components)p.area_m2*=2;for(const e of scaled.opening.edges)e.length_m*=2;
  near(calculateConstruction(scaled).u_value,r.u_value);
});
test('Openings reject inconsistent areas, missing evidence, incompatible components and mismatched bridge area',async()=>{
  const w=await construction('window-components');assert.throws(()=>calculateConstruction({...w,opening:{...w.opening,total_area_m2:3}}),/sum/);
  const noEvidence=structuredClone(w);delete noEvidence.opening.components[0].evidence;assert.throws(()=>calculateConstruction(noEvidence),InputError);
  const wrong=structuredClone(w);wrong.opening.components[0].kind='panel';assert.throws(()=>calculateConstruction(wrong),/requires frame/);
  assert.throws(()=>calculateConstruction({...w,area_m2:3}),/reference area/);
  assert.throws(()=>calculateConstruction({...w,requires_numerical_analysis:true}),/numerical geometry/);
});
test('Externally supplied U remains distinguishable and assessed bridges add exactly once',()=>{
  const r=calculateConstruction({...supplied(.2),area_m2:10,detailed_bridges:[{kind:'point',chi_w_k:.1,count:2,evidence:'Assessed separately',not_already_included:true}]});
  near(r.u_value,.22);near(r.heat_loss_coefficient_w_k,2.2);assert.equal(r.method,'externally_assessed_u_value');
});
test('Batch preserves ids, exposes per-item physics errors and rejects duplicate ids',()=>{
  const r=calculateBatch({items:[{id:'ok',construction:wall},{id:'invalid-physics',construction:{...wall,fractions:[.5]}}]});
  assert.equal(r.succeeded,1);assert.equal(r.failed,1);assert.equal(r.items[1].error.code,'CALCULATION_INPUT_ERROR');
  assert.throws(()=>calculateBatch({items:[{id:'a',construction:wall},{id:'a',construction:wall}]}),/unique/);
});
test('Project subtracts openings, sums H and uses one temperature difference without rounding U',()=>{
  const r=calculateProject({elements:[{id:'wall',gross_area_m2:10,construction:supplied(.2),openings:[{id:'window',area_m2:2,construction:supplied(1.2)}]},
    {id:'roof',gross_area_m2:20,construction:supplied(.1)}],junctions:[{kind:'linear',length_m:10,psi_w_mk:.05,evidence:'Independent junction',not_already_included:true}],inside_temperature_c:20,outside_temperature_c:0});
  near(r.transmission_heat_loss_coefficient_w_k,8*.2+2*1.2+20*.1+10*.05);near(r.transmission_heat_flow_w,r.transmission_heat_loss_coefficient_w_k*20);
  near(r.area_weighted_u_value_w_m2k,r.transmission_heat_loss_coefficient_w_k/30);
});
test('Project rejects double area counting, duplicate ids, ground area scaling and incomplete temperature pair',async()=>{
  const project={elements:[{id:'wall',gross_area_m2:1,construction:wall}],junctions:[]};
  assert.throws(()=>calculateProject({...project,elements:[...project.elements,...project.elements]}),/unique/);
  assert.throws(()=>calculateProject({...project,inside_temperature_c:20}),/both temperatures/);
  assert.throws(()=>calculateProject({...project,elements:[{...project.elements[0],openings:[{id:'window',area_m2:2,construction:supplied(1)}]}]}),/exceed/);
  const slab=await construction('slab-on-ground');assert.throws(()=>calculateProject({...project,elements:[{id:'floor',gross_area_m2:1,construction:slab}]}),/reference area/);
});
test('Thickness solver finds the first passing increment and verifies the resulting construction',()=>{
  const query={construction:wall,layer_index:0,target_u_value_w_m2k:.2,minimum_thickness_mm:10,maximum_thickness_mm:300,increment_mm:5};
  const r=solveThickness(query);assert.equal(r.achievable,true);assert.equal(r.thickness_mm,195);assert.ok(r.result.u_value<=.2);
  near(calculateConstruction(r.construction).u_value,r.result.u_value);assert.ok(calculateConstruction({...wall,layers:[{...wall.layers[0],thickness_mm:190}]}).u_value>.2);
  assert.ok(r.evaluations<=12);assert.equal(wall.layers[0].thickness_mm,100);
});
test('Thickness boundaries include existing success, unreachable targets, short grids and invalid selections',()=>{
  const query={construction:wall,layer_index:0,target_u_value_w_m2k:1,minimum_thickness_mm:100,maximum_thickness_mm:101,increment_mm:5};
  assert.equal(solveThickness(query).thickness_mm,100);
  assert.equal(solveThickness({...query,target_u_value_w_m2k:.01}).achievable,false);
  assert.throws(()=>solveThickness({...query,maximum_thickness_mm:10}),/Maximum/);
  assert.throws(()=>solveThickness({...query,layer_index:12}),/Select a material/);
  assert.throws(()=>solveThickness({...query,increment_mm:1e-12}),/too many increments/);
});
test('Thickness search finds an intermediate passing value even when correction effects make both endpoints fail',()=>{
  const c={element:'layered_wall',layers:[{resistance:20},{conductivity:.04,thickness_mm:10}],
    corrections:[{kind:'airgap',layer_index:1,level:2}],omit_small_corrections:false};
  const r=solveThickness({construction:c,layer_index:1,target_u_value_w_m2k:.035,minimum_thickness_mm:10,maximum_thickness_mm:10000,increment_mm:10});
  assert.equal(r.achievable,true);assert.equal(r.search_method,'exhaustive_grid');assert.equal(r.thickness_mm,750);
  assert.ok(calculateConstruction({...c,layers:[c.layers[0],{...c.layers[1],thickness_mm:10000}]}).u_value>.035);
});
test('Numerical responses omit cell fields by default and include them only when requested',async()=>{
  const mesh=await construction('steel-mesh');const small=calculateConstruction(mesh),full=calculateConstruction(mesh,{include_mesh_fields:true});
  near(small.u_value,full.u_value);assert.equal(small.temperatures_c,undefined);assert.ok(full.temperatures_c.length);assert.equal(small.mesh_fields_included,false);
});
test('Validation includes physical checks and all operations share the versioned contract',()=>{
  assert.equal(runOperation('validate',{construction:wall}).valid,true);
  assert.throws(()=>runOperation('validate',{construction:{...wall,fractions:[.8]}}),InputError);
  assert.throws(()=>runOperation('calculate',{construction:wall,unrecognized:true}),InputError);
});
