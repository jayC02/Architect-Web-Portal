/**
 * Independent roof and unheated-space calculation helpers. SI units except
 * explicitly named mm inputs. These functions do not select material data,
 * apply a 3% omission threshold, or run numerical thermal-bridge analysis.
 * See work/roof-method-evidence.md for primary references and applicability.
 */
const number = (value, label, allowZero = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return value;
};
const object = (value, label = 'input') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};
const rounded = (u) => ({u_value:u, u_value_5dp:Number(u.toFixed(5)), u_value_2dp:Number(u.toFixed(2))});

// Mean of 1/(a+b*t) over a line, or over a triangle whose area density is
// 2*t (thin apex) or 2*(1-t) (thick apex). The series avoids cancellation
// as b tends to zero. Its coefficients are exact moments of these densities.
function taperedIntegral(a, b, shape) {
  if (b === 0) return 1/a;
  const z=b/a;
  if (!Number.isFinite(z)) throw new RangeError('Taper resistance ratio exceeds the supported numerical range');
  if (z < .001) {
    let sum=0, power=1;
    for(let n=0;n<16;n++) {
      const moment=shape==='rectangle' ? 1/(n+1) :
        shape==='triangle_thick_apex' ? 2/((n+1)*(n+2)) : 2/(n+2);
      const term=power*moment;
      sum+=term;
      if(n>1 && Math.abs(term)<Number.EPSILON*Math.abs(sum)) break;
      power*=-z;
    }
    return sum/a;
  }
  const log=Math.log1p(z);
  if(shape==='rectangle') return log/b;
  if(shape==='triangle_thick_apex') return 2/b*((1+1/z)*log-1);
  return 2/b*(1-log/z);
}

/**
 * Analytic area mean of 1/R for a rectangular one-way taper, or a triangle
 * with a planar thickness field. R0 includes surfaces and all non-tapered
 * layers; each vertex thickness includes the minimum uniform insulation.
 * A general triangle is split at its middle-thickness contour, an algebraic
 * equivalent of ISO6946 Annex E's three-different-vertices expression.
 */
export function taperedRegionUValue(input) {
  object(input);
  const base=number(input.base_resistance_m2k_w,'base_resistance_m2k_w');
  const lambda=number(input.conductivity_w_mk,'conductivity_w_mk');
  const count=input.shape==='rectangle' ? 2 : input.shape==='triangle' ? 3 : 0;
  if(!count) throw new RangeError('Taper shape must be rectangle or triangle');
  if(!Array.isArray(input.thicknesses_mm) || input.thicknesses_mm.length!==count) {
    throw new RangeError(`thicknesses_mm requires ${count} ${input.shape==='rectangle' ? 'opposite-edge' : 'vertex'} thicknesses`);
  }
  if(input.requires_numerical_analysis) throw new RangeError('This taper requires numerical heat-flow analysis');
  const thicknesses=input.thicknesses_mm.map((v,i)=>number(v,`thicknesses_mm[${i}]`,true));
  const resistances=thicknesses.map(d=>number(base+d/1000/lambda,'vertex total resistance'));
  const sorted=[...resistances].sort((a,b)=>a-b);
  const a=sorted[0], c=sorted.at(-1);
  let u;
  if(count===2) u=taperedIntegral(a,c-a,'rectangle');
  else if(a===c) u=1/a;
  else {
    const middle=sorted[1], lowArea=(middle-a)/(c-a);
    u=lowArea*taperedIntegral(a,middle-a,'triangle_thin_apex') +
      (1-lowArea)*taperedIntegral(middle,c-middle,'triangle_thick_apex');
  }
  number(u,'calculated tapered U-value');
  return {method:'iso_6946_analytic_taper',shape:input.shape,
    base_resistance_m2k_w:base,conductivity_w_mk:lambda,thicknesses_mm:thicknesses,
    vertex_total_resistances_m2k_w:resistances,effective_resistance_m2k_w:1/u,
    u_uncorrected:u,...rounded(u),warnings:[]};
}

/** Piecewise planar regions must partition the roof without overlaps or gaps. */
export function calculateTaperedRoof(input) {
  object(input);
  number(input.base_resistance_m2k_w,'base_resistance_m2k_w');
  number(input.conductivity_w_mk,'conductivity_w_mk');
  if(!Array.isArray(input.regions) || !input.regions.length) throw new RangeError('At least one taper region is required');
  if(input.regions_partition_roof!==true) throw new RangeError('Confirm regions_partition_roof:true for complete, non-overlapping regions');
  if(input.requires_numerical_analysis) throw new RangeError('This roof requires numerical heat-flow analysis');
  if(input.corrections!==undefined && (!Array.isArray(input.corrections) || input.corrections.length)) {
    throw new RangeError('Taper-dependent corrections must be calculated locally before area weighting');
  }
  const regions=input.regions.map((region,i)=>{
    object(region,`region ${i}`);
    const area=number(region.area_m2,`region ${i} area_m2`);
    const calculation=taperedRegionUValue({...region,
      base_resistance_m2k_w:region.base_resistance_m2k_w ?? input.base_resistance_m2k_w,
      conductivity_w_mk:region.conductivity_w_mk ?? input.conductivity_w_mk});
    return {...calculation,name:region.name ?? `Region ${i+1}`,area_m2:area,
      heat_loss_coefficient_w_k:area*calculation.u_value};
  });
  const area=number(regions.reduce((s,r)=>s+r.area_m2,0),'total roof area');
  const h=number(regions.reduce((s,r)=>s+r.heat_loss_coefficient_w_k,0),'roof heat-loss coefficient');
  const u=h/area;
  return {method:'iso_6946_piecewise_taper',regions,total_area_m2:area,
    heat_loss_coefficient_w_k:h,r_total:1/u,u_uncorrected:u,...rounded(u),warnings:[]};
}

const ROOF_SPACE_TABLE=Object.freeze({tiles_no_underlay:.06,
  sheeted_or_tiles_with_underlay:.20,low_emissivity_underlay:.30,boards_and_felt:.30});

/** ISO6946 roof-space table includes roof covering and void, excludes Rse. */
export function roofSpaceResistance(input) {
  object(input);
  if(input.ventilation!=='natural') throw new RangeError('Tabulated roof spaces require natural ventilation');
  if(input.external_envelope_insulated!==false) throw new RangeError('Tabulated roof spaces require external_envelope_insulated:false');
  if(!Object.hasOwn(ROOF_SPACE_TABLE,input.roof_covering)) throw new RangeError(`roof_covering must be one of ${Object.keys(ROOF_SPACE_TABLE).join(', ')}`);
  return {method:'iso_6946_tabulated_roof_space',roof_covering:input.roof_covering,
    resistance_m2k_w:ROOF_SPACE_TABLE[input.roof_covering],includes_roof_covering:true,
    includes_external_surface:false};
}

// Accept a homogeneous construction resistance or complete path resistances
// and lower limit from the combined method. Adding a common series resistance
// requires recalculating the upper limit from paths, not shifting its old mean.
function sectionModel(input,prefix) {
  const single=input[`${prefix}_resistance_m2k_w`];
  const paths=input[`${prefix}_path_resistances_m2k_w`];
  const lower=input[`${prefix}_lower_resistance_m2k_w`];
  if(single!==undefined) {
    if(paths!==undefined || lower!==undefined || input.fractions!==undefined) throw new RangeError(`Supply homogeneous ${prefix} resistance or section paths, not both`);
    const r=number(single,`${prefix}_resistance_m2k_w`);
    return {fractions:[1],paths:[r],lower:r};
  }
  if(!Array.isArray(paths) || !paths.length || paths.length>256) throw new RangeError(`Supply 1 to 256 ${prefix} paths`);
  if(!Array.isArray(input.fractions) || input.fractions.length!==paths.length) throw new RangeError('Section fractions must match paths');
  const fractions=input.fractions.map((f,i)=>number(f,`fraction ${i}`));
  if(Math.abs(fractions.reduce((s,f)=>s+f,0)-1)>1e-9) throw new RangeError('Section fractions must sum to 1');
  const rs=paths.map((r,i)=>number(r,`${prefix} path ${i}`));
  const low=number(lower,`${prefix}_lower_resistance_m2k_w`);
  const upper=1/fractions.reduce((s,f,i)=>s+f/rs[i],0);
  if(low>upper*(1+1e-9)) throw new RangeError('Lower resistance limit exceeds the upper limit');
  return {fractions,paths:rs,lower:low};
}
function addSeries(model,scale,series) {
  const paths=model.paths.map(r=>number(scale*r+series,'final section resistance'));
  const upper=1/model.fractions.reduce((s,f,i)=>s+f/paths[i],0);
  const lower=scale*model.lower+series;
  const total=(upper+lower)/2;
  const u=1/total;
  return {fractions:model.fractions,path_resistances:paths,r_upper:upper,r_lower:lower,
    r_total:total,u_uncorrected:u,...rounded(u),warnings:[]};
}

/** Ceiling R includes room-side Rsi, excludes all above-insulation roof parts. */
export function calculateCeilingInsulatedRoof(input) {
  object(input);
  const model=sectionModel(input,'ceiling');
  const roofSpace=roofSpaceResistance(input.roof_space);
  const rse=number(input.rse_m2k_w ?? .04,'rse_m2k_w',true);
  return {...addSeries(model,1,roofSpace.resistance_m2k_w+rse),
    method:'iso_6946_ceiling_insulated_roof',area_basis:'flat_ceiling',heat_flow:'up',
    roof_space:roofSpace,rse};
}

/**
 * BR443 rafter insulation above a flat ceiling. Roof R includes exterior Rse
 * and sloped materials, excludes room-side Rsi and the .16 roof void.
 * Ceiling R is homogeneous and includes its room-side Rsi and flat materials.
 */
export function calculateRafterRoofOverFlatCeiling(input) {
  object(input);
  const model=sectionModel(input,'roof');
  const pitch=number(input.pitch_degrees,'pitch_degrees',true);
  if(pitch>=90) throw new RangeError('pitch_degrees must be less than 90');
  const cosine=Math.cos(pitch*Math.PI/180);
  const ceiling=number(input.ceiling_resistance_m2k_w,'ceiling_resistance_m2k_w');
  const voidR=number(input.roof_void_resistance_m2k_w ?? .16,'roof_void_resistance_m2k_w',true);
  if(voidR!==.16) throw new RangeError('The supported BR443 roof-void allowance is 0.16 m²K/W');
  return {...addSeries(model,cosine,ceiling+voidR),method:'br443_rafter_roof_over_flat_ceiling',
    area_basis:'flat_ceiling',heat_flow:'up',pitch_degrees:pitch,pitch_cosine:cosine,
    ceiling_resistance_m2k_w:ceiling,roof_void_resistance_m2k_w:voidR};
}

/** Published BR443 light-fitting allowance, when insulation is removed locally. */
export function recessedLightCorrection(input) {
  object(input);
  const u=number(input.roof_u_value_w_m2k,'roof_u_value_w_m2k');
  const f=number(input.removed_insulation_fraction,'removed_insulation_fraction',true);
  if(f>1) throw new RangeError('removed_insulation_fraction cannot exceed 1');
  if(u>2) throw new RangeError('The recessed-light default requires a roof U-value no greater than 2.0; supply explicit local U-values otherwise');
  return f*(2-u);
}

/** BR443 alternative allowance; explicit hatch-area weighting is preferable. */
export function loftHatchDefaultCorrection(input) {
  object(input);
  const lambda=number(input.insulation_conductivity_w_mk,'insulation_conductivity_w_mk');
  if(Math.abs(lambda-.04)>1e-12) throw new RangeError('The loft-hatch allowance requires insulation conductivity 0.040 W/(m K)');
  const table=new Map([[0,.015],[25,.006],[50,.003]]);
  if(!table.has(input.insulation_thickness_mm)) throw new RangeError('Tabulated hatch thickness must be exactly 0, 25 or 50 mm; otherwise use explicit area weighting');
  return table.get(input.insulation_thickness_mm);
}

/**
 * Area-weight the actual hatch/light/local construction U-values. Gross area
 * includes inclusions. Boundaries and roof-space treatment must match for all
 * supplied U-values; overlap areas must be partitioned into separate regions.
 */
export function roofAreaWeightedUValue(input) {
  object(input);
  const area=number(input.total_area_m2,'total_area_m2');
  const main=number(input.main_u_value_w_m2k,'main_u_value_w_m2k');
  if(!Array.isArray(input.inclusions)) throw new TypeError('inclusions must be an array');
  if(input.inclusions.length>1 && input.areas_non_overlapping!==true) throw new RangeError('Confirm areas_non_overlapping:true for multiple inclusions');
  const inclusions=input.inclusions.map((part,i)=>{
    object(part,`inclusion ${i}`);
    const a=number(part.area_m2,`inclusion ${i} area_m2`);
    const u=number(part.u_value_w_m2k,`inclusion ${i} u_value_w_m2k`);
    return {...part,area_m2:a,u_value_w_m2k:u,heat_loss_coefficient_w_k:a*u};
  });
  const removed=inclusions.reduce((s,p)=>s+p.area_m2,0);
  if(removed>area) throw new RangeError('Inclusion areas exceed the gross roof area');
  const h=(area-removed)*main+inclusions.reduce((s,p)=>s+p.heat_loss_coefficient_w_k,0);
  const u=number(h/area,'area-weighted roof U-value');
  return {method:'roof_area_weighting',total_area_m2:area,main_area_m2:area-removed,
    main_u_value_w_m2k:main,inclusions,heat_loss_coefficient_w_k:h,
    delta_u:u-main,...rounded(u),warnings:[]};
}

/**
 * ISO6946 approximate discrete, perpendicular full/recessed fastener model.
 * Rtot,h is the HOMOGENEOUS construction R ignoring thermal bridges. Recessed
 * R1 is only the metallic penetration depth / insulation conductivity.
 * Contact between metal sheets, rails/brackets and angled fasteners need other
 * methods. No exemption is inferred except lambda<1 or zero density/area.
 */
export function discreteFastenerCorrection(input) {
  object(input);
  const lambda=number(input.fastener_conductivity_w_mk,'fastener_conductivity_w_mk');
  const area=number(input.cross_section_area_mm2,'cross_section_area_mm2',true)*1e-6;
  const n=number(input.count_per_m2,'count_per_m2',true);
  const d0=number(input.insulation_thickness_mm,'insulation_thickness_mm')/1000;
  const d1=number(input.metal_penetration_mm ?? input.insulation_thickness_mm,'metal_penetration_mm')/1000;
  const insulationLambda=number(input.insulation_conductivity_w_mk,'insulation_conductivity_w_mk');
  const total=number(input.total_homogeneous_resistance_m2k_w,'total_homogeneous_resistance_m2k_w');
  if(input.both_ends_contact_metal!==false) throw new RangeError('Confirm both_ends_contact_metal:false; contact between metal sheets requires another method');
  if(input.angle_degrees!==undefined && input.angle_degrees!==0) throw new RangeError('Only perpendicular fasteners are supported');
  if(d1>d0) throw new RangeError('Metal penetration exceeds insulation thickness; angled fixings require another model');
  const fullR=d0/insulationLambda, penetratedR=d1/insulationLambda;
  if(fullR>total*(1+1e-12)) throw new RangeError('Insulation resistance exceeds homogeneous total resistance');
  const alpha=.8*d1/d0;
  const exempt=lambda<1;
  const delta=exempt ? 0 : alpha*lambda*area*n/d1*(penetratedR/total)**2;
  number(delta,'fastener correction',true);
  return {method:'iso_6946_discrete_fastener',delta_u:delta,alpha,
    penetrated_insulation_resistance_m2k_w:penetratedR,
    total_homogeneous_resistance_m2k_w:total,metal_penetration_mm:d1*1000,
    exemption:exempt ? 'fastener_conductivity_below_1_w_mk' : null};
}

/**
 * Two-node steady ISO13789 unheated-space balance, without heat gains or ground
 * coupling. H inputs include applicable transmission and ventilation losses.
 * The target boundary U must be between heated and unheated environments.
 */
export function unheatedSpaceAdjustment(input) {
  object(input);
  if(input.ground_heat_transfer || input.heat_sources || input.coupled_unheated_spaces) {
    throw new RangeError('Ground coupling, heat sources and multiple unheated-space networks require a wider heat balance');
  }
  const hi=number(input.h_inside_to_unheated_w_k,'h_inside_to_unheated_w_k');
  const he=number(input.h_unheated_to_outside_w_k,'h_unheated_to_outside_w_k',true);
  const b=he/(hi+he);
  const result={method:'iso_13789_two_node_unheated_space',adjustment_factor:b,
    h_inside_to_unheated_w_k:hi,h_unheated_to_outside_w_k:he,
    effective_heat_loss_coefficient_w_k:hi*b,warnings:[]};
  if(input.boundary_u_value_w_m2k!==undefined) Object.assign(result,rounded(number(input.boundary_u_value_w_m2k,'boundary_u_value_w_m2k')*b));
  const ti=input.inside_temperature_c,te=input.outside_temperature_c;
  if(ti!==undefined || te!==undefined) {
    if(typeof ti!=='number' || !Number.isFinite(ti) || typeof te!=='number' || !Number.isFinite(te)) throw new RangeError('Supply both finite inside_temperature_c and outside_temperature_c');
    result.unheated_temperature_c=(hi*ti+he*te)/(hi+he);
  }
  return result;
}

/**
 * Simplified ISO6946 additional Ru. The external envelope is uninsulated and
 * every internal boundary has the same U; use the general H balance otherwise.
 * Ru is added to an inside-to-unheated construction R, with its proper surfaces.
 */
export function unheatedSpaceResistance(input) {
  object(input);
  if(input.external_envelope_insulated!==false || input.internal_elements_same_u_value!==true) {
    throw new RangeError('Simplified Ru requires an uninsulated external envelope and internal_elements_same_u_value:true');
  }
  if(input.ground_heat_transfer || input.heat_sources || input.coupled_unheated_spaces) throw new RangeError('This space requires a wider heat balance');
  const ai=number(input.inside_area_m2,'inside_area_m2');
  const volume=number(input.volume_m3,'volume_m3');
  const ach=number(input.air_changes_per_hour,'air_changes_per_hour',true);
  if(!Array.isArray(input.outside_elements) || !input.outside_elements.length) throw new RangeError('outside_elements must contain the full external envelope');
  const transmission=input.outside_elements.reduce((s,e,i)=>{
    object(e,`outside element ${i}`);
    return s+number(e.area_m2,`outside element ${i} area_m2`)*number(e.u_value_w_m2k,`outside element ${i} u_value_w_m2k`);
  },0);
  const ventilation=.33*ach*volume;
  const he=number(transmission+ventilation,'unheated-to-exterior heat loss');
  return {method:'iso_6946_simplified_unheated_space',resistance_m2k_w:ai/he,
    transmission_heat_loss_coefficient_w_k:transmission,
    ventilation_heat_loss_coefficient_w_k:ventilation,
    h_unheated_to_outside_w_k:he,warnings:[]};
}
