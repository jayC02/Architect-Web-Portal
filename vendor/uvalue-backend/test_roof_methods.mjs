import test from 'node:test';
import assert from 'node:assert/strict';
import {taperedRegionUValue,calculateTaperedRoof,roofSpaceResistance,
  calculateCeilingInsulatedRoof,calculateRafterRoofOverFlatCeiling,
  roofAreaWeightedUValue,recessedLightCorrection,loftHatchDefaultCorrection,
  discreteFastenerCorrection,unheatedSpaceAdjustment,unheatedSpaceResistance} from './roof_methods.mjs';
const close=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const region=(shape,thicknesses_mm,extra={})=>taperedRegionUValue({shape,thicknesses_mm,
  base_resistance_m2k_w:1,conductivity_w_mk:1,...extra});
const roofSpace={roof_covering:'sheeted_or_tiles_with_underlay',ventilation:'natural',external_envelope_insulated:false};

// Independent integration over the reference triangle using the Duffy mapping.
// Neither the closed-form taper equations nor the implementation's subdivision
// is used here; local U=1/R is integrated directly over uniformly sampled area.
function integrateTriangle(rs,n=700) {
  let sum=0;
  for(let i=0;i<n;i++) {
    const x=(i+.5)/n;
    for(let j=0;j<n;j++) {
      const y=(1-x)*(j+.5)/n;
      sum+=2*(1-x)/(rs[0]+(rs[1]-rs[0])*x+(rs[2]-rs[0])*y);
    }
  }
  return sum/(n*n);
}

test('one-way rectangular taper has analytic harmonic area mean',()=>{
  close(region('rectangle',[0,1000]).u_value,Math.LN2);
  close(region('rectangle',[1000,0]).u_value,Math.LN2);
  // CSTB Avis 5.2/18-2595_V1, table 4.1 zone 1: R0=4.374, R2=.167,
  // reported U=.22. Use its resistance inputs, avoiding rounded material data.
  const published=region('rectangle',[0,167],{base_resistance_m2k_w:4.374});
  assert.equal(published.u_value_2dp,.22);
});

test('triangle orientation changes the area-weighted result',()=>{
  close(region('triangle',[0,0,1000]).u_value,4*Math.LN2-2);
  close(region('triangle',[0,1000,1000]).u_value,2-2*Math.LN2);
  assert.ok(region('triangle',[0,0,1000]).u_value>region('triangle',[0,1000,1000]).u_value);
});

test('all triangle profiles match independent direct area integration',()=>{
  for(const ds of [[0,0,1000],[0,1000,1000],[0,1000,2000],[2000,0,1000],[1000,1000.00001,0],[100,600,1800]]) {
    const result=region('triangle',ds);
    close(result.u_value,integrateTriangle(ds.map(d=>1+d/1000)),2e-6);
  }
  close(region('triangle',[0,1000,2000]).u_value,3*Math.log(3)-4*Math.LN2);
});

test('zero and tiny tapers stay finite and recover the uniform layer limit',()=>{
  for(const shape of ['rectangle','triangle']) {
    const ds=shape==='rectangle' ? [100,100] : [100,100,100];
    close(region(shape,ds).u_value,1/1.1);
    ds[ds.length-1]+=1e-8;
    const calculated=region(shape,ds).u_value;
    assert.ok(Number.isFinite(calculated));
    close(calculated,1/1.1,1e-10);
  }
  const almostPaired=region('triangle',[0,1e-12,1000]);
  close(almostPaired.u_value,4*Math.LN2-2);
});

test('taper regions are weighted by heat flow and preserve region splitting',()=>{
  const input={base_resistance_m2k_w:1,conductivity_w_mk:1,regions_partition_roof:true,
    regions:[{shape:'rectangle',area_m2:60,thicknesses_mm:[0,1000]},
      {shape:'triangle',area_m2:40,thicknesses_mm:[0,0,1000]}]};
  const r=calculateTaperedRoof(input);
  close(r.u_value,.6*Math.LN2+.4*(4*Math.LN2-2));
  close(r.heat_loss_coefficient_w_k,r.u_value*100);
  close(r.r_total,1/r.u_value);
  const split=calculateTaperedRoof({...input,regions:[{...input.regions[0],area_m2:30},
    {...input.regions[0],area_m2:30},input.regions[1]]});
  close(split.u_value,r.u_value);
});

test('taper method rejects unsupported geometry and unvalidated local corrections',()=>{
  for(const overrides of [{shape:'hip'}, {thicknesses_mm:[0]}, {thicknesses_mm:[-1,1000]},
    {conductivity_w_mk:0}, {base_resistance_m2k_w:0}, {requires_numerical_analysis:true}]) {
    assert.throws(()=>region('rectangle',[0,1000],overrides));
  }
  assert.throws(()=>calculateTaperedRoof({base_resistance_m2k_w:1,conductivity_w_mk:1,
    regions:[{shape:'rectangle',area_m2:1,thicknesses_mm:[0,1000]}]}),/partition/);
  assert.throws(()=>calculateTaperedRoof({base_resistance_m2k_w:1,conductivity_w_mk:1,
    regions_partition_roof:true,regions:[{shape:'rectangle',area_m2:1,thicknesses_mm:[0,1000]}],corrections:[{kind:'fastener'}]}),/locally/);
});

test('ISO roof-space table includes roof covering and excludes outside surface',()=>{
  for(const [covering,r] of Object.entries({tiles_no_underlay:.06,sheeted_or_tiles_with_underlay:.20,
    low_emissivity_underlay:.30,boards_and_felt:.30})) {
    const result=roofSpaceResistance({...roofSpace,roof_covering:covering});
    close(result.resistance_m2k_w,r);
    assert.equal(result.includes_external_surface,false);
  }
  assert.throws(()=>roofSpaceResistance({...roofSpace,ventilation:'mechanical'}),/natural/);
  assert.throws(()=>roofSpaceResistance({...roofSpace,external_envelope_insulated:true}),/insulated/);
});

test('ceiling insulation adds the roof space and exterior surface once',()=>{
  const r=calculateCeilingInsulatedRoof({ceiling_resistance_m2k_w:5.10,roof_space:roofSpace});
  close(r.r_total,5.34);
  close(r.u_value,1/5.34);
  const bridged=calculateCeilingInsulatedRoof({ceiling_path_resistances_m2k_w:[5.10,1.10],
    fractions:[.9,.1],ceiling_lower_resistance_m2k_w:.10+1/(.9/5+.1/1),roof_space:roofSpace});
  close(bridged.r_upper,1/(.9/5.34+.1/1.34));
  close(bridged.r_lower,.34+1/(.9/5+.1));
});

test('SEAI rafter-insulated roof with a flat ceiling transforms sloped layers and Rse',()=>{
  // SEAI DEAP June2025 example 2 pp77–78: lambda=.025/.13, 120mm
  // between rafters, 50mm below, 8% timber, 30-degree pitch, flat plaster .05.
  const f=[.92,.08];
  const paths=[.04+4.8+2,.04+.12/.13+2];
  const lower=.04+1/(.92/4.8+.08/(.12/.13))+2;
  const result=calculateRafterRoofOverFlatCeiling({roof_path_resistances_m2k_w:paths,
    fractions:f,roof_lower_resistance_m2k_w:lower,ceiling_resistance_m2k_w:.15,pitch_degrees:30});
  // Independent arithmetic with the publication's rounded resistance table.
  const upperTable=1/(.92/(.035+4.157+1.732+.16+.05+.10)+
    .08/(.035+.799+1.732+.16+.05+.10));
  const lowerTable=.035+1/(.92/4.157+.08/.799)+1.732+.16+.05+.10;
  close(result.r_upper,upperTable,.002);
  close(result.r_lower,lowerTable,.002);
  assert.equal(result.area_basis,'flat_ceiling');
  assert.equal(result.u_value_2dp,.18);
  assert.throws(()=>calculateRafterRoofOverFlatCeiling({roof_resistance_m2k_w:6,
    ceiling_resistance_m2k_w:.15,pitch_degrees:90}),/less than 90/);
});

test('rafter roof homogeneous limit avoids shifting an averaged bridged resistance',()=>{
  const result=calculateRafterRoofOverFlatCeiling({roof_resistance_m2k_w:4,
    ceiling_resistance_m2k_w:.15,pitch_degrees:60});
  close(result.r_total,2.31);
  close(result.u_value,1/2.31);
  assert.throws(()=>calculateRafterRoofOverFlatCeiling({roof_resistance_m2k_w:4,
    fractions:[1],ceiling_resistance_m2k_w:.15,pitch_degrees:60}),/not both/);
});

test('hatches and local light fitting areas use gross-area heat-flow weighting',()=>{
  const result=roofAreaWeightedUValue({total_area_m2:100,main_u_value_w_m2k:.15,
    areas_non_overlapping:true,inclusions:[{name:'Hatch',area_m2:1,u_value_w_m2k:1.5},
      {name:'Uninsulated light surroundings',area_m2:2,u_value_w_m2k:2}]});
  close(result.heat_loss_coefficient_w_k,20.05);
  close(result.u_value,.2005);
  close(result.delta_u,.0505);
  const lightOnly=roofAreaWeightedUValue({total_area_m2:100,main_u_value_w_m2k:.15,
    inclusions:[{area_m2:2,u_value_w_m2k:2}]});
  close(lightOnly.delta_u,recessedLightCorrection({roof_u_value_w_m2k:.15,removed_insulation_fraction:.02}));
  assert.throws(()=>roofAreaWeightedUValue({total_area_m2:1,main_u_value_w_m2k:.15,
    inclusions:[{area_m2:2,u_value_w_m2k:2}]}),/exceed/);
});

test('BR443 hatch/light allowances preserve their stated applicability',()=>{
  for(const [d,delta] of [[0,.015],[25,.006],[50,.003]]) {
    close(loftHatchDefaultCorrection({insulation_thickness_mm:d,insulation_conductivity_w_mk:.04}),delta);
  }
  assert.throws(()=>loftHatchDefaultCorrection({insulation_thickness_mm:30,insulation_conductivity_w_mk:.04}),/exactly/);
  assert.throws(()=>loftHatchDefaultCorrection({insulation_thickness_mm:25,insulation_conductivity_w_mk:.02}),/0.040/);
  assert.throws(()=>recessedLightCorrection({roof_u_value_w_m2k:3,removed_insulation_fraction:.1}),/2.0/);
});

const fastener={fastener_conductivity_w_mk:50,cross_section_area_mm2:10,count_per_m2:4,
  insulation_thickness_mm:100,insulation_conductivity_w_mk:.05,total_homogeneous_resistance_m2k_w:4,
  both_ends_contact_metal:false};
test('full/recessed fasteners use penetrated R and consistent mm-to-SI units',()=>{
  const full=discreteFastenerCorrection(fastener);
  close(full.delta_u,.004);
  close(full.alpha,.8);
  const half=discreteFastenerCorrection({...fastener,metal_penetration_mm:50});
  close(half.delta_u,.001);
  close(half.penetrated_insulation_resistance_m2k_w,1);
  close(half.alpha,.4);
  close(discreteFastenerCorrection({...fastener,count_per_m2:0}).delta_u,0);
  close(discreteFastenerCorrection({...fastener,fastener_conductivity_w_mk:.2}).delta_u,0);
});

test('fastener helper rejects sheet-contact, arbitrary angle and impossible penetrations',()=>{
  for(const change of [{both_ends_contact_metal:true},{both_ends_contact_metal:undefined},
    {angle_degrees:15},{metal_penetration_mm:120},{metal_penetration_mm:0},
    {total_homogeneous_resistance_m2k_w:1}]) assert.throws(()=>discreteFastenerCorrection({...fastener,...change}));
});

test('unheated-space balance matches published CYPE ISO13789 example and heat conservation',()=>{
  // CYPE April2026 p3: Hiu=8.16, Hue=3.05; published b=.27.
  const result=unheatedSpaceAdjustment({h_inside_to_unheated_w_k:8.16,h_unheated_to_outside_w_k:3.05,
    boundary_u_value_w_m2k:.48,inside_temperature_c:20,outside_temperature_c:0});
  close(result.adjustment_factor,3.05/11.21);
  assert.equal(Number(result.adjustment_factor.toFixed(2)),.27);
  close(result.effective_heat_loss_coefficient_w_k,.48*0+8.16*3.05/11.21);
  close(8.16*(20-result.unheated_temperature_c),3.05*result.unheated_temperature_c);
  close(result.u_value,.48*result.adjustment_factor);
  const isolated=unheatedSpaceAdjustment({h_inside_to_unheated_w_k:10,h_unheated_to_outside_w_k:0,
    boundary_u_value_w_m2k:.5});
  close(isolated.u_value,0);
});

test('simplified unheated-space Ru equals the H-balance when boundary U is uniform',()=>{
  const input={inside_area_m2:20,outside_elements:[{area_m2:30,u_value_w_m2k:2},
    {area_m2:10,u_value_w_m2k:3}],air_changes_per_hour:3,volume_m3:50,
    external_envelope_insulated:false,internal_elements_same_u_value:true};
  const ru=unheatedSpaceResistance(input);
  close(ru.h_unheated_to_outside_w_k,139.5);
  close(ru.resistance_m2k_w,20/139.5);
  const adjusted=unheatedSpaceAdjustment({h_inside_to_unheated_w_k:20*.4,
    h_unheated_to_outside_w_k:139.5,boundary_u_value_w_m2k:.4});
  close(adjusted.u_value,1/(1/.4+ru.resistance_m2k_w));
  assert.throws(()=>unheatedSpaceResistance({...input,external_envelope_insulated:true}),/uninsulated/);
  assert.throws(()=>unheatedSpaceAdjustment({h_inside_to_unheated_w_k:8,h_unheated_to_outside_w_k:20,
    ground_heat_transfer:true}),/wider heat balance/);
});
