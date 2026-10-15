import {calculateUValue} from '../uvalue_engine.mjs';
import {assertSchema,InputError} from './schema.mjs';
import {solveUnheatedNetwork} from './network.mjs';
export const ENGINE_VERSION='4.0.0';
export const API_VERSION='1';
const rounded=u=>({u_value:u,u_value_5dp:Number(u.toFixed(5)),u_value_2dp:Number(u.toFixed(2))});
const fail=(message,path='/')=>{throw new InputError(message,[{path,keyword:'physicalScope',message}],'CALCULATION_INPUT_ERROR');};
const near=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
const sum=xs=>xs.reduce((s,x)=>s+x,0);

function openingCalculation(input){
  const o=input.opening;
  const area=sum(o.components.map(c=>c.area_m2));
  if(!near(area,o.total_area_m2))fail('Projected component areas must sum to total opening area','/opening/components');
  if(input.element==='window'&&(!o.components.some(c=>c.kind==='frame')||!o.components.some(c=>c.kind==='glazing')||o.components.some(c=>c.kind==='panel')))
    fail('A window requires frame and glazing components; opaque panels belong in the door method','/opening/components');
  if(input.element==='door'&&!o.components.some(c=>c.kind==='panel'||c.kind==='glazing'))fail('A door requires a panel or glazed infill','/opening/components');
  const components=o.components.map(c=>({...c,heat_loss_coefficient_w_k:c.area_m2*c.u_value_w_m2k}));
  const edges=o.edges.map(e=>({...e,heat_loss_coefficient_w_k:e.length_m*e.psi_w_mk}));
  const componentH=sum(components.map(c=>c.heat_loss_coefficient_w_k)),edgeH=sum(edges.map(e=>e.heat_loss_coefficient_w_k));
  return {element:input.element,method:'supplied_components_projected_area_and_edge_heat_balance',
    reference_area_m2:area,area_basis:'projected_whole_opening',components,edges,
    component_heat_loss_coefficient_w_k:componentH,edge_heat_loss_coefficient_w_k:edgeH,
    heat_loss_coefficient_w_k:componentH+edgeH,...rounded((componentH+edgeH)/area),
    warnings:['Glazing, frame/panel and edge values must use consistent boundary conditions and applicable geometry. Their supplied evidence has not been authenticated.',
      'Installation junction bridges are separate. No glazing gas/radiation or frame-profile calculation is derived by this component method.']};
}
function assessedBridgeH(bridge){return bridge.kind==='point'?bridge.chi_w_k*bridge.count:bridge.psi_w_mk*bridge.length_m;}
function referenceArea(input,result){
  if(result.reference_area_m2!==undefined)return result.reference_area_m2;
  if(result.u_value_reference_area==='floor_plus_below_ground_walls')return result.total_ground_contact_area_m2;
  if(input.element==='basement_wall')return result.below_ground_wall_area_m2;
  return result.roof_area_adjustment?.total_area_m2??result.total_area_m2??result.area_m2??input.area_m2;
}
/** Strict website-facing adapter. The original library API remains backward compatible. */
export function calculateConstruction(input,{include_mesh_fields=false}={}){
  assertSchema(input);
  if(input.requires_numerical_analysis&&input.element!=='thermal_mesh')fail('This construction requires explicit numerical geometry','/requires_numerical_analysis');
  let result;
  try{
    if(input.element==='window'||input.element==='door')result=openingCalculation(input);
    else if(input.element==='supplied_u')result={element:input.element,method:'externally_assessed_u_value',...rounded(input.u_value_w_m2k),
      evidence:input.evidence,warnings:['Externally supplied U-value; its evidence and applicability have not been authenticated.']};
    else result=calculateUValue(input);
    // These three adapter methods do not run the original engine's post-processing.
    if(['window','door','supplied_u'].includes(input.element)&&input.detailed_bridges){
      const a=input.area_m2;
      if(a===undefined)fail('area_m2 is required for detailed bridges','/area_m2');
      if(result.reference_area_m2!==undefined&&!near(a,result.reference_area_m2))fail('Detailed bridge reference area must match the whole opening','/area_m2');
      const details=input.detailed_bridges.map(b=>({...b,heat_loss_coefficient_w_k:assessedBridgeH(b),delta_u:assessedBridgeH(b)/a}));
      const delta=sum(details.map(b=>b.delta_u));
      result={...result,u_before_detailed_bridges:result.u_value,detailed_bridges:details,detailed_bridge_delta_u:delta,...rounded(result.u_value+delta)};
    }
    const area=referenceArea(input,result);
    if(input.area_m2!==undefined&&area!==undefined&&!near(input.area_m2,area))fail('area_m2 differs from the calculation reference area','/area_m2');
    if(area!==undefined)result={...result,reference_area_m2:area,heat_loss_coefficient_w_k:area*result.u_value};
    if(!Number.isFinite(result.u_value)||result.u_value<0)fail('Calculated U-value is not finite and non-negative');
  }catch(error){
    if(error instanceof InputError)throw error;
    if(error instanceof RangeError||error instanceof TypeError)fail(error.message);
    throw error;
  }
  // Keep normal JSON responses compact; the caller can explicitly request the cell field.
  if(!include_mesh_fields&&input.element==='thermal_mesh'){
    result={...result,mesh_fields_included:false};
    for(const key of ['temperatures_c','conductivities','widths_mm','heights_mm','boundary_surface_temperatures_c'])delete result[key];
  }else if(input.element==='thermal_mesh')result={...result,mesh_fields_included:true};
  return result;
}

export function calculateBatch(input){
  assertSchema(input,'BatchRequest');
  const ids=new Set();for(const item of input.items){if(ids.has(item.id))fail('Batch item ids must be unique','/items');ids.add(item.id);}
  const items=input.items.map(item=>{
    try{return {id:item.id,ok:true,result:calculateConstruction(item.construction,input.options)};}
    catch(error){if(!(error instanceof InputError))throw error;return {id:item.id,ok:false,error:{code:error.code,message:error.message,issues:error.issues}};}
  });
  return {items,succeeded:items.filter(i=>i.ok).length,failed:items.filter(i=>!i.ok).length};
}

/** Whole-project transmission, using net opaque areas and explicitly separate junctions. */
export function calculateProject(input){
  assertSchema(input,'ProjectRequest');
  if((input.inside_temperature_c===undefined)!==(input.outside_temperature_c===undefined))fail('Supply both temperatures or neither','/inside_temperature_c');
  const ids=new Set(),elements=[];
  const register=id=>{if(ids.has(id))fail('Project element and opening ids must be unique','/elements');ids.add(id);};
  for(const e of input.elements){
    register(e.id);const openings=e.openings??[],openingArea=sum(openings.map(o=>o.area_m2));
    if(openingArea>e.gross_area_m2&&!near(openingArea,e.gross_area_m2))fail(`Openings exceed gross area for ${e.id}`,'/elements');
    const net=Math.max(0,e.gross_area_m2-openingArea),result=calculateConstruction(e.construction,input.options);
    if(result.reference_area_m2!==undefined&&!near(result.reference_area_m2,net))fail(`Calculation reference area differs from net area for ${e.id}`,'/elements');
    // Ground H cannot be scaled to a different geometry by treating its U as a material property.
    if(e.construction.ground&&openings.length)fail('Ground elements cannot contain opening deductions','/elements');
    const openingResults=openings.map(o=>{
      register(o.id);const r=calculateConstruction(o.construction,input.options);
      if(r.reference_area_m2!==undefined&&!near(r.reference_area_m2,o.area_m2))fail(`Opening area differs from its calculation for ${o.id}`,'/elements');
      return {id:o.id,area_m2:o.area_m2,result:r,heat_loss_coefficient_w_k:o.area_m2*r.u_value};
    });
    const opaqueH=net*result.u_value,openingH=sum(openingResults.map(o=>o.heat_loss_coefficient_w_k));
    elements.push({id:e.id,gross_area_m2:e.gross_area_m2,net_area_m2:net,opening_area_m2:openingArea,result,openings:openingResults,
      main_heat_loss_coefficient_w_k:opaqueH,opening_heat_loss_coefficient_w_k:openingH,heat_loss_coefficient_w_k:opaqueH+openingH});
  }
  const junctions=input.junctions.map(b=>({...b,heat_loss_coefficient_w_k:assessedBridgeH(b)}));
  const area=sum(elements.map(e=>e.gross_area_m2)),fabricH=sum(elements.map(e=>e.heat_loss_coefficient_w_k)),junctionH=sum(junctions.map(j=>j.heat_loss_coefficient_w_k));
  const h=fabricH+junctionH,u=h/area;
  if(!Number.isFinite(h)||!Number.isFinite(u))fail('Project heat loss exceeds the finite numeric range');
  const result={name:input.name,reference_area_m2:area,elements,junctions,fabric_heat_loss_coefficient_w_k:fabricH,
    junction_heat_loss_coefficient_w_k:junctionH,transmission_heat_loss_coefficient_w_k:h,area_weighted_u_value_w_m2k:u,
    warnings:['Transmission only: excludes air leakage, whole-building ventilation, solar gains and heating-system efficiency.',
      'Project areas must use one consistent convention. Junctions require assessment that excludes bridges already in component U-values.']};
  if(input.inside_temperature_c!==undefined){const delta=input.inside_temperature_c-input.outside_temperature_c;
    Object.assign(result,{temperature_difference_k:delta,transmission_heat_flow_w:h*delta});}
  return result;
}

/** Find the least increment on an explicit thickness grid within the supplied bounds. */
export function solveThickness(input){
  assertSchema(input,'ThicknessRequest');
  const {construction,layer_index:index,target_u_value_w_m2k:target,minimum_thickness_mm:min,maximum_thickness_mm:max,increment_mm:step}=input;
  if(!['layered_wall','layered_roof','exposed_floor','slab_on_ground','basement_floor','suspended_ground_floor','ceiling_insulated_roof','rafter_roof_flat_ceiling'].includes(construction.element))fail('This thickness solver supports a material layer in a plane, roof, slab or separating deck','/construction/element');
  const layer=construction.layers?.[index];
  if(!layer||layer.kind==='air'||(layer.conductivity===undefined&&layer.conductivities===undefined))fail('Select a material layer defined by conductivity and thickness','/layer_index');
  if(max<min)fail('Maximum thickness must not be less than minimum thickness','/maximum_thickness_mm');
  const steps=Math.floor((max-min)/step+1e-10);
  if(!Number.isSafeInteger(steps)||steps>1000000)fail('Thickness range contains too many increments','/increment_mm');
  const candidate=JSON.parse(JSON.stringify(construction));let evaluations=0;
  const evaluate=i=>{candidate.layers[index].thickness_mm=min+i*step;evaluations++;return calculateConstruction(candidate);};
  const initial=evaluate(0);
  if(initial.u_value<=target)return {achievable:true,thickness_mm:min,target_u_value_w_m2k:target,evaluations,result:initial,construction:candidate};
  // Correction thresholds and ground approximation branches can introduce steps or
  // nonmonotonic responses. Search the entire finite grid in those cases.
  if(construction.ground||construction.corrections?.length){
    if(steps>4096)fail('Ground/correction thickness searches support at most 4096 increments','/increment_mm');
    let last=initial;
    for(let i=1;i<=steps;i++){
      last=evaluate(i);
      if(last.u_value<=target)return {achievable:true,search_method:'exhaustive_grid',thickness_mm:min+i*step,
        previous_grid_thickness_mm:min+(i-1)*step,target_u_value_w_m2k:target,evaluations,result:last,construction:candidate};
    }
    return {achievable:false,search_method:'exhaustive_grid',maximum_grid_thickness_mm:min+steps*step,target_u_value_w_m2k:target,evaluations,result:last,reason:'TARGET_NOT_REACHED_WITHIN_BOUNDS'};
  }
  const last=evaluate(steps);
  if(last.u_value>initial.u_value+1e-10)fail('Construction is not monotonic over the supplied thickness range','/construction');
  if(last.u_value>target)return {achievable:false,maximum_grid_thickness_mm:min+steps*step,target_u_value_w_m2k:target,evaluations,
    result:last,reason:'TARGET_NOT_REACHED_WITHIN_BOUNDS'};
  let low=0,high=steps;
  while(high-low>1){const mid=Math.floor((low+high)/2),r=evaluate(mid);if(r.u_value<=target)high=mid;else low=mid;}
  const result=evaluate(high);
  return {achievable:true,search_method:'binary_grid',thickness_mm:min+high*step,target_u_value_w_m2k:target,evaluations,result,construction:candidate,
    previous_grid_thickness_mm:min+(high-1)*step};
}

export function runOperation(operation,payload){
  if(operation==='calculate'){assertSchema(payload,'CalculateRequest');return calculateConstruction(payload.construction,payload.options);}
  if(operation==='validate'){assertSchema(payload,'CalculateRequest');const result=calculateConstruction(payload.construction);return {valid:true,element:payload.construction.element,warnings:result.warnings??[]};}
  if(operation==='batch')return calculateBatch(payload);
  if(operation==='project')return calculateProject(payload);
  if(operation==='thickness')return solveThickness(payload);
  if(operation==='unheated-network')return solveUnheatedNetwork(payload,calculateConstruction);
  throw new Error('Unknown internal calculation operation');
}
