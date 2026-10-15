/** Independent U-value calculation prototype. See README.md for scope. */
import {unventilatedAirLayerResistance, airLayerVentilationPlan, interpolateVentilatedResistance} from './air_layers.mjs';
import {calculateSlabOnGround, calculateSuspendedGroundFloor} from './ground_floors.mjs';
import {invertedRoofRainCorrection} from './roof_corrections.mjs';
import {calculateSlabWithEdgeInsulation,calculateBasementFloor,calculateBasementWall,calculateHeatedBasement,calculateUnheatedBasement,calculateSuspendedGroundFloorExtended} from './ground_extensions.mjs';
import {calculateTaperedRoof,calculateCeilingInsulatedRoof,calculateRafterRoofOverFlatCeiling,roofAreaWeightedUValue,recessedLightCorrection,loftHatchDefaultCorrection,discreteFastenerCorrection,unheatedSpaceAdjustment,unheatedSpaceResistance} from './roof_methods.mjs';
import {calculateNumericalUValue} from './thermal_mesh.mjs';
export {unventilatedAirLayerResistance, airLayerVentilationPlan, interpolateVentilatedResistance} from './air_layers.mjs';
export {calculateSlabOnGround, calculateSuspendedGroundFloor, calculateSuspendedFloorFromReference, characteristicFloorDimension} from './ground_floors.mjs';
export {invertedRoofRainCorrection} from './roof_corrections.mjs';
export {calculateSlabWithEdgeInsulation,calculateBasementFloor,calculateBasementWall,calculateHeatedBasement,calculateUnheatedBasement,calculateSuspendedGroundFloorExtended,calculateEdgeInsulationCorrection,combinePartlyHeatedBasement} from './ground_extensions.mjs';
export {calculateTaperedRoof,calculateCeilingInsulatedRoof,calculateRafterRoofOverFlatCeiling,roofAreaWeightedUValue,recessedLightCorrection,loftHatchDefaultCorrection,discreteFastenerCorrection,unheatedSpaceAdjustment,unheatedSpaceResistance} from './roof_methods.mjs';
export {calculateNumericalUValue,solveThermalMesh,sampleThermalMesh,refineThermalMesh,createMaterialMesh} from './thermal_mesh.mjs';
const positive = (x, label, allowZero = false) => {
  if (typeof x !== 'number' || !Number.isFinite(x) || (allowZero ? x < 0 : x <= 0)) {
    throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return x;
};

export function materialResistance(thickness_mm, conductivity) {
  return positive(thickness_mm, 'thickness_mm') / 1000 / positive(conductivity, 'conductivity');
}

export function airGapCorrection(level, insulationResistance, totalResistance) {
  if (![0, 1, 2].includes(level)) throw new RangeError('air-gap level must be 0, 1 or 2');
  positive(insulationResistance, 'insulation resistance', true);
  positive(totalResistance, 'total resistance');
  if (insulationResistance > totalResistance) throw new RangeError('insulation resistance exceeds total resistance');
  return [0, 0.01, 0.04][level] * (insulationResistance / totalResistance) ** 2;
}

/** Full-depth discrete fasteners only; no partial penetration or metal framing. */
export function fastenerCorrection({conductivity, area_mm2, count_per_m2, insulation_thickness_mm,
  insulation_resistance, total_resistance}) {
  positive(conductivity, 'fastener conductivity');
  positive(area_mm2, 'fastener area_mm2', true);
  positive(count_per_m2, 'fastener count_per_m2', true);
  positive(insulation_thickness_mm, 'insulation_thickness_mm');
  positive(insulation_resistance, 'insulation resistance', true);
  positive(total_resistance, 'total resistance');
  if (insulation_resistance > total_resistance) throw new RangeError('insulation resistance exceeds total resistance');
  return 0.8 * conductivity * (area_mm2 * 1e-6) * count_per_m2 /
    (insulation_thickness_mm / 1000) * (insulation_resistance / total_resistance) ** 2;
}

/**
 * fractions describes actual through-element sections, summing to 1.
 * A bridged layer supplies one conductivity/resistance per section. Multiple
 * bridged layers must use the same sections: no implicit alignment assumption.
 * Order is outside to inside. Surface resistances are added once.
 */
export function calculatePlaneLayers(input,transformResistance) {
  const heatFlow = input.heat_flow ?? ({layered_wall:'horizontal',layered_roof:'up',exposed_floor:'down'}[input.element]);
  if (!['horizontal','up','down'].includes(heatFlow)) throw new RangeError('heat_flow must be horizontal, up or down');
  const rsi = positive(input.rsi ?? ({horizontal:0.13,up:0.10,down:0.17}[heatFlow]), 'rsi', true);
  const rse = positive(input.rse ?? 0.04, 'rse', true);
  const fractions = input.fractions ?? [1];
  if (!Array.isArray(fractions) || !fractions.length || fractions.length > 256) throw new RangeError('Supply 1 to 256 section fractions');
  fractions.forEach((f,i)=>positive(f,`fraction ${i}`));
  if (Math.abs(fractions.reduce((a,b)=>a+b,0)-1) > 1e-9) throw new RangeError('section fractions must sum to 1');
  if (!Array.isArray(input.layers) || !input.layers.length) throw new RangeError('At least one layer is required');
  const plans = [];
  const layerValues = input.layers.map((source,j) => {
    if (!source || typeof source !== 'object') throw new TypeError(`Layer ${j} must be an object`);
    if (source.requires_numerical_analysis||source.linear_metal_bridge) throw new RangeError(`Layer ${j}: use explicit numerical geometry for this thermal bridge`);
    if (source.kind !== undefined && !['air','material'].includes(source.kind)) throw new RangeError(`Layer ${j}: unsupported kind`);
    let layer = source;
    let airCalculation;
    if (source.kind === 'air') {
      if(source.heat_flow!==undefined && source.heat_flow!==heatFlow) throw new RangeError(`Layer ${j}: heat_flow must match the construction`);
      if (['conductivity','conductivities','resistance','resistances'].some(k=>source[k] !== undefined)) {
        throw new RangeError(`Layer ${j}: calculated air layer must not also supply a material resistance`);
      }
      airCalculation = unventilatedAirLayerResistance({...source,heat_flow:heatFlow,ventilation:'unventilated'});
      layer = {...source,resistance:airCalculation.resistance};
      if ((source.ventilation !== undefined && source.ventilation !== 'unventilated') ||
          source.opening_area_mm2_per_m !== undefined || source.opening_area_mm2_per_m2 !== undefined) {
        const plan = airLayerVentilationPlan({...source,heat_flow:heatFlow,
          cavity_layer_index:j,layer_count:input.layers.length});
        if (source.ventilation !== undefined && source.ventilation !== plan.ventilation) {
          throw new RangeError(`Layer ${j}: ventilation label does not match the opening area`);
        }
        if(plan.well_ventilated_weight>0 && Math.min(source.emissivity_1 ?? .9,source.emissivity_2 ?? .9)<.8 && source.exposed_surface_emissivity===undefined) {
          throw new RangeError(`Layer ${j}: specify exposed_surface_emissivity for a ventilated reflective cavity`);
        }
        plans.push({...plan,layer_index:j});
      }
    } else if (source.ventilation && source.ventilation !== 'unventilated') {
      throw new RangeError(`Layer ${j}: ventilation requires a calculated air layer and opening area; supplied resistance is outside this scope`);
    }
    const representations = ['conductivity','conductivities','resistance','resistances'].filter(k=>layer[k] !== undefined);
    if (representations.length !== 1) throw new RangeError(`Layer ${j} must specify exactly one resistance/conductivity representation`);
    const representation = representations[0];
    const uniform = representation === 'conductivity' || representation === 'resistance';
    const values = uniform ? fractions.map(()=>layer[representation]) : layer[representation];
    if (!Array.isArray(values) || values.length !== fractions.length) throw new RangeError(`Layer ${j}: section count mismatch`);
    const rs = values.map(value=>representation.startsWith('conductivit') ?
      materialResistance(layer.thickness_mm,value) : positive(value, `layer ${j} resistance`));
    const effective = 1 / fractions.reduce((sum,f,i)=>sum+f/rs[i],0);
    return {name:layer.name ?? `Layer ${j+1}`, original_index:j, air_calculation:airCalculation,
      resistance_by_section:rs, effective_resistance:effective,
      thickness_mm:positive(layer.thickness_mm ?? 0,`layer ${j} thickness_mm`,true)};
  });
  function limits(layers,externalR) {
    const paths = fractions.map((_,i)=>rsi+externalR+layers.reduce((sum,layer)=>sum+layer.resistance_by_section[i],0));
    if(paths.some(r=>r<=0)) throw new RangeError('Each path must have positive resistance');
    const upper = 1 / fractions.reduce((sum,f,i)=>sum+f/paths[i],0);
    const lower = rsi+externalR+layers.reduce((sum,layer)=>sum+layer.effective_resistance,0);
    return {path_resistances:paths,r_upper:upper,r_lower:lower,r_total:(upper+lower)/2};
  }
  const unventilated = limits(layerValues,rse);
  const ventilatedPlans = plans.filter(p=>p.well_ventilated_weight>0);
  if (ventilatedPlans.length>1) throw new RangeError('Multiple ventilated cavities require a separate construction model');
  const plan = ventilatedPlans[0];
  let active = unventilated;
  let ventilation;
  if (plan) {
    if ((input.corrections ?? []).length) throw new RangeError('Corrections with ventilated cavities require separate validation');
    const well = limits(layerValues.slice(plan.well_ventilated_first_retained_layer_index),plan.well_ventilated_external_surface_resistance);
    const blend = (key)=>interpolateVentilatedResistance({unventilated_total_resistance:unventilated[key],
      well_ventilated_total_resistance:well[key],well_ventilated_weight:plan.well_ventilated_weight});
    active = {r_upper:blend('r_upper'),r_lower:blend('r_lower'),r_total:blend('r_total'),
      path_resistances:plan.well_ventilated_weight===1 ? well.path_resistances : null};
    ventilation = {...plan,unventilated_endpoint:unventilated,well_ventilated_endpoint:well};
  }
  if(transformResistance){
    if(plan)throw new RangeError('A specialist roof cannot also use the external cavity ventilation model');
    active=transformResistance(active,fractions);
  }
  const {r_upper:rUpper,r_lower:rLower,r_total:rTotal,path_resistances:pathResistances} = active;
  const baseU = 1/rTotal;
  if (input.corrections !== undefined && !Array.isArray(input.corrections)) throw new TypeError('corrections must be an array');
  if ((input.corrections ?? []).filter(c=>c?.kind==='inverted_roof_rain').length>1) throw new RangeError('Use one inverted-roof rain correction listing all applicable insulation layers');
  const corrections = (input.corrections ?? []).map((c,i)=> {
    if (!c || typeof c !== 'object') throw new TypeError(`Correction ${i} must be an object`);
    let indices = c.kind === 'inverted_roof_rain' ? c.layer_indices : [c.layer_index];
    if (!Array.isArray(indices) || !indices.length || new Set(indices).size!==indices.length ||
      indices.some(j=>!Number.isInteger(j) || j<0 || j>=layerValues.length)) throw new RangeError(`Correction ${i}: invalid layer_index or layer_indices`);
    const layer = layerValues[indices[0]];
    if (indices.some(j=>input.layers[j].kind==='air')) throw new RangeError(`Correction ${i}: insulation correction cannot target an air cavity`);
    let delta;
    if (c.kind === 'airgap') {
      if(heatFlow==='down' && c.level!==0) throw new RangeError('Air-gap convection correction is not applicable to downward heat flow');
      delta=airGapCorrection(c.level,layer.effective_resistance,rTotal);
    }
    else if(c.kind === 'fastener') {
      if(c.partial_penetration) throw new RangeError('Partial fastener penetration is outside this prototype');
      if(c.both_ends_contact_metal===true || (c.angle_degrees!==undefined && c.angle_degrees!==0))throw new RangeError('Sheet-contact and angled fasteners require another method');
      let insulationR=layer.effective_resistance,homogeneousR=rTotal;
      if(fractions.length>1){
        if(!Number.isInteger(c.unbridged_section_index)||c.unbridged_section_index<0||c.unbridged_section_index>=fractions.length)throw new RangeError('Bridged fastener corrections require an explicit unbridged_section_index');
        insulationR=layer.resistance_by_section[c.unbridged_section_index];homogeneousR=pathResistances[c.unbridged_section_index];
      }
      delta=fastenerCorrection({...c,insulation_thickness_mm:layer.thickness_mm,
        insulation_resistance:insulationR,total_resistance:homogeneousR});
    } else if(c.kind==='recessed_fastener') {
      let section=0;
      if(fractions.length>1){
        section=c.unbridged_section_index;
        if(!Number.isInteger(section)||section<0||section>=fractions.length)throw new RangeError('Bridged fastener corrections require an explicit unbridged_section_index');
      }
      const lambda=positive(layer.thickness_mm,'fastener insulation thickness')/1000/layer.resistance_by_section[section];
      delta=discreteFastenerCorrection({...c,fastener_conductivity_w_mk:c.conductivity,cross_section_area_mm2:c.area_mm2,
        insulation_thickness_mm:layer.thickness_mm,insulation_conductivity_w_mk:lambda,
        total_homogeneous_resistance_m2k_w:pathResistances[section]}).delta_u;
    } else if (c.kind==='inverted_roof_rain') {
      if(input.element!=='layered_roof' || heatFlow!=='up') throw new RangeError('Inverted-roof rain correction requires a roof with upward heat flow');
      if (fractions.length!==1) throw new RangeError('Inverted-roof rain correction currently requires homogeneous insulation layers');
      if (typeof c.ballast_excluded !== 'boolean' || !c.ballast_excluded) throw new RangeError('Confirm ballast_excluded:true; ballast/soil/vegetation must not contribute resistance');
      delta=invertedRoofRainCorrection({...c,
        insulation_resistance_above_membrane:indices.reduce((sum,j)=>sum+layerValues[j].effective_resistance,0),total_resistance:rTotal});
    } else throw new RangeError(`Correction ${i}: unsupported correction kind`);
    return {kind:c.kind,layer_index:c.layer_index,layer_indices:c.layer_indices,delta_u:delta,
      ...(c.kind==='inverted_roof_rain' ? {rainfall_mm_per_day:c.rainfall_mm_per_day,
        fx_w_day_m2k_mm:c.fx_w_day_m2k_mm,ballast_excluded:c.ballast_excluded,
        rainfall_evidence:c.rainfall_evidence,drainage_evidence:c.drainage_evidence,
        design_conductivity_evidence:c.design_conductivity_evidence} : {})};
  });
  const deltaU = corrections.reduce((sum,c)=>sum+c.delta_u,0);
  const omitSmall = input.omit_small_corrections ?? true;
  if (typeof omitSmall !== 'boolean') throw new TypeError('omit_small_corrections must be boolean');
  // Strictly less than 3%; equality is included. Threshold applies to the sum.
  const omitted = omitSmall && deltaU < 0.03*baseU;
  const appliedDeltaU = omitted ? 0 : deltaU;
  const u = baseU+appliedDeltaU;
  const warnings = layerValues.flatMap(l=>l.air_calculation?.warnings ?? []);
  if(rUpper/rLower>1.5) throw new RangeError('Resistance limits differ by more than 1.5; use numerical heat-flow analysis');
  return {...active,element:input.element,heat_flow:heatFlow,rsi:active.rsi ?? rsi,rse:active.rse ?? rse,layers:layerValues,
    fractions,path_resistances:pathResistances,r_upper:rUpper,r_lower:rLower,r_total:rTotal,
    ventilation,cavity_plans:plans,
    relative_resistance_spread:(rUpper-rLower)/(rUpper+rLower),u_uncorrected:baseU,
    corrections,delta_u_total:deltaU,delta_u_applied:appliedDeltaU,
    corrections_omitted:omitted && deltaU>0,u_value:u,u_value_5dp:Number(u.toFixed(5)),
    u_value_2dp:Number(u.toFixed(2)),total_thickness_mm:layerValues.reduce((s,l)=>s+l.thickness_mm,0),warnings};
}

/** Dispatch an explicit construction family; ground is an SI-units object. */
function calculateBaseUValue(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new TypeError('Construction must be an object');
  if(input.element==='thermal_mesh') {
    if(!input.mesh || typeof input.mesh!=='object')throw new TypeError('mesh parameters are required');
    if(input.corrections?.length)throw new RangeError('Thermal-mesh corrections must be supplied as separately assessed detailed bridges');
    return calculateNumericalUValue(input.mesh);
  }
  if(input.requires_numerical_analysis) throw new RangeError('This construction requires numerical heat-flow analysis; use thermal_mesh with explicit geometry');
  if(input.element==='tapered_roof') {
    const roof={...input.roof};
    if(!input.roof || typeof input.roof!=='object')throw new TypeError('roof taper parameters are required');
    let base;
    if(input.layers!==undefined&&(!Array.isArray(input.layers)||input.layers.length)){
      if(roof.base_resistance_m2k_w!==undefined)throw new RangeError('Supply base layers or base_resistance_m2k_w, not both');
      if((input.fractions?.length ?? 1)!==1)throw new RangeError('Taper base layers must be homogeneous');
      base=calculatePlaneLayers({...input,element:'layered_roof',heat_flow:'up',corrections:[]});
      roof.base_resistance_m2k_w=base.r_total;
    }
    if(input.corrections?.length)throw new RangeError('Taper-dependent corrections must be integrated locally');
    return {...calculateTaperedRoof(roof),element:input.element,base_construction:base};
  }
  if(['ceiling_insulated_roof','rafter_roof_flat_ceiling'].includes(input.element)) {
    if(input.ground!==undefined)throw new RangeError('Roof methods cannot have ground parameters');
    if(input.element==='ceiling_insulated_roof') {
      const result=calculatePlaneLayers({...input,element:'layered_roof',heat_flow:'up',rsi:input.rsi ?? .10,rse:0},(plane,fractions)=>calculateCeilingInsulatedRoof({
        ceiling_path_resistances_m2k_w:plane.path_resistances,fractions,ceiling_lower_resistance_m2k_w:plane.r_lower,
        roof_space:input.roof_space,rse_m2k_w:input.rse ?? .04}));
      return {...result,element:input.element};
    }
    if(input.corrections?.length)throw new RangeError('Rafter roof over a flat ceiling needs separately assessed correction interactions');
    let ceilingR=input.roof?.ceiling_resistance_m2k_w,ceiling;
    if(input.ceiling_layers!==undefined){
      if(ceilingR!==undefined)throw new RangeError('Supply ceiling_layers or ceiling_resistance_m2k_w, not both');
      ceiling=calculatePlaneLayers({element:'layered_roof',heat_flow:'up',rsi:input.rsi ?? .10,rse:0,layers:input.ceiling_layers});ceilingR=ceiling.r_total;
    }
    const result=calculatePlaneLayers({...input,element:'layered_roof',heat_flow:'up',rsi:0,rse:input.rse ?? .04},(plane,fractions)=>calculateRafterRoofOverFlatCeiling({
      roof_path_resistances_m2k_w:plane.path_resistances,fractions,roof_lower_resistance_m2k_w:plane.r_lower,
      ceiling_resistance_m2k_w:ceilingR,pitch_degrees:input.roof?.pitch_degrees}));
    return {...result,element:input.element,rsi:input.rsi ?? .10,ceiling_construction:ceiling,
      surface_resistance_handling:'Sloped materials and Rse scale by cos(pitch); flat ceiling Rsi/materials and roof void remain unscaled.'};
  }
  const planes = ['layered_wall','layered_roof','exposed_floor'];
  if(planes.includes(input.element)) {
    if(input.ground!==undefined) throw new RangeError('ground parameters require an explicit ground-floor element');
    return calculatePlaneLayers(input);
  }
  const grounds=['slab_on_ground','suspended_ground_floor','basement_floor','basement_wall','heated_basement','unheated_basement'];
  if(!grounds.includes(input.element)) {
    throw new RangeError(`Supported elements: ${[...planes,...grounds,'ceiling_insulated_roof','rafter_roof_flat_ceiling','tapered_roof','thermal_mesh'].join(', ')}. Ground floors require an explicit ground type.`);
  }
  if(!input.ground || typeof input.ground!=='object' || Array.isArray(input.ground)) throw new TypeError('ground parameters are required');
  if(input.heat_flow!==undefined && input.heat_flow!==(input.element==='basement_wall'?'horizontal':'down')) throw new RangeError('Ground-floor heat flow must be down (horizontal for a basement wall)');
  if(input.rsi!==undefined || input.rse!==undefined) throw new RangeError('Use ground surface parameters; root rsi/rse are reserved for plane elements');
  if(input.corrections!==undefined && (!Array.isArray(input.corrections) || input.corrections.length)) throw new RangeError('Ground-floor corrections require separate validation');
  const ground = {...input.ground};
  let construction;
  if(input.layers!==undefined&&(!Array.isArray(input.layers)||input.layers.length)) {
    if(!Array.isArray(input.layers) || input.layers.some(l=>!l || typeof l!=='object')) throw new TypeError('layers must be an array of layer objects');
    if(input.layers.some(l=>(l.ventilation && l.ventilation!=='unventilated') || l.opening_area_mm2_per_m!==undefined || l.opening_area_mm2_per_m2!==undefined)) {
      throw new RangeError('Ground-floor deck layers cannot use external cavity ventilation; use the ground model');
    }
    if(['slab_on_ground','basement_floor','heated_basement'].includes(input.element)) {
      if(ground.floor_resistance_m2k_w!==undefined) throw new RangeError('Supply layers or floor_resistance_m2k_w, not both');
      if((input.fractions?.length ?? 1)!==1 || input.layers.some(l=>l.conductivities!==undefined || l.resistances!==undefined)) {
        throw new RangeError('Slab layer resistance currently requires homogeneous layers');
      }
      construction=calculatePlaneLayers({...input,element:'exposed_floor',heat_flow:'down',rsi:0,rse:0,corrections:[]});
      ground.floor_resistance_m2k_w=construction.r_total;
    } else if(['suspended_ground_floor','unheated_basement'].includes(input.element)) {
      if(ground.deck_u_value_w_m2k!==undefined) throw new RangeError('Supply layers or deck_u_value_w_m2k, not both');
      construction=calculatePlaneLayers({...input,element:'exposed_floor',heat_flow:'down',rsi:.17,rse:.17,corrections:[]});
      ground.deck_u_value_w_m2k=construction.u_uncorrected;
    } else throw new RangeError('Basement wall layers belong in wall_layers, with a separate floor resistance');
  }
  let wallConstruction;
  if(input.wall_layers!==undefined&&(!Array.isArray(input.wall_layers)||input.wall_layers.length)){
    if(!input.element.includes('basement'))throw new RangeError('wall_layers require a basement method');
    if(ground.wall_resistance_m2k_w!==undefined)throw new RangeError('Supply wall_layers or wall_resistance_m2k_w, not both');
    wallConstruction=calculatePlaneLayers({element:'layered_wall',heat_flow:'horizontal',rsi:0,rse:0,layers:input.wall_layers});
    ground.wall_resistance_m2k_w=wallConstruction.r_total;
  }
  let result;
  if(input.element==='slab_on_ground')result=Array.isArray(ground.edge_insulation)?calculateSlabWithEdgeInsulation(ground):calculateSlabOnGround(ground);
  else if(input.element==='suspended_ground_floor')result=calculateSuspendedGroundFloorExtended(ground);
  else result=({basement_floor:calculateBasementFloor,basement_wall:calculateBasementWall,heated_basement:calculateHeatedBasement,unheated_basement:calculateUnheatedBasement}[input.element])(ground);
  return {...result,element:input.element,heat_flow:input.element==='basement_wall'?'horizontal':'down',floor_construction:construction,wall_construction:wallConstruction};
}

/** Base result plus explicit detailed bridges, local areas or unheated-space balance. */
export function calculateUValue(input) {
  let result=calculateBaseUValue(input);
  const applyDetailedBridges=(result)=>{
  if(input.detailed_bridges!==undefined){
    const bridges=input.detailed_bridges;
    if(!Array.isArray(bridges)||!bridges.length)throw new RangeError('detailed_bridges must contain assessed point or linear bridges');
    const area=positive(input.area_m2,'area_m2 for detailed bridges');
    const referenceArea=result.u_value_reference_area==='floor_plus_below_ground_walls'?result.total_ground_contact_area_m2:
      result.element==='basement_wall'?result.below_ground_wall_area_m2:result.roof_area_adjustment?.total_area_m2 ?? result.total_area_m2 ?? result.area_m2;
    if(referenceArea!==undefined&&Math.abs(referenceArea-area)>1e-9*Math.max(area,1))throw new RangeError('Bridge reference area must match the calculated construction reference area');
    let delta=0;
    const details=bridges.map((b,i)=>{
      if(!b||typeof b!=='object')throw new TypeError(`Bridge ${i} must be an object`);
      if(typeof b.evidence!=='string'||!b.evidence.trim()||b.not_already_included!==true)throw new RangeError(`Bridge ${i}: evidence and not_already_included:true are required`);
      let h;
      if(b.kind==='point')h=positive(b.chi_w_k,'chi_w_k',true)*positive(b.count,'point bridge count',true);
      else if(b.kind==='linear')h=positive(b.psi_w_mk,'psi_w_mk',true)*positive(b.length_m,'linear bridge length_m',true);
      else throw new RangeError('Detailed bridge kind must be point or linear');
      delta+=h/area;return {...b,heat_loss_coefficient_w_k:h,delta_u:h/area};
    });
    result={...result,u_before_detailed_bridges:result.u_value,detailed_bridges:details,detailed_bridge_delta_u:delta,u_value:result.u_value+delta,
      heat_loss_coefficient_w_k:(result.u_value+delta)*area};
  }
  return result;
  };
  if(input.roof_inclusions!==undefined){
    if(!['layered_roof','ceiling_insulated_roof','rafter_roof_flat_ceiling','tapered_roof'].includes(input.element))throw new RangeError('roof_inclusions require a roof method');
    const weighted=roofAreaWeightedUValue({...input.roof_inclusions,main_u_value_w_m2k:result.u_value});
    result={...result,u_before_local_areas:result.u_value,roof_area_adjustment:weighted,u_value:weighted.u_value,heat_loss_coefficient_w_k:weighted.heat_loss_coefficient_w_k};
  }
  if(input.roof_allowances!==undefined){
    if(input.roof_inclusions!==undefined)throw new RangeError('Supply roof_inclusions or default roof_allowances to avoid double counting');
    if(!['layered_roof','ceiling_insulated_roof','rafter_roof_flat_ceiling'].includes(input.element))throw new RangeError('Default loft allowances require a ceiling/roof construction');
    const a=input.roof_allowances;let delta=0;
    if(a.hatch!==undefined)delta+=loftHatchDefaultCorrection(a.hatch);
    if(a.removed_insulation_fraction!==undefined)delta+=recessedLightCorrection({roof_u_value_w_m2k:result.u_value,removed_insulation_fraction:a.removed_insulation_fraction});
    result={...result,u_before_loft_allowances:result.u_value,loft_allowance_delta_u:delta,u_value:result.u_value+delta};
  }
  result=applyDetailedBridges(result);
  if(input.unheated_space!==undefined){
    if(!['layered_wall','exposed_floor','layered_roof'].includes(input.element))throw new RangeError('Use the dedicated ground/roof heat balance for this element');
    if(input.rse===undefined||input.rse!==({horizontal:.13,up:.10,down:.17}[result.heat_flow]))throw new RangeError('An unheated-space boundary needs explicit still-air rse for its heat-flow direction');
    const space=input.unheated_space;
    let adjusted;
    if(space.method==='simplified_resistance'){
      const ru=unheatedSpaceResistance(space);
      adjusted={...ru,u_value:1/(1/result.u_value+ru.resistance_m2k_w)};
    } else if(space.method==='heat_balance')adjusted=unheatedSpaceAdjustment({...space,boundary_u_value_w_m2k:result.u_value});
    else throw new RangeError('unheated_space.method must be heat_balance or simplified_resistance');
    result={...result,u_inside_to_unheated:result.u_value,unheated_space_adjustment:adjusted,u_value:adjusted.u_value,
      unheated_space_network_heat_loss_coefficient_w_k:adjusted.effective_heat_loss_coefficient_w_k,
      heat_loss_coefficient_w_k:input.area_m2===undefined?undefined:adjusted.u_value*positive(input.area_m2,'area_m2')};
  }
  return {...result,u_value_5dp:Number(result.u_value.toFixed(5)),u_value_2dp:Number(result.u_value.toFixed(2))};
}

