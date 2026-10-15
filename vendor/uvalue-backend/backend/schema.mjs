/** Published JSON Schema and a validator for the deliberately small used vocabulary. */
const ref=name=>({$ref:`#/$defs/${name}`});
const str={type:'string',maxLength:4000};
const evidence={...str,minLength:1,pattern:'\\S'};
const positive={type:'number',exclusiveMinimum:0};
const nonnegative={type:'number',minimum:0};
const finite={type:'number'};
const bool={type:'boolean'};
const arr=(items,minItems=0,maxItems=256)=>({type:'array',items,minItems,maxItems});
const choice=(...values)=>({enum:values});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const literal=value=>({const:value});
const optionalMeta={name:str,description:str,metadata:{type:'object'}};
const flow=choice('horizontal','up','down');
const layerCommon={...optionalMeta,thickness_mm:nonnegative,requires_numerical_analysis:bool,linear_metal_bridge:bool};
const air=object({...layerCommon,kind:literal('air'),method:choice('table','iso_6946_annex_d'),
  thickness_mm:{...positive,maximum:300},width_mm:positive,height_mm:positive,heat_flow:flow,
  emissivity_1:{type:'number',minimum:.02,maximum:1},emissivity_2:{type:'number',minimum:.02,maximum:1},
  emissivity_evidence:evidence,mean_temperature_c:literal(10),temperature_difference_k:{...positive,maximum:5},
  parallel_faces:bool,internal_air_exchange:bool,glazing:bool,mechanical_ventilation:bool,
  ventilation:choice('unventilated','slightly_ventilated','well_ventilated'),orientation:choice('vertical','horizontal'),
  opening_area_mm2_per_m:nonnegative,opening_area_mm2_per_m2:nonnegative,
  openings_allow_through_flow:bool,insulation_between_cavity_and_exterior:bool,
  exposed_surface_emissivity:{type:'number',minimum:.02,maximum:1},
},['kind','thickness_mm','width_mm','height_mm']);
const materialVariants=['conductivity','conductivities','resistance','resistances'].map(key=>object({
  ...layerCommon,kind:literal('material'),ventilation:literal('unventilated'),
  [key]:key.endsWith('ies')||key==='resistances'?arr(positive,1):positive,
  ...(key.startsWith('conductivit')?{thickness_mm:positive}:{}),
},[key,...(key.startsWith('conductivit')?['thickness_mm']:[])]));
const correctionCommon={layer_index:{type:'integer',minimum:0,maximum:127}};
const fastener={...correctionCommon,conductivity:positive,area_mm2:nonnegative,count_per_m2:nonnegative,
  unbridged_section_index:{type:'integer',minimum:0,maximum:255},both_ends_contact_metal:bool,angle_degrees:finite};
const correction={oneOf:[
  object({...correctionCommon,kind:literal('airgap'),level:choice(0,1,2)},['kind','layer_index','level']),
  object({...fastener,kind:literal('fastener'),partial_penetration:bool},['kind','layer_index','conductivity','area_mm2','count_per_m2']),
  object({...fastener,kind:literal('recessed_fastener'),metal_penetration_mm:positive},['kind','layer_index','conductivity','area_mm2','count_per_m2','metal_penetration_mm','both_ends_contact_metal']),
  object({kind:literal('inverted_roof_rain'),layer_indices:arr({type:'integer',minimum:0,maximum:127},1,128),
    rainfall_mm_per_day:nonnegative,fx_w_day_m2k_mm:nonnegative,ballast_excluded:literal(true),
    rainfall_evidence:evidence,drainage_evidence:evidence,design_conductivity_evidence:evidence},
    ['kind','layer_indices','rainfall_mm_per_day','fx_w_day_m2k_mm','ballast_excluded','rainfall_evidence','drainage_evidence','design_conductivity_evidence']),
]};
const bridgeCommon={name:str,evidence,not_already_included:literal(true)};
const bridge={oneOf:[object({...bridgeCommon,kind:literal('point'),chi_w_k:nonnegative,count:nonnegative},['kind','chi_w_k','count','evidence','not_already_included']),
  object({...bridgeCommon,kind:literal('linear'),psi_w_mk:nonnegative,length_m:nonnegative},['kind','psi_w_mk','length_m','evidence','not_already_included'])]};
const localAreas=object({total_area_m2:positive,areas_non_overlapping:bool,inclusions:arr(object({name:str,area_m2:positive,u_value_w_m2k:positive},['area_m2','u_value_w_m2k']),0,128)},['total_area_m2','inclusions']);
const roofAllowances=object({hatch:object({insulation_thickness_mm:choice(0,25,50),insulation_conductivity_w_mk:literal(.04)},['insulation_thickness_mm','insulation_conductivity_w_mk']),removed_insulation_fraction:{type:'number',minimum:0,maximum:1}});
const spaceFlags={ground_heat_transfer:bool,heat_sources:bool,coupled_unheated_spaces:bool};
const unheated={oneOf:[object({...spaceFlags,method:literal('heat_balance'),h_inside_to_unheated_w_k:positive,h_unheated_to_outside_w_k:nonnegative,
  inside_temperature_c:finite,outside_temperature_c:finite},['method','h_inside_to_unheated_w_k','h_unheated_to_outside_w_k']),
  object({...spaceFlags,method:literal('simplified_resistance'),external_envelope_insulated:literal(false),internal_elements_same_u_value:literal(true),
    inside_area_m2:positive,volume_m3:positive,air_changes_per_hour:nonnegative,
    outside_elements:arr(object({area_m2:positive,u_value_w_m2k:positive},['area_m2','u_value_w_m2k']),1)},
    ['method','external_envelope_insulated','internal_elements_same_u_value','inside_area_m2','volume_m3','air_changes_per_hour','outside_elements'])]};
const gCommon={...optionalMeta,element:str,area_m2:positive,exposed_perimeter_m:positive,wall_thickness_m:positive,
  soil_conductivity_w_mk:positive,rsi_m2k_w:nonnegative,rse_m2k_w:nonnegative,edge_insulation:literal('none'),
  flowing_groundwater:bool,embedded_heating:bool};
const gRequired=['area_m2','exposed_perimeter_m','wall_thickness_m','soil_conductivity_w_mk','rsi_m2k_w','rse_m2k_w','edge_insulation'];
// Helper ground modules do not accept description/metadata: root metadata is the extension point.
delete gCommon.description;delete gCommon.metadata;
const basement={...gCommon,basement_depth_m:nonnegative,floor_resistance_m2k_w:nonnegative,
  wall_resistance_m2k_w:nonnegative,wall_rsi_m2k_w:nonnegative,wall_rse_m2k_w:nonnegative};
const edge=object({orientation:choice('horizontal','vertical'),extent_m:positive,thickness_m:positive,resistance_m2k_w:positive},['orientation','extent_m','thickness_m','resistance_m2k_w']);
const groundSchemas={
  slab_on_ground:object({...gCommon,basement_depth_m:literal(0),floor_resistance_m2k_w:nonnegative,
    edge_insulation:{oneOf:[literal('none'),arr(edge,1,16)]},edge_insulation_small_extent:bool,edge_junction_thermal_bridge_free:bool},[...gRequired,'basement_depth_m']),
  suspended_ground_floor:object({...gCommon,floor_height_m:nonnegative,underfloor_wall_u_value_w_m2k:nonnegative,
    ventilation_opening_area_per_perimeter_m2_m:nonnegative,annual_wind_speed_10m_m_s:nonnegative,wind_shielding_factor:nonnegative,
    ventilation:literal('natural'),base_depth_m:nonnegative,base_insulation_resistance_m2k_w:nonnegative,
    deck_u_value_w_m2k:positive,below_ground_wall_resistance_m2k_w:nonnegative,wall_rsi_m2k_w:nonnegative,wall_rse_m2k_w:nonnegative},
    [...gRequired,'floor_height_m','underfloor_wall_u_value_w_m2k','ventilation_opening_area_per_perimeter_m2_m','annual_wind_speed_10m_m_s','wind_shielding_factor','ventilation','base_depth_m','base_insulation_resistance_m2k_w']),
  basement_floor:object({...gCommon,basement_depth_m:nonnegative,floor_resistance_m2k_w:nonnegative},[...gRequired,'basement_depth_m']),
  basement_wall:object(basement,gRequired.filter(k=>k!=='area_m2').concat(['basement_depth_m','floor_resistance_m2k_w','wall_rsi_m2k_w','wall_rse_m2k_w'])),
  heated_basement:object(basement,[...gRequired,'basement_depth_m','wall_rsi_m2k_w','wall_rse_m2k_w']),
  unheated_basement:object({...basement,deck_u_value_w_m2k:positive,above_ground_wall_height_m:nonnegative,
    above_ground_wall_u_value_w_m2k:nonnegative,ventilation:literal('external_air'),air_changes_per_hour:nonnegative,basement_air_volume_m3:positive},
    [...gRequired,'basement_depth_m','floor_resistance_m2k_w','wall_rsi_m2k_w','wall_rse_m2k_w','above_ground_wall_height_m','above_ground_wall_u_value_w_m2k','ventilation','air_changes_per_hour','basement_air_volume_m3']),
};
const boundary={oneOf:[object({kind:literal('temperature'),temperature_c:finite,surface_resistance_m2k_w:{oneOf:[nonnegative,arr(nonnegative,1,512)]}},['kind','temperature_c','surface_resistance_m2k_w']),
  object({kind:choice('adiabatic','periodic')},['kind'])]};
const region=object({name:str,x_mm:nonnegative,y_mm:nonnegative,width_mm:positive,height_mm:positive,conductivity_w_mk:positive},['x_mm','y_mm','width_mm','height_mm','conductivity_w_mk']);
const mesh=object({geometry:object({width_mm:positive,height_mm:positive,base_conductivity_w_mk:positive,max_cell_size_mm:positive,
  minimum_cells_per_interval:{type:'integer',minimum:1,maximum:16},overlapping_regions_use_last:bool,regions:arr(region)},['width_mm','height_mm','base_conductivity_w_mk','max_cell_size_mm','regions']),
  widths_mm:arr(positive,1,512),heights_mm:arr(positive,1,512),conductivities:arr(arr(positive,1,512),1,512),
  boundaries:object({top:boundary,bottom:boundary,left:boundary,right:boundary},['top','bottom','left','right']),
  max_refinements:{type:'integer',minimum:1,maximum:4},mesh_convergence_tolerance:{...positive,maximum:.01},
  relative_tolerance:{...positive,maximum:1e-6},max_iterations:{type:'integer',minimum:1,maximum:100000},
  internal_heat_sources:bool,anisotropic:bool,air_flow:bool,radiation_model:bool},['boundaries']);
const constructionCommon={...optionalMeta,element:str,area_m2:positive,detailed_bridges:arr(bridge,1,128),requires_numerical_analysis:bool};
const planeCommon={...constructionCommon,heat_flow:flow,rsi:nonnegative,rse:nonnegative,fractions:arr(positive,1),layers:arr(ref('Layer'),1,128),
  corrections:arr(correction,0,128),omit_small_corrections:bool};
const roofPost={roof_inclusions:localAreas,roof_allowances:roofAllowances};
const constructionVariants=['layered_wall','layered_roof','exposed_floor'].map(element=>object({...planeCommon,element:literal(element),
  unheated_space:unheated,...(element==='layered_roof'?roofPost:{})},['element','layers']));
for(const [element,ground]of Object.entries(groundSchemas))constructionVariants.push(object({...constructionCommon,element:literal(element),heat_flow:flow,
  fractions:arr(positive,1),layers:arr(ref('Layer'),0,128),...(element.includes('basement')?{wall_layers:arr(ref('Layer'),0,128)}:{}),
  corrections:arr(correction,0,0),ground},['element','ground']));
constructionVariants.push(object({...planeCommon,...roofPost,element:literal('ceiling_insulated_roof'),roof_space:object({ventilation:literal('natural'),external_envelope_insulated:literal(false),
  roof_covering:choice('tiles_no_underlay','sheeted_or_tiles_with_underlay','low_emissivity_underlay','boards_and_felt')},['ventilation','external_envelope_insulated','roof_covering'])},['element','layers','roof_space']));
constructionVariants.push(object({...planeCommon,...roofPost,element:literal('rafter_roof_flat_ceiling'),ceiling_layers:arr(ref('Layer'),1,128),
  roof:object({pitch_degrees:{type:'number',minimum:0,exclusiveMaximum:90},ceiling_resistance_m2k_w:positive},['pitch_degrees'])},['element','layers','roof']));
constructionVariants.push(object({...planeCommon,roof_inclusions:localAreas,element:literal('tapered_roof'),layers:arr(ref('Layer'),0,128),roof:object({
  base_resistance_m2k_w:positive,conductivity_w_mk:positive,regions_partition_roof:literal(true),
  regions:arr(object({name:str,shape:choice('rectangle','triangle'),area_m2:positive,thicknesses_mm:arr(nonnegative,2,3)},['shape','area_m2','thicknesses_mm']),1,128)},['conductivity_w_mk','regions_partition_roof','regions'])},['element','roof']));
constructionVariants.push(object({...constructionCommon,element:literal('thermal_mesh'),mesh},['element','mesh']));
const openingPart=object({name:str,kind:choice('frame','glazing','panel'),area_m2:positive,u_value_w_m2k:positive,evidence},['kind','area_m2','u_value_w_m2k','evidence']);
const edgePart=object({name:str,length_m:nonnegative,psi_w_mk:nonnegative,evidence},['length_m','psi_w_mk','evidence']);
for(const element of ['window','door'])constructionVariants.push(object({...constructionCommon,element:literal(element),
  opening:object({total_area_m2:positive,components:arr(openingPart,1,128),edges:arr(edgePart,0,128),projected_areas_non_overlapping:literal(true),
    component_boundaries_consistent:literal(true)},['total_area_m2','components','edges','projected_areas_non_overlapping','component_boundaries_consistent'])},['element','opening']));
constructionVariants.push(object({...constructionCommon,element:literal('supplied_u'),u_value_w_m2k:positive,evidence},['element','u_value_w_m2k','evidence']));
const item=object({id:{type:'string',minLength:1,maxLength:100},construction:ref('Construction')},['id','construction']);
const projectElement=object({...item.properties,gross_area_m2:positive,openings:arr(object({id:{type:'string',minLength:1,maxLength:100},area_m2:positive,construction:ref('Construction')},['id','area_m2','construction']),0,128)},['id','gross_area_m2','construction']);
const options=object({include_mesh_fields:bool});
export const SCHEMA={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'urn:uvalue-workshop:api:1',title:'U-value Workshop API 1',
  $ref:'#/$defs/Construction',
  $defs:{Layer:{oneOf:[air,...materialVariants]},Construction:{oneOf:constructionVariants},
    CalculateRequest:object({construction:ref('Construction'),options},['construction']),
    BatchRequest:object({items:arr(item,1,100),options},['items']),
    ThicknessRequest:object({construction:ref('Construction'),layer_index:{type:'integer',minimum:0,maximum:127},
      target_u_value_w_m2k:positive,minimum_thickness_mm:positive,maximum_thickness_mm:positive,increment_mm:positive},
      ['construction','layer_index','target_u_value_w_m2k','minimum_thickness_mm','maximum_thickness_mm','increment_mm']),
    ProjectRequest:object({...optionalMeta,elements:arr(projectElement,1,100),junctions:arr(bridge,0,256),inside_temperature_c:finite,outside_temperature_c:finite,options},['elements','junctions']),
    NetworkRequest:object({nodes:arr(object({id:{type:'string',minLength:1,maxLength:100},external_heat_loss_coefficient_w_k:nonnegative},['id','external_heat_loss_coefficient_w_k']),1,64),
      inside_elements:arr(object({id:{type:'string',minLength:1,maxLength:100},node_id:{type:'string',minLength:1,maxLength:100},area_m2:positive,construction:ref('Construction')},['id','node_id','area_m2','construction']),1,100),
      links:arr(object({from_node_id:{type:'string',minLength:1,maxLength:100},to_node_id:{type:'string',minLength:1,maxLength:100},heat_loss_coefficient_w_k:positive},['from_node_id','to_node_id','heat_loss_coefficient_w_k']),0,256),
      inside_temperature_c:finite,outside_temperature_c:finite,all_external_paths_to_same_temperature:literal(true),no_heat_gains:literal(true),component_boundaries_consistent:literal(true)},
      ['nodes','inside_elements','links','all_external_paths_to_same_temperature','no_heat_gains','component_boundaries_consistent']),
  },
};

const escapePointer=s=>String(s).replaceAll('~','~0').replaceAll('/','~1');
export function schemaIssues(value,definition='Construction'){
  const issues=[];
  const issue=(path,keyword,message)=>{if(issues.length<32)issues.push({path:path||'/',keyword,message});};
  function check(v,s,path,out=issue){
    if(s.$ref){const name=s.$ref.split('/').at(-1);if(!Object.hasOwn(SCHEMA.$defs,name))throw Error('Unknown schema reference');return check(v,SCHEMA.$defs[name],path,out);}
    if(s.const!==undefined&&v!==s.const)out(path,'const',`Must equal ${JSON.stringify(s.const)}`);
    if(s.enum&&!s.enum.includes(v))out(path,'enum',`Must be one of ${s.enum.map(x=>JSON.stringify(x)).join(', ')}`);
    if(s.oneOf){
      // Discriminated branches produce concise field errors instead of every other method's errors.
      const tagged=s.oneOf.filter(branch=>branch.properties&&Object.entries(branch.properties).some(([key,rule])=>rule.const!==undefined&&v?.[key]===rule.const));
      if(tagged.length===1)return check(v,tagged[0],path,out);
      const alternatives=s.oneOf.map(branch=>{const errors=[];check(v,branch,path,(p,k,m)=>errors.push([p,k,m]));return errors;});
      const passes=alternatives.filter(e=>!e.length).length;
      if(passes===1)return;
      if(!passes){const best=alternatives.reduce((a,b)=>b.length<a.length?b:a);for(const [p,k,m]of best.slice(0,12))out(p,k,m);}
      else out(path,'oneOf','Input matches more than one representation; choose exactly one');
      return;
    }
    if(s.type){
      const matches=s.type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):s.type==='array'?Array.isArray(v):
        s.type==='number'?typeof v==='number'&&Number.isFinite(v):s.type==='integer'?Number.isSafeInteger(v):typeof v===s.type;
      if(!matches){out(path,'type',`Must be ${s.type}${s.type==='number'?' and finite':''}`);return;}
    }
    if(typeof v==='number')for(const [key,invalid]of [['minimum',v<s.minimum],['maximum',v>s.maximum],['exclusiveMinimum',v<=s.exclusiveMinimum],['exclusiveMaximum',v>=s.exclusiveMaximum]])if(s[key]!==undefined&&invalid)out(path,key,`Must satisfy ${key}: ${s[key]}`);
    if(typeof v==='string'){
      const length=[...v].length;
      if(s.minLength!==undefined&&length<s.minLength)out(path,'minLength',`Must contain at least ${s.minLength} characters`);
      if(s.maxLength!==undefined&&length>s.maxLength)out(path,'maxLength',`Must contain at most ${s.maxLength} characters`);
      if(s.pattern&&!new RegExp(s.pattern).test(v))out(path,'pattern','Must contain non-whitespace text');
    }
    if(Array.isArray(v)){
      if(s.minItems!==undefined&&v.length<s.minItems)out(path,'minItems',`Must contain at least ${s.minItems} items`);
      if(s.maxItems!==undefined&&v.length>s.maxItems)out(path,'maxItems',`Must contain at most ${s.maxItems} items`);
      if(s.items)for(let i=0;i<Math.min(v.length,s.maxItems??v.length);i++)check(v[i],s.items,`${path}/${i}`,out);
    }
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      for(const key of s.required??[])if(!Object.hasOwn(v,key))out(`${path}/${escapePointer(key)}`,'required','Required field');
      for(const [key,x]of Object.entries(v)){
        if(Object.hasOwn(s.properties??{},key))check(x,s.properties[key],`${path}/${escapePointer(key)}`,out);
        else if(s.additionalProperties===false)out(`${path}/${escapePointer(key)}`,'additionalProperties','Unknown field; extension data belongs in metadata');
      }
    }
  }
  check(value,ref(definition),'');return issues;
}

export class InputError extends Error{
  constructor(message,issues=[],code='INVALID_INPUT'){super(message);this.name='InputError';this.code=code;this.issues=issues;}
}
/** Reject unbounded/non-JSON values even inside intentionally free-form metadata. */
export function inspectJson(value,{maxNodes=200000,maxDepth=32}={}){
  let nodes=0;
  function walk(v,path,depth){
    if(++nodes>maxNodes)throw new InputError('Input contains too many values',[{path,keyword:'resourceLimit',message:`Maximum ${maxNodes} values`}]);
    if(depth>maxDepth)throw new InputError('Input is too deeply nested',[{path,keyword:'resourceLimit',message:`Maximum depth ${maxDepth}`}]);
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))throw new InputError('All numbers must be finite',[{path,keyword:'type',message:'Must be finite'}]);return;}
    if(typeof v==='string'){if(v.length>100000)throw new InputError('Text value is too long',[{path,keyword:'maxLength',message:'Maximum 100000 UTF-16 code units'}]);return;}
    if(typeof v!=='object'||(Object.getPrototypeOf(v)!==Object.prototype&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==null))throw new InputError('Input must contain plain JSON values',[{path,keyword:'type',message:'Plain JSON required'}]);
    for(const [k,x]of Object.entries(v)){
      if(['__proto__','prototype','constructor'].includes(k))throw new InputError('Reserved object key',[{path:`${path}/${escapePointer(k)}`,keyword:'reservedKey',message:'Reserved key'}]);
      walk(x,`${path}/${escapePointer(k)}`,depth+1);
    }
  }
  walk(value,'',0);return nodes;
}
export function assertSchema(value,definition='Construction'){
  inspectJson(value);const issues=schemaIssues(value,definition);
  if(issues.length)throw new InputError('Input does not match the calculation contract',issues);
  return value;
}
