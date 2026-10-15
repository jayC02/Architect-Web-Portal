/** Browser/Node client. Keep private service keys in your website's server code. */
export class UValueApiError extends Error{
  constructor(message,{code='NETWORK_ERROR',status=0,issues=[],requestId,cause}={}){
    super(message,{cause});this.name='UValueApiError';Object.assign(this,{code,status,issues,requestId});
  }
}
export class UValueClient{
  constructor({baseUrl='',token,fetch:fetchImpl=globalThis.fetch,timeoutMs=35000}={}){
    if(typeof fetchImpl!=='function')throw new TypeError('A fetch implementation is required');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('timeoutMs must be positive');
    this.baseUrl=baseUrl.replace(/\/$/,'');this.token=token;this.fetch=fetchImpl;this.timeoutMs=timeoutMs;
  }
  async request(path,{body,signal,raw=false}={}){
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error('Request timed out')),this.timeoutMs);
    try{
      const token=typeof this.token==='function'?await this.token():this.token;
      const response=await this.fetch(this.baseUrl+path,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
      let json;try{json=await response.json();}catch{throw new UValueApiError('API returned an invalid JSON response',{code:'INVALID_RESPONSE',status:response.status});}
      if(!response.ok)throw new UValueApiError(json.error?.message??`HTTP ${response.status}`,{code:json.error?.code??'HTTP_ERROR',status:response.status,issues:json.error?.issues??[],requestId:json.request_id});
      return raw?json:json.data;
    }catch(error){
      if(error instanceof UValueApiError)throw error;
      throw new UValueApiError(controller.signal.aborted?'Calculation request was cancelled or timed out':'Could not reach the calculation API',
        {code:controller.signal.aborted?'REQUEST_ABORTED':'NETWORK_ERROR',cause:error});
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  health(options){return this.request('/health',options);}
  methods(options){return this.request('/v1/methods',options);}
  schema(options){return this.request('/v1/schema',options);}
  examples(options){return this.request('/v1/examples',options);}
  example(id,options){return this.request('/v1/examples/'+encodeURIComponent(id),options);}
  calculate(construction,options={},requestOptions={}){return this.request('/v1/calculate',{...requestOptions,body:{construction,options}});}
  validate(construction,requestOptions={}){return this.request('/v1/validate',{...requestOptions,body:{construction}});}
  batch(items,options={},requestOptions={}){return this.request('/v1/batch',{...requestOptions,body:{items,options}});}
  project(project,requestOptions={}){return this.request('/v1/project',{...requestOptions,body:project});}
  solveThickness(input,requestOptions={}){return this.request('/v1/solve-thickness',{...requestOptions,body:input});}
  unheatedNetwork(input,requestOptions={}){return this.request('/v1/unheated-network',{...requestOptions,body:input});}
}
