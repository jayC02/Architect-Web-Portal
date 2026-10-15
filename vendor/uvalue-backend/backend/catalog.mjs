import {readFile} from 'node:fs/promises';
import {ENGINE_VERSION,API_VERSION} from './calculations.mjs';
export const METHODS=[
 ['layered_wall','Wall','Combined resistance with explicit non-metal sections'],
 ['layered_roof','Roof','Combined resistance; supported installation and rain corrections'],
 ['exposed_floor','Exposed floor','Downward plane construction'],
 ['slab_on_ground','Slab on ground','Steady ground model and restricted perimeter insulation'],
 ['suspended_ground_floor','Suspended ground floor','Natural ventilation, deck, base and specified void walls'],
 ['basement_floor','Basement floor','Steady below-ground floor'],
 ['basement_wall','Basement wall','Coupled below-ground floor/wall geometry'],
 ['heated_basement','Heated basement','Floor plus below-ground walls; combined ground-contact area'],
 ['unheated_basement','Floor over unheated basement','Separating deck and basement heat balance'],
 ['ceiling_insulated_roof','Ceiling-insulated pitched roof','Natural uninsulated roof-space table'],
 ['rafter_roof_flat_ceiling','Rafter roof over flat ceiling','Sloped material resistance and flat ceiling area'],
 ['tapered_roof','Tapered flat roof','Planar triangular and one-axis rectangular area integration'],
 ['thermal_mesh','Numerical 2D assembly','Isotropic conduction with refinement and heat-balance checks'],
 ['window','Window','Supplied glazing/frame projected areas, U-values and edge Ψ'],
 ['door','Door','Supplied infill/frame projected areas, U-values and edge Ψ'],
 ['supplied_u','Externally assessed element','Supplied whole-element U with evidence'],
].map(([id,label,scope])=>({id,label,scope,status:'implemented_with_stated_scope',
  validation:id==='window'||id==='door'?'Component formula and arithmetic/invariance tests':id==='supplied_u'?'Input and aggregation tests':'See METHODS.md for published references and individual tests'}));
export const CAPABILITIES={api_version:API_VERSION,engine_version:ENGINE_VERSION,methods:METHODS,
  operations:['calculate','validate','batch','project','thickness','unheated-network'],
  units:{u_value:'W/(m² K)',conductivity:'W/(m K)',resistance:'m² K/W',layer_thickness:'mm',ground_length:'m',area:'m²',linear_transmittance:'W/(m K)',point_transmittance:'W/K',heat_loss_coefficient:'W/K'},
  limitations:['Exact Elmhurst/BuildDesk equivalence and certification remain unverified.',
    'No whole-building energy demand, condensation, mechanical ventilation or seasonal ground heat-flow model.',
    'Numerical method is 2D isotropic conduction, not a 3D or airflow/radiation solver.',
    'Material, glazing/frame and assessed bridge evidence must be supplied and checked by the caller.'],
  schema_url:'/v1/schema',openapi_url:'/v1/openapi.json'};
const extraExamples=[
  {id:'window-components',label:'Window with supplied frame, glazing and spacer values',input:{name:'Synthetic window component example',element:'window',opening:{total_area_m2:2,
    projected_areas_non_overlapping:true,component_boundaries_consistent:true,
    components:[{kind:'frame',area_m2:.4,u_value_w_m2k:1.3,evidence:'Illustrative supplied frame value'},
      {kind:'glazing',area_m2:1.6,u_value_w_m2k:1.1,evidence:'Illustrative supplied glazing value'}],
    edges:[{length_m:5,psi_w_mk:.04,evidence:'Illustrative supplied spacer value'}]}}},
  {id:'door-components',label:'Door with supplied frame and opaque panel',input:{name:'Synthetic opaque door example',element:'door',opening:{total_area_m2:2,
    projected_areas_non_overlapping:true,component_boundaries_consistent:true,
    components:[{kind:'frame',area_m2:.3,u_value_w_m2k:1.5,evidence:'Illustrative frame'},
      {kind:'panel',area_m2:1.7,u_value_w_m2k:.8,evidence:'Illustrative panel'}],edges:[{length_m:5,psi_w_mk:.03,evidence:'Illustrative assessed panel edge'}]}}},
];
let loaded;
export async function examples(){
  if(!loaded)loaded=(async()=>{
    const manifest=JSON.parse(await readFile(new URL('./example-manifest.json',import.meta.url),'utf8'));
    const entries=await Promise.all(manifest.map(async e=>({id:e.file.replace(/^example-|\.json$/g,''),label:e.label,
      input:JSON.parse(await readFile(new URL('../'+e.file,import.meta.url),'utf8'))})));
    return [...entries,...extraExamples];
  })();
  return loaded;
}
