import {SCHEMA} from './schema.mjs';
import {ENGINE_VERSION} from './calculations.mjs';
export function openapiDocument(){
  const defs=JSON.parse(JSON.stringify(SCHEMA.$defs).replaceAll('#/$defs/','#/components/schemas/'));
  const responseSchema={type:'object',required:['request_id','api_version','engine_version','data'],properties:{request_id:{type:'string'},api_version:{const:'1'},engine_version:{type:'string'},data:{}}};
  const response=(description,dataSchema={})=>({description,content:{'application/json':{schema:{...responseSchema,properties:{...responseSchema.properties,data:dataSchema}}}}});
  const error=description=>({description,content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorResponse'}}}});
  const errors={400:error('Malformed JSON or unsupported request syntax'),401:error('Bearer key missing or invalid when configured'),403:error('Origin is not allowed'),404:error('Endpoint or example not found'),405:error('HTTP method is not supported'),413:error('Request exceeds configured size'),415:error('JSON media type required; compressed requests unsupported'),422:error('Schema, physical scope or numeric calculation input error'),429:error('Request rate exceeded'),503:error('Queue full, queue timeout, shutdown or worker failure'),504:error('Calculation deadline exceeded')};
  const get=description=>({get:{summary:description,responses:{200:response(description),...errors}}});
  const resultTypes={CalculateRequest:'CalculationResult',BatchRequest:'BatchResult',ProjectRequest:'ProjectResult',ThicknessRequest:'ThicknessResult',NetworkRequest:'NetworkResult'};
  const post=(summary,definition,resultType=resultTypes[definition])=>({post:{summary,requestBody:{required:true,content:{'application/json':{schema:{$ref:`#/components/schemas/${definition}`}}}},responses:{200:response(summary,{$ref:`#/components/schemas/${resultType}`}),...errors}}});
  const issueSchema={type:'object',properties:{path:{type:'string'},keyword:{type:'string'},message:{type:'string'}}};
  const errorBody={type:'object',required:['code','message'],properties:{
    code:{type:'string'},message:{type:'string'},issues:{type:'array',items:issueSchema},
  }};
  const errorResponse={type:'object',required:['request_id','api_version','engine_version','error'],properties:{
    request_id:{type:'string'},api_version:{const:'1'},engine_version:{type:'string'},error:errorBody,
  }};
  const number={type:'number'},bool={type:'boolean'},string={type:'string'},list={type:'array',items:{}},resultRef={$ref:'#/components/schemas/CalculationResult'};
  const resultSchemas={
    CalculationResult:{type:'object',required:['u_value','u_value_2dp','u_value_5dp'],properties:{
      u_value:{type:'number',minimum:0,description:'Unrounded thermal transmittance in W/(m² K)'},u_value_2dp:number,u_value_5dp:number,
      reference_area_m2:number,heat_loss_coefficient_w_k:number,warnings:{type:'array',items:string},method:string,element:string}},
    ValidationResult:{type:'object',required:['valid','element','warnings'],properties:{valid:{const:true},element:string,warnings:{type:'array',items:string}}},
    BatchResult:{type:'object',required:['items','succeeded','failed'],properties:{succeeded:{type:'integer'},failed:{type:'integer'},
      items:{type:'array',items:{type:'object',required:['id','ok'],properties:{id:string,ok:bool,result:resultRef,error:{$ref:'#/components/schemas/ErrorResponse/properties/error'}}}}}},
    ProjectResult:{type:'object',required:['reference_area_m2','elements','junctions','transmission_heat_loss_coefficient_w_k','area_weighted_u_value_w_m2k'],properties:{reference_area_m2:number,elements:list,junctions:list,
      transmission_heat_loss_coefficient_w_k:number,fabric_heat_loss_coefficient_w_k:number,junction_heat_loss_coefficient_w_k:number,area_weighted_u_value_w_m2k:number,transmission_heat_flow_w:number,temperature_difference_k:number}},
    ThicknessResult:{type:'object',required:['achievable','result','evaluations','target_u_value_w_m2k'],properties:{achievable:bool,result:resultRef,evaluations:{type:'integer'},target_u_value_w_m2k:number,
      thickness_mm:number,previous_grid_thickness_mm:number,maximum_grid_thickness_mm:number,search_method:string,reason:string,construction:{$ref:'#/components/schemas/Construction'}}},
    NetworkResult:{type:'object',required:['method','nodes','inside_elements','links','effective_heat_loss_coefficient_w_k','relative_heat_imbalance'],properties:{method:string,nodes:list,inside_elements:list,links:list,
      effective_heat_loss_coefficient_w_k:number,external_heat_loss_coefficient_w_k:number,relative_heat_imbalance:number,transmission_heat_flow_w:number,temperature_difference_k:number}},
  };
  return {openapi:'3.1.0',info:{title:'U-value Workshop calculation backend',version:ENGINE_VERSION,
    description:'Stateless independent U-value calculations. See method metadata and METHODS.md for supported physical scope. Bearer authentication is required only when UVALUE_API_KEY is configured.'},
    servers:[{url:'/'}],security:[{bearerAuth:[]}],paths:{
      '/health':{get:{summary:'Liveness',security:[],responses:{200:response('Service is running')}}},
      '/ready':{get:{summary:'Worker readiness',security:[],responses:{200:response('Calculation worker available'),503:response('Workers are starting or shutting down')}}},
      '/v1/methods':get('Supported methods, units and limitations'),'/v1/schema':get('Complete JSON Schema contract'),'/v1/openapi.json':{get:{summary:'Raw OpenAPI 3.1 contract',responses:{200:{description:'Raw OpenAPI document',content:{'application/json':{schema:{type:'object',required:['openapi','info','paths']}}}},...errors}}},
      '/v1/examples':get('Example ids and labels'),'/v1/examples/{id}':{get:{summary:'One complete example construction',parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],responses:{200:response('Example input'),404:error('Unknown example'),...errors}}},
      '/v1/calculate':post('Calculate one construction','CalculateRequest'),'/v1/validate':post('Validate structure and physical applicability','CalculateRequest','ValidationResult'),
      '/v1/batch':post('Calculate up to 100 constructions','BatchRequest'),'/v1/project':post('Aggregate net opaque areas, openings and junction heat loss','ProjectRequest'),
      '/v1/solve-thickness':post('Find minimum material thickness on a supplied grid','ThicknessRequest'),
      '/v1/unheated-network':post('Solve connected unheated spaces without gains','NetworkRequest'),
    },components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Optional service key for server-to-server integration; do not embed this key in a public website bundle.'}},
      schemas:{...defs,...resultSchemas,ErrorResponse:errorResponse}}};
}
