/** Original linear conductance network; several unheated spaces, no heat gains. */
import {assertSchema,InputError} from './schema.mjs';
const fail=message=>{throw new InputError(message,[{path:'/',keyword:'physicalScope',message}],'CALCULATION_INPUT_ERROR');};
const total=xs=>xs.reduce((s,x)=>s+x,0);
export function solveUnheatedNetwork(input,calculate){
  assertSchema(input,'NetworkRequest');
  const n=input.nodes.length,lookup=new Map(input.nodes.map((node,i)=>[node.id,i]));
  if(lookup.size!==n)fail('Unheated node ids must be unique');
  const at=id=>{if(!lookup.has(id))fail(`Unknown unheated node ${id}`);return lookup.get(id);};
  const matrix=Array.from({length:n},()=>new Float64Array(n)),rhs=new Float64Array(n),ids=new Set();
  input.nodes.forEach((node,i)=>matrix[i][i]=node.external_heat_loss_coefficient_w_k);
  const elements=input.inside_elements.map(e=>{
    if(ids.has(e.id))fail('Inside element ids must be unique');ids.add(e.id);
    if(!['layered_wall','layered_roof','exposed_floor','supplied_u','window','door'].includes(e.construction.element)||e.construction.unheated_space)
      fail('Inside network elements must use an unadjusted plane or externally assessed boundary construction');
    const result=calculate(e.construction),i=at(e.node_id);
    if(result.heat_flow&&e.construction.rse!==({horizontal:.13,up:.10,down:.17}[result.heat_flow]))fail('Inside-to-unheated plane constructions need an explicit still-air cold-side rse');
    if(result.reference_area_m2!==undefined&&Math.abs(result.reference_area_m2-e.area_m2)>1e-8*Math.max(e.area_m2,1))fail('Inside element area differs from its calculation reference area');
    const h=e.area_m2*result.u_value;if(!Number.isFinite(h)||h<=0)fail('Inside element conductance must be finite and positive');
    matrix[i][i]+=h;rhs[i]+=h;
    return {id:e.id,node_id:e.node_id,area_m2:e.area_m2,boundary_u_value_w_m2k:result.u_value,inside_heat_loss_coefficient_w_k:h,result};
  });
  for(const link of input.links){const a=at(link.from_node_id),b=at(link.to_node_id),h=link.heat_loss_coefficient_w_k;
    if(a===b)fail('A network link must connect two different nodes');
    matrix[a][a]+=h;matrix[b][b]+=h;matrix[a][b]-=h;matrix[b][a]-=h;
  }
  const scale=Math.max(...matrix.map((row,i)=>row[i]));if(!Number.isFinite(scale)||scale<=0)fail('Network conductances exceed the supported numeric range');
  const lower=Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let value=matrix[i][j]/scale;for(let k=0;k<j;k++)value-=lower[i][k]*lower[j][k];
    if(i===j){if(value<=1e-12||!Number.isFinite(value))fail('Network has an unanchored node group or is too ill-conditioned');lower[i][j]=Math.sqrt(value);}
    else lower[i][j]=value/lower[j][j];
  }
  const y=new Float64Array(n),theta=new Float64Array(n);
  for(let i=0;i<n;i++){let v=rhs[i]/scale;for(let j=0;j<i;j++)v-=lower[i][j]*y[j];y[i]=v/lower[i][i];}
  for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=lower[j][i]*theta[j];theta[i]=v/lower[i][i];
    if(theta[i]<-1e-8||theta[i]>1+1e-8||!Number.isFinite(theta[i]))fail('Network temperature is outside passive boundary limits');theta[i]=Math.max(0,Math.min(1,theta[i]));}
  const nodes=input.nodes.map((node,i)=>({...node,normalized_temperature:theta[i],temperature_reduction_factor:1-theta[i],
    external_effective_heat_loss_coefficient_w_k:node.external_heat_loss_coefficient_w_k*theta[i]}));
  for(const element of elements){const b=1-theta[at(element.node_id)];Object.assign(element,{temperature_reduction_factor:b,
    effective_u_value_w_m2k:element.boundary_u_value_w_m2k*b,effective_heat_loss_coefficient_w_k:element.inside_heat_loss_coefficient_w_k*b});}
  const inside=total(elements.map(e=>e.effective_heat_loss_coefficient_w_k)),outside=total(nodes.map(e=>e.external_effective_heat_loss_coefficient_w_k));
  const imbalance=Math.abs(inside-outside)/Math.max(inside,outside,1e-20);
  if(!Number.isFinite(imbalance)||imbalance>1e-8)fail('Network heat balance did not converge accurately enough');
  const result={method:'linear_passive_unheated_space_network',nodes,inside_elements:elements,links:input.links,
    effective_heat_loss_coefficient_w_k:inside,external_heat_loss_coefficient_w_k:outside,relative_heat_imbalance:imbalance,
    warnings:['Steady linear conductances and one common heated/exterior temperature pair; no solar/internal gains, thermal storage or independent ground-temperature node.',
      'Supplied external coefficients must include the applicable envelope and ventilation paths.']};
  if((input.inside_temperature_c===undefined)!==(input.outside_temperature_c===undefined))fail('Supply both temperatures or neither');
  if(input.inside_temperature_c!==undefined){const delta=input.inside_temperature_c-input.outside_temperature_c;
    for(const node of nodes)node.temperature_c=input.outside_temperature_c+node.normalized_temperature*delta;
    Object.assign(result,{temperature_difference_k:delta,transmission_heat_flow_w:inside*delta});}
  return result;
}
