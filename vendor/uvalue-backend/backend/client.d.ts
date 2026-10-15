import type {Construction,CalculateRequest,BatchRequest,ProjectRequest,ThicknessRequest,NetworkRequest} from './contracts.js';
export {Construction,CalculateRequest,BatchRequest,ProjectRequest,ThicknessRequest,NetworkRequest} from './contracts.js';
export interface CalculationResult {u_value:number;u_value_2dp:number;u_value_5dp:number;warnings?:string[];reference_area_m2?:number;heat_loss_coefficient_w_k?:number;[key:string]:unknown;}
export interface Issue {path:string;keyword:string;message:string;}
export class UValueApiError extends Error {code:string;status:number;issues:Issue[];requestId?:string;}
export class UValueClient {
  constructor(options?:{baseUrl?:string;token?:string|(()=>string|Promise<string>);fetch?:typeof fetch;timeoutMs?:number});
  health(options?:{signal?:AbortSignal}):Promise<{status:string;workers:number;ready:number;running:number;queued:number}>;
  methods(options?:{signal?:AbortSignal}):Promise<Record<string,unknown>>;
  schema(options?:{signal?:AbortSignal}):Promise<Record<string,unknown>>;
  examples(options?:{signal?:AbortSignal}):Promise<Array<{id:string;label:string}>>;
  example(id:string,options?:{signal?:AbortSignal}):Promise<{id:string;label:string;input:Construction}>;
  calculate(construction:Construction,options?:CalculateRequest['options'],requestOptions?:{signal?:AbortSignal}):Promise<CalculationResult>;
  validate(construction:Construction,options?:{signal?:AbortSignal}):Promise<{valid:true;element:string;warnings:string[]}>;
  batch(items:BatchRequest['items'],options?:BatchRequest['options'],requestOptions?:{signal?:AbortSignal}):Promise<{items:Array<{id:string;ok:boolean;result?:CalculationResult;error?:{code:string;message:string;issues:Issue[]}}>;succeeded:number;failed:number}>;
  project(project:ProjectRequest,options?:{signal?:AbortSignal}):Promise<Record<string,unknown>>;
  solveThickness(input:ThicknessRequest,options?:{signal?:AbortSignal}):Promise<{achievable:boolean;thickness_mm?:number;result:CalculationResult;construction?:Construction;[key:string]:unknown}>;
  unheatedNetwork(input:NetworkRequest,options?:{signal?:AbortSignal}):Promise<Record<string,unknown>>;
}
