import test from 'node:test';
import assert from 'node:assert/strict';
import {solveThermalMesh,sampleThermalMesh,calculateNumericalUValue} from './thermal_mesh.mjs';
const fixed=(temperature_c,surface_resistance_m2k_w)=>({kind:'temperature',temperature_c,surface_resistance_m2k_w});
const ad={kind:'adiabatic'};
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
function segment(length,n,q=1){const a=Array.from({length:n},(_,i)=>q**i),s=a.reduce((v,w)=>v+w,0);return a.map(v=>length*v/s);}

test('Published ISO10211 case 1: all 28 reference temperatures within 0.1 C',()=>{
  // Geometry/boundaries/reference values: Buildingphysics.com public validation.
  const n=80,mesh={widths_mm:Array(n).fill(50),heights_mm:Array(2*n).fill(50),
    conductivities:Array.from({length:2*n},()=>Array(n).fill(.2)),
    boundaries:{top:fixed(20,0),bottom:fixed(0,0),left:fixed(0,0),right:ad}};
  const r=solveThermalMesh(mesh);
  const refs=[[9.7,13.4,14.7,15.1],[5.3,8.6,10.3,10.8],[3.2,5.6,7.0,7.5],
    [2.0,3.6,4.7,5.0],[1.3,2.3,3.0,3.2],[.7,1.4,1.8,1.9],[.3,.6,.8,.9]];
  refs.forEach((row,y)=>row.forEach((expected,x)=>near(sampleThermalMesh(r,{x_mm:(x+1)*1000,y_mm:(y+1)*1000}),expected,.1)));
  assert.ok(r.relative_heat_imbalance<1e-7);
});
test('Published ISO10211 case 2: heat flow and nine material-interface temperatures',()=>{
  // A=.5 m wide, 47.5 mm high; conductor 230, solids1.15/.12, insulation.029.
  // Mesh aligned to the published geometry; geometric spacing from HEAT2 fixture.
  const dx=[...segment(1.5,4,.980392158),...segment(13.5,85,.980392158),...segment(485,210,1.02)];
  const dy=[...segment(6,18,1.0262).reverse(),...segment(5,28,1.0262).reverse(),
    ...segment(1.5,15,1.0262).reverse(),...segment(33.5,85,.9745).reverse(),1.5];
  let y=0;const k=dy.map(h=>{const cy=y+h/2;y+=h;let x=0;return dx.map(w=>{const cx=x+w/2;x+=w;
    if(cy<6)return 1.15;if(cy<11&&cx<15)return .12;if(cy<12.5&&cx<15)return 230;
    if(cy>=46||cy>=12.5&&cx<1.5)return 230;return .029;});});
  const r=solveThermalMesh({widths_mm:dx,heights_mm:dy,conductivities:k,
    boundaries:{top:fixed(0,.06),bottom:fixed(20,.11),left:ad,right:ad}});
  near(r.boundary_heat_flows_w_per_m.bottom,9.5,.1);
  const pts=[[0,0,7.1],[500,0,.8],[0,6,7.9],[15,6,6.3],[500,6,.8],
    [0,11,16.4],[15,11,16.3],[0,46,16.8],[500,47.5,18.3]];
  for(const [x_mm,y_mm,t]of pts)near(sampleThermalMesh(r,{x_mm,y_mm}),t,.1);
  assert.ok(r.relative_heat_imbalance<1e-7);
});
test('Homogeneous layered assembly equals the independent series-resistance solution',()=>{
  const m={widths_mm:[100,200,300],heights_mm:[10,100,20],conductivities:[[.13,.13,.13],[.04,.04,.04],[.2,.2,.2]],
    boundaries:{top:fixed(0,.04),bottom:fixed(20,.13),left:ad,right:ad}};
  const r=calculateNumericalUValue(m);
  near(r.u_value,1/(.04+.01/.13+.1/.04+.02/.2+.13));
  assert.equal(r.mesh_refinement_history.length,2);
  const shifted=calculateNumericalUValue({...m,boundaries:{...m.boundaries,top:fixed(10,.04),bottom:fixed(30,.13)}});
  near(shifted.u_value,r.u_value);
});
test('Parallel conduction and periodic boundaries preserve exact uniform-gradient heat flow',()=>{
  const input={widths_mm:[200,800],heights_mm:[50,50],conductivities:[[.2,.04],[.2,.04]],
    boundaries:{top:fixed(0,0),bottom:fixed(20,0),left:{kind:'periodic'},right:{kind:'periodic'}}};
  near(calculateNumericalUValue(input).u_value,(.2*.2+.8*.04)/.1);
});
test('Bad geometry, unanchored solutions and nonconvergence reject',()=>{
  const a={widths_mm:[10],heights_mm:[10],conductivities:[[.04]],
    boundaries:{top:fixed(0,.04),bottom:fixed(20,.13),left:ad,right:ad}};
  assert.throws(()=>solveThermalMesh({...a,conductivities:[[0]]}),/positive/);
  assert.throws(()=>solveThermalMesh({...a,boundaries:{top:ad,bottom:ad,left:ad,right:ad}}),/anchor/);
  assert.throws(()=>solveThermalMesh({...a,boundaries:{...a.boundaries,left:{kind:'periodic'}}}),/paired/);
  assert.throws(()=>calculateNumericalUValue({...a,max_refinements:0}),/1 to 4/);
  assert.throws(()=>calculateNumericalUValue({...a,boundaries:{...a.boundaries,bottom:fixed(0,.13)}}),/different/);
  assert.throws(()=>sampleThermalMesh(solveThermalMesh(a),{x_mm:11,y_mm:0}),/outside/);
});
