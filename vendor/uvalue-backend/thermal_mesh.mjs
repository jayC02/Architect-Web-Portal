/** Steady 2D finite-volume conduction on a rectangular, material-aligned mesh. */
export const THERMAL_MESH_REFERENCES = Object.freeze([
  'https://buildingphysics.com/download/iso/ISO_10211_HEAT2_HEAT3.pdf',
  'https://www.iso.org/standard/65710.html',
]);
const num=(x,key,zero=false)=>{
  if(typeof x!=='number'||!Number.isFinite(x)||(zero?x<0:x<=0))throw new RangeError(`${key} must be finite and ${zero?'non-negative':'positive'}`);
  return x;
};
const temp=(x,key)=>{if(typeof x!=='number'||!Number.isFinite(x))throw new RangeError(`${key} must be a finite temperature`);return x;};
const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};

/** Material rectangles; region boundaries are kept exact during subdivision. */
export function createMaterialMesh(geometry){
  if(!geometry||typeof geometry!=='object')throw new TypeError('Mesh geometry is required');
  const width=num(geometry.width_mm,'geometry width_mm'),height=num(geometry.height_mm,'geometry height_mm');
  const base=num(geometry.base_conductivity_w_mk,'base_conductivity_w_mk');
  const size=num(geometry.max_cell_size_mm,'max_cell_size_mm');
  const min=geometry.minimum_cells_per_interval ?? 2;
  if(!Number.isInteger(min)||min<1||min>20)throw new RangeError('minimum_cells_per_interval must be 1 to 20');
  if(!Array.isArray(geometry.regions)||geometry.regions.length>256)throw new RangeError('geometry.regions must contain at most 256 rectangles');
  const regions=geometry.regions.map((r,i)=>{
    const x=num(r.x_mm,`region ${i} x_mm`,true),y=num(r.y_mm,`region ${i} y_mm`,true),w=num(r.width_mm,`region ${i} width_mm`),h=num(r.height_mm,`region ${i} height_mm`),k=num(r.conductivity_w_mk,`region ${i} conductivity`);
    if(x+w>width+1e-8||y+h>height+1e-8)throw new RangeError('Material rectangle exceeds the mesh domain');
    return {...r,x_mm:x,y_mm:y,width_mm:w,height_mm:h,conductivity_w_mk:k};
  });
  for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){
    const a=regions[i],b=regions[j];
    const overlap=Math.min(a.x_mm+a.width_mm,b.x_mm+b.width_mm)-Math.max(a.x_mm,b.x_mm)>1e-8 &&
      Math.min(a.y_mm+a.height_mm,b.y_mm+b.height_mm)-Math.max(a.y_mm,b.y_mm)>1e-8;
    if(overlap&&geometry.overlapping_regions_use_last!==true)throw new RangeError('Overlapping material rectangles require overlapping_regions_use_last:true');
  }
  function sizes(cuts){
    const sorted=[...cuts].sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>1e-8);
    let total=0;
    return sorted.slice(1).flatMap((v,i)=>{const length=v-sorted[i],count=Math.max(min,Math.ceil(length/size));total+=count;if(total>512)throw new RangeError('Geometry creates more than 512 cells along an axis; increase max_cell_size_mm');return Array(count).fill(length/count);});
  }
  const dx=sizes([0,width,...regions.flatMap(r=>[r.x_mm,r.x_mm+r.width_mm])]);
  const dy=sizes([0,height,...regions.flatMap(r=>[r.y_mm,r.y_mm+r.height_mm])]);
  if(dx.length*dy.length>25000)throw new RangeError('Initial geometry may contain at most 25000 cells to allow mesh refinement');
  let y=0;const conductivities=dy.map(h=>{const cy=y+h/2;y+=h;let x=0;return dx.map(w=>{
    const cx=x+w/2;x+=w;let k=base;
    for(const r of regions)if(cx>r.x_mm&&cx<r.x_mm+r.width_mm&&cy>r.y_mm&&cy<r.y_mm+r.height_mm)k=r.conductivity_w_mk;
    return k;});});
  return {widths_mm:dx,heights_mm:dy,conductivities};
}

function axis(values,key){
  if(!Array.isArray(values)||values.length<1||values.length>512)throw new RangeError(`${key} must contain 1 to 512 cell sizes`);
  return values.map((v,i)=>num(v,`${key}[${i}]`)/1000);
}
function boundary(value,key,count){
  if(!value || typeof value!=='object')throw new TypeError(`Boundary ${key} is required`);
  if(value.kind==='adiabatic')return {kind:'adiabatic'};
  if(value.kind!=='temperature')throw new RangeError(`Boundary ${key}: kind must be temperature or adiabatic`);
  const ts=Array.isArray(value.temperature_c)?value.temperature_c:Array(count).fill(value.temperature_c);
  const rs=Array.isArray(value.surface_resistance_m2k_w)?value.surface_resistance_m2k_w:Array(count).fill(value.surface_resistance_m2k_w);
  if(ts.length!==count||rs.length!==count)throw new RangeError(`Boundary ${key} has the wrong cell count`);
  return {kind:'temperature',temperature_c:ts.map(t=>temp(t,`${key} temperature`)),
    surface_resistance_m2k_w:rs.map(r=>num(r,`${key} surface resistance`,true))};
}

/**
 * y runs from top/outside to bottom/inside; x runs left to right.
 * widths_mm/ heights_mm give EACH CELL size; conductivities[y][x] is W/(m K).
 * Boundary R includes convection/radiation in m²K/W. Zero R is Dirichlet.
 * sides may be adiabatic or an explicit horizontal periodic pair.
 * No internal heat sources, anisotropy, fluid flow, radiation or 3D paths.
 */
export function solveThermalMesh(input){
  const dx=axis(input.widths_mm,'widths_mm'),dy=axis(input.heights_mm,'heights_mm');
  const nx=dx.length,ny=dy.length,n=nx*ny;
  if(n>100000)throw new RangeError('A thermal mesh may contain at most 100000 cells');
  if(!Array.isArray(input.conductivities)||input.conductivities.length!==ny||input.conductivities.some(r=>!Array.isArray(r)||r.length!==nx))throw new RangeError('conductivities must match the cell mesh');
  const k=Float64Array.from(input.conductivities.flat().map(v=>num(v,'cell conductivity')));
  if(input.internal_heat_sources || input.anisotropic || input.air_flow || input.radiation_model)throw new RangeError('Only isotropic solid/equivalent-material conduction is supported');
  const b=input.boundaries;
  if(!b || typeof b!=='object')throw new TypeError('boundaries are required');
  const bc={top:boundary(b.top,'top',nx),bottom:boundary(b.bottom,'bottom',nx)};
  const periodic=b.left?.kind==='periodic'&&b.right?.kind==='periodic';
  if(!periodic && (b.left?.kind==='periodic'||b.right?.kind==='periodic'))throw new RangeError('Periodic left and right boundaries must be paired');
  bc.left=periodic?{kind:'periodic'}:boundary(b.left,'left',ny);
  bc.right=periodic?{kind:'periodic'}:boundary(b.right,'right',ny);
  if(!Object.values(bc).some(v=>v.kind==='temperature'))throw new RangeError('A temperature boundary is needed to anchor the solution');
  const diagonal=new Float64Array(n),rhs=new Float64Array(n),gx=new Float64Array(n),gy=new Float64Array(n);
  const edgesI=[],edgesJ=[],edgesG=[];
  const addEdge=(i,j,g)=>{diagonal[i]+=g;diagonal[j]+=g;edgesI.push(i);edgesJ.push(j);edgesG.push(g);};
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const i=y*nx+x;
    if(x+1<nx){const j=i+1;gx[i]=dy[y]/(dx[x]/(2*k[i])+dx[x+1]/(2*k[j]));addEdge(i,j,gx[i]);}
    if(y+1<ny){const j=i+nx;gy[i]=dx[x]/(dy[y]/(2*k[i])+dy[y+1]/(2*k[j]));addEdge(i,j,gy[i]);}
    if(periodic && x===0 && nx>1){const j=i+nx-1;addEdge(i,j,dy[y]/(dx[0]/(2*k[i])+dx[nx-1]/(2*k[j])));}
  }
  const faces={top:[],bottom:[],left:[],right:[]};
  const face=(side,p,i,length,halfDistance)=>{
    if(bc[side].kind!=='temperature')return;
    const r=bc[side].surface_resistance_m2k_w[p],t=bc[side].temperature_c[p];
    const g=length/(r+halfDistance/k[i]);diagonal[i]+=g;rhs[i]+=g*t;
    faces[side].push({cell:i,conductance:g,length_m:length,temperature_c:t,surface_resistance:r});
  };
  for(let x=0;x<nx;x++){face('top',x,x,dx[x],dy[0]/2);face('bottom',x,(ny-1)*nx+x,dx[x],dy[ny-1]/2);}
  for(let y=0;y<ny;y++){face('left',y,y*nx,dy[y],dx[0]/2);face('right',y,(y+1)*nx-1,dy[y],dx[nx-1]/2);}
  const multiply=(v,out)=>{
    for(let i=0;i<n;i++)out[i]=diagonal[i]*v[i];
    for(let e=0;e<edgesG.length;e++){const i=edgesI[e],j=edgesJ[e],g=edgesG[e];out[i]-=g*v[j];out[j]-=g*v[i];}
  };
  // Incomplete Cholesky (zero fill) for the non-periodic five-point matrix.
  const ld=new Float64Array(n),lw=new Float64Array(n),ln=new Float64Array(n),forward=new Float64Array(n);
  let ic=!periodic;
  if(ic)for(let i=0;i<n;i++){
    if(i%nx>0)lw[i]=-gx[i-1]/ld[i-1];
    if(i>=nx)ln[i]=-gy[i-nx]/ld[i-nx];
    const square=diagonal[i]-lw[i]**2-ln[i]**2;
    if(square<=0){ic=false;break;}ld[i]=Math.sqrt(square);
  }
  const precondition=(r,out)=>{
    if(!ic){for(let i=0;i<n;i++)out[i]=r[i]/diagonal[i];return;}
    for(let i=0;i<n;i++)forward[i]=(r[i]-(i%nx>0?lw[i]*forward[i-1]:0)-(i>=nx?ln[i]*forward[i-nx]:0))/ld[i];
    for(let i=n-1;i>=0;i--)out[i]=(forward[i]-(i%nx<nx-1?lw[i+1]*out[i+1]:0)-(i+nx<n?ln[i+nx]*out[i+nx]:0))/ld[i];
  };
  const temperatures=new Float64Array(n),r=new Float64Array(n),z=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);
  const environmentTemps=Object.values(bc).filter(v=>v.kind==='temperature').flatMap(v=>v.temperature_c);
  temperatures.fill(environmentTemps.reduce((s,t)=>s+t,0)/environmentTemps.length);
  multiply(temperatures,ap);for(let i=0;i<n;i++)r[i]=rhs[i]-ap[i];
  const tolerance=num(input.relative_tolerance ?? 1e-10,'relative_tolerance');
  if(tolerance>1e-6)throw new RangeError('relative_tolerance must be at most 1e-6');
  const maxIterations=input.max_iterations ?? 10000;
  if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>30000)throw new RangeError('max_iterations must be 1 to 30000');
  const target=tolerance*Math.max(Math.sqrt(dot(rhs,rhs)),1);
  precondition(r,z);p.set(z);let rz=dot(r,z),iterations=0,residual=Math.sqrt(dot(r,r));
  while(residual>target && iterations<maxIterations){
    multiply(p,ap);const denominator=dot(p,ap);
    if(!(denominator>0))throw new Error('Thermal solver lost a positive-definite search direction');
    const alpha=rz/denominator;
    for(let i=0;i<n;i++){temperatures[i]+=alpha*p[i];r[i]-=alpha*ap[i];}
    iterations++;residual=Math.sqrt(dot(r,r));
    if(residual<=target)break;
    precondition(r,z);const next=dot(r,z),beta=next/rz;rz=next;
    for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];
  }
  if(residual>target)throw new Error(`Thermal mesh did not converge after ${iterations} iterations; refine/review the mesh`);
  const heatFlows={},surfaceTemps={};
  for(const side of Object.keys(faces)){
    heatFlows[side]=faces[side].reduce((s,f)=>s+f.conductance*(f.temperature_c-temperatures[f.cell]),0);
    surfaceTemps[side]=faces[side].map(f=>f.temperature_c-f.conductance*(f.temperature_c-temperatures[f.cell])/f.length_m*f.surface_resistance);
  }
  const totalFlow=Object.values(heatFlows).reduce((s,q)=>s+q,0);
  const maxFlow=Math.max(...Object.values(heatFlows).map(Math.abs),1e-10);
  if(Math.abs(totalFlow)/maxFlow>1e-5)throw new Error('Thermal mesh failed the heat-balance check');
  return {method:'two_dimensional_finite_volume',widths_mm:input.widths_mm,heights_mm:input.heights_mm,
    width_m:dx.reduce((s,v)=>s+v,0),height_m:dy.reduce((s,v)=>s+v,0),conductivities:input.conductivities,boundaries:bc,
    temperatures_c:Array.from({length:ny},(_,y)=>Array.from(temperatures.slice(y*nx,(y+1)*nx))),
    boundary_surface_temperatures_c:surfaceTemps,boundary_heat_flows_w_per_m:heatFlows,
    iterations,preconditioner:ic?'incomplete_cholesky':'jacobi',relative_residual:residual/Math.max(Math.sqrt(dot(rhs,rhs)),1),
    relative_heat_imbalance:Math.abs(totalFlow)/maxFlow,cells:n,references:THERMAL_MESH_REFERENCES};
}

function positions(values){let s=0;return values.map(d=>{const c=s+d/2;s+=d;return c;});}
function interval(centres,v){
  if(v<=centres[0])return [0,0,0];if(v>=centres.at(-1))return [centres.length-1,centres.length-1,0];
  const hi=centres.findIndex(c=>c>=v),lo=hi-1;return [lo,hi,(v-centres[lo])/(centres[hi]-centres[lo])];
}
/** Interpolates the field, using actual boundary surface temperatures at faces. */
export function sampleThermalMesh(result,{x_mm,y_mm}){
  num(x_mm,'x_mm',true);num(y_mm,'y_mm',true);
  const width=result.width_m*1000,height=result.height_m*1000;
  if(x_mm>width+1e-8||y_mm>height+1e-8)throw new RangeError('Sample point is outside the thermal mesh');
  x_mm=Math.min(x_mm,width);y_mm=Math.min(y_mm,height);
  const xs=positions(result.widths_mm),ys=positions(result.heights_mm),nx=xs.length,ny=ys.length;
  const [xl,xh,wx]=interval(xs,x_mm),[yl,yh,wy]=interval(ys,y_mm);
  const mix=(a,b,w)=>a+(b-a)*w;
  const weight=(centres,sizes,lo,hi,value,kl,kh)=>{
    if(lo===hi)return 0;
    const face=centres[lo]+sizes[lo]/2;
    const full=sizes[lo]/(2*kl)+sizes[hi]/(2*kh);
    return value<=face ? (value-centres[lo])/kl/full : (sizes[lo]/(2*kl)+(value-face)/kh)/full;
  };
  const row=y=>mix(result.temperatures_c[y][xl],result.temperatures_c[y][xh],
    weight(xs,result.widths_mm,xl,xh,x_mm,result.conductivities[y][xl],result.conductivities[y][xh]));
  if(y_mm<ys[0]&&result.boundaries.top.kind==='temperature')return mix(mix(result.boundary_surface_temperatures_c.top[xl],result.boundary_surface_temperatures_c.top[xh],wx),row(0),y_mm/ys[0]);
  if(y_mm>ys.at(-1)&&result.boundaries.bottom.kind==='temperature')return mix(row(ny-1),mix(result.boundary_surface_temperatures_c.bottom[xl],result.boundary_surface_temperatures_c.bottom[xh],wx),(y_mm-ys.at(-1))/(height-ys.at(-1)));
  if(x_mm<xs[0]&&result.boundaries.left.kind==='temperature')return mix(mix(result.boundary_surface_temperatures_c.left[yl],result.boundary_surface_temperatures_c.left[yh],wy),mix(result.temperatures_c[yl][0],result.temperatures_c[yh][0],wy),x_mm/xs[0]);
  if(x_mm>xs.at(-1)&&result.boundaries.right.kind==='temperature')return mix(mix(result.temperatures_c[yl][nx-1],result.temperatures_c[yh][nx-1],wy),mix(result.boundary_surface_temperatures_c.right[yl],result.boundary_surface_temperatures_c.right[yh],wy),(x_mm-xs.at(-1))/(width-xs.at(-1)));
  let column=0,edge=result.widths_mm[0];while(column<nx-1&&x_mm>edge+1e-8){column++;edge+=result.widths_mm[column];}
  const verticalWeight=weight(ys,result.heights_mm,yl,yh,y_mm,result.conductivities[yl][column],result.conductivities[yh][column]);
  return mix(row(yl),row(yh),verticalWeight);
}

export function refineThermalMesh(input){
  return {...input,widths_mm:input.widths_mm.flatMap(w=>[w/2,w/2]),heights_mm:input.heights_mm.flatMap(h=>[h/2,h/2]),
    conductivities:input.conductivities.flatMap(row=>{const r=row.flatMap(k=>[k,k]);return [[...r],[...r]];}),
    boundaries:Object.fromEntries(Object.entries(input.boundaries).map(([key,b])=>[key,{...b,
      ...(Array.isArray(b.temperature_c)?{temperature_c:b.temperature_c.flatMap(t=>[t,t])}:{}),
      ...(Array.isArray(b.surface_resistance_m2k_w)?{surface_resistance_m2k_w:b.surface_resistance_m2k_w.flatMap(r=>[r,r])}:{})}]))};
}

/** Two-sided rectangular assembly U. Explicit mesh refinement is mandatory. */
export function calculateNumericalUValue(input){
  if(input.geometry){
    if(input.widths_mm!==undefined||input.heights_mm!==undefined||input.conductivities!==undefined)throw new RangeError('Supply geometry rectangles or raw mesh arrays, not both');
    input={...input,...createMaterialMesh(input.geometry)};
  }
  if(input.boundaries?.top?.kind!=='temperature'||input.boundaries?.bottom?.kind!=='temperature')throw new RangeError('Numerical U requires top and bottom temperature boundaries');
  const sides=[input.boundaries.left?.kind,input.boundaries.right?.kind];
  if(!(sides.every(k=>k==='adiabatic')||sides.every(k=>k==='periodic')))throw new RangeError('Numerical U requires adiabatic or periodic side boundaries');
  if(Array.isArray(input.boundaries.top.temperature_c)||Array.isArray(input.boundaries.bottom.temperature_c))throw new RangeError('Numerical U requires one uniform temperature per environment');
  const delta=temp(input.boundaries.bottom.temperature_c,'inside temperature')-temp(input.boundaries.top.temperature_c,'outside temperature');
  if(delta===0)throw new RangeError('Numerical U requires different environment temperatures');
  let mesh=input,result=solveThermalMesh(mesh),previousU=result.boundary_heat_flows_w_per_m.bottom/(result.width_m*delta);
  const refinements=input.max_refinements ?? 3;
  if(!Number.isInteger(refinements)||refinements<1||refinements>4)throw new RangeError('max_refinements must be 1 to 4');
  const convergence=num(input.mesh_convergence_tolerance ?? .005,'mesh_convergence_tolerance');
  if(convergence>.01)throw new RangeError('Mesh convergence tolerance must be at most 1%');
  const history=[{cells:result.cells,u_value:previousU}];let change=Infinity,level=0;
  while(level<refinements){
    mesh=refineThermalMesh(mesh);result=solveThermalMesh(mesh);
    const u=result.boundary_heat_flows_w_per_m.bottom/(result.width_m*delta);change=Math.abs(u-previousU)/u;
    history.push({cells:result.cells,u_value:u,relative_change:change});previousU=u;level++;
    if(change<=convergence)break;
  }
  if(change>convergence)throw new Error('Numerical U did not stabilise under mesh refinement; use a finer aligned mesh');
  return {...result,element:'thermal_mesh',u_value:previousU,u_value_5dp:Number(previousU.toFixed(5)),u_value_2dp:Number(previousU.toFixed(2)),
    mesh_refinement_history:history,mesh_relative_change:change,
    warnings:['2D isotropic conduction only. Model every material/interface and applicable surface condition. Discrete 3D fixings, cavities and construction junctions need separate assessment.']};
}
