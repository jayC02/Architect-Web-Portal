import http from 'node:http';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CalculationPool,ServiceError} from './pool.mjs';
import {SCHEMA,InputError,inspectJson} from './schema.mjs';
import {ENGINE_VERSION,API_VERSION} from './calculations.mjs';
import {CAPABILITIES,examples} from './catalog.mjs';
import {openapiDocument} from './openapi.mjs';
const routes=new Map([['/v1/calculate','calculate'],['/v1/validate','validate'],['/v1/batch','batch'],['/v1/project','project'],['/v1/solve-thickness','thickness'],['/v1/unheated-network','unheated-network']]);
const sha=text=>createHash('sha256').update(text).digest();
const integer=(x,label,min,max)=>{if(!Number.isInteger(x)||x<min||x>max)throw new RangeError(`${label} must be an integer from ${min} to ${max}`);return x;};
function allowedOrigins(values){
  return new Set(values.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.origin!==value||url.username||url.password)throw new RangeError('CORS origins must be exact HTTP(S) origins without paths');return value;}));
}
async function readJson(req,maxBytes){
  const contentType=req.headers['content-type']??'';
  if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(contentType))throw new ServiceError('UNSUPPORTED_MEDIA_TYPE','Use Content-Type: application/json with UTF-8',415);
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new ServiceError('UNSUPPORTED_CONTENT_ENCODING','Compressed request bodies are not supported',415);
  if(Number(req.headers['content-length'])>maxBytes)throw new ServiceError('REQUEST_TOO_LARGE',`Maximum JSON body size is ${maxBytes} bytes`,413);
  const bytes=await new Promise((resolve,reject)=>{
    const chunks=[];let length=0,settled=false;
    req.on('data',chunk=>{
      if(settled)return;length+=chunk.length;
      if(length>maxBytes){settled=true;chunks.length=0;reject(new ServiceError('REQUEST_TOO_LARGE',`Maximum JSON body size is ${maxBytes} bytes`,413));return;}
      chunks.push(chunk);
    });
    req.once('end',()=>{if(!settled){settled=true;resolve(Buffer.concat(chunks));}});
    req.once('error',()=>{if(!settled){settled=true;reject(new ServiceError('REQUEST_ABORTED','Request body was interrupted',400));}});
    req.once('aborted',()=>{if(!settled){settled=true;reject(new ServiceError('REQUEST_ABORTED','Request body was interrupted',400));}});
  });
  let value;
  try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(text);}
  catch{throw new ServiceError('INVALID_JSON','Request body must contain valid UTF-8 JSON',400);}
  inspectJson(value);return value;
}
export function createBackend({pool,poolOptions={},apiKey='',corsOrigins=[],maxBodyBytes=1024*1024,maxResponseBytes=8*1024*1024,
  requestsPerMinute=120,maxRateLimitClients=10000}={}){
  integer(maxBodyBytes,'maxBodyBytes',64,16*1024*1024);integer(maxResponseBytes,'maxResponseBytes',1024,32*1024*1024);
  integer(requestsPerMinute,'requestsPerMinute',0,1000000);integer(maxRateLimitClients,'maxRateLimitClients',1,100000);
  if(apiKey&&(typeof apiKey!=='string'||apiKey.length<24||apiKey.length>1024))throw new RangeError('Configured API key must contain 24 to 1024 characters');
  const origins=allowedOrigins(corsOrigins),keyHash=apiKey?sha(apiKey):null;
  const calculations=pool??new CalculationPool(poolOptions),rates=new Map();let closing=false;
  function rateLimit(req){
    if(!requestsPerMinute)return;
    const now=Date.now(),client=req.socket.remoteAddress??'unknown';
    let r=rates.get(client);
    if(!r||now-r.started>=60000){r={started:now,count:0};if(!rates.has(client)&&rates.size>=maxRateLimitClients)rates.delete(rates.keys().next().value);rates.set(client,r);}
    if(++r.count>requestsPerMinute){const e=new ServiceError('RATE_LIMITED','Request rate exceeded; retry after the current window',429);e.retryAfter=Math.max(1,Math.ceil((60000-now+r.started)/1000));throw e;}
  }
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID(),controller=new AbortController();
    res.on('close',()=>{if(!res.writableFinished)controller.abort();});
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId};
    const envelope=data=>({request_id:requestId,api_version:API_VERSION,engine_version:ENGINE_VERSION,data});
    function send(status,body,extra={}){
      if(res.destroyed||res.writableEnded)return;
      const bytes=Buffer.from(JSON.stringify(body));
      if(bytes.length>maxResponseBytes&&status<400)throw new ServiceError('RESULT_TOO_LARGE','Result exceeds the response limit; omit mesh fields or reduce the batch',422);
      res.writeHead(status,{...headers,...extra,'Content-Length':bytes.length});res.end(bytes);
    }
    try{
      let url;try{url=new URL(req.url,'http://localhost');}catch{throw new ServiceError('INVALID_URL','Request target is not a valid URL',400);}
      if(url.search)throw new ServiceError('UNSUPPORTED_QUERY','This API does not accept query parameters',400);
      const path=url.pathname,origin=req.headers.origin;
      if(origin){headers.Vary='Origin';if(!origins.has(origin))throw new ServiceError('ORIGIN_NOT_ALLOWED','This website origin is not configured',403);headers['Access-Control-Allow-Origin']=origin;}
      if(req.method==='OPTIONS'){
        if(!origin)throw new ServiceError('INVALID_PREFLIGHT','CORS preflight requires an allowed Origin',400);
        const method=req.headers['access-control-request-method'];
        const requested=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(!['GET','POST','OPTIONS'].includes(method)||requested.some(x=>!['authorization','content-type'].includes(x)))throw new ServiceError('INVALID_PREFLIGHT','Requested method or headers are not allowed',403);
        res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});res.end();return;
      }
      if(path==='/health'||path==='/ready'){
        if(req.method!=='GET')throw new ServiceError('METHOD_NOT_ALLOWED','Use GET for service health',405);
        const stats=calculations.stats(),ready=!closing&&stats.ready>0;
        send(path==='/ready'&&!ready?503:200,envelope({status:path==='/ready'?(ready?'ready':'starting'):'ok',...stats}));return;
      }
      rateLimit(req);
      if(keyHash){const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'');
        if(!match||!timingSafeEqual(keyHash,sha(match[1])))throw new ServiceError('UNAUTHORIZED','A valid service bearer key is required',401);}
      if(closing)throw new ServiceError('SERVICE_CLOSED','Calculation service is shutting down');
      if(req.method==='GET'){
        if(path==='/v1/methods'){send(200,envelope(CAPABILITIES));return;}
        if(path==='/v1/schema'){send(200,envelope(SCHEMA));return;}
        if(path==='/v1/openapi.json'){
          // OpenAPI tools need the document at the root, rather than the normal data envelope.
          send(200,openapiDocument());return;
        }
        if(path==='/v1/examples'){send(200,envelope((await examples()).map(({id,label})=>({id,label}))));return;}
        if(path.startsWith('/v1/examples/')){
          let id;try{id=decodeURIComponent(path.slice('/v1/examples/'.length));}catch{throw new ServiceError('INVALID_URL','Example id has invalid URL encoding',400);}
          const example=(await examples()).find(e=>e.id===id);
          if(!example)throw new ServiceError('NOT_FOUND','Unknown example id',404);send(200,envelope(example));return;
        }
        if(routes.has(path))throw new ServiceError('METHOD_NOT_ALLOWED','Use POST with a JSON request body',405);
      }else if(req.method==='POST'&&routes.has(path)){
        const payload=await readJson(req,maxBodyBytes),data=await calculations.submit(routes.get(path),payload,{signal:controller.signal});
        send(200,envelope(data));return;
      }else if(['/v1/methods','/v1/schema','/v1/openapi.json','/v1/examples'].includes(path)||routes.has(path))throw new ServiceError('METHOD_NOT_ALLOWED','HTTP method is not supported for this endpoint',405);
      throw new ServiceError('NOT_FOUND','API endpoint not found',404);
    }catch(error){
      const known=error instanceof ServiceError||error instanceof InputError;
      const status=error instanceof InputError?422:known?error.status:500;
      const code=known?error.code:'INTERNAL_ERROR',message=known?error.message:'The service could not complete the request';
      const extra=status===401?{'WWW-Authenticate':'Bearer'}:status===429?{'Retry-After':String(error.retryAfter)}:{};
      if(status===405)extra.Allow=routes.has(new URL(req.url,'http://localhost').pathname)?'POST, OPTIONS':'GET, OPTIONS';
      try{send(status,{request_id:requestId,api_version:API_VERSION,engine_version:ENGINE_VERSION,error:{code,message,...(error.issues?{issues:error.issues}:{})}},extra);}
      catch{res.destroy();}
      if(!req.complete)req.resume();
    }
  });
  server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;
  return {server,pool:calculations,async close(){
    if(closing)return;closing=true;
    const stopped=new Promise(resolve=>{if(!server.listening)resolve();else server.close(resolve);});
    await calculations.close();server.closeIdleConnections();await stopped;
  }};
}
function envInteger(name,fallback,min,max){return integer(process.env[name]===undefined?fallback:Number(process.env[name]),name,min,max);}
export async function startFromEnvironment(){
  const host=process.env.HOST??'127.0.0.1',port=envInteger('PORT',8787,1,65535);
  const app=createBackend({apiKey:process.env.UVALUE_API_KEY??'',corsOrigins:(process.env.CORS_ORIGINS??'').split(',').map(x=>x.trim()).filter(Boolean),
    maxBodyBytes:envInteger('MAX_BODY_BYTES',1024*1024,64,16*1024*1024),requestsPerMinute:envInteger('REQUESTS_PER_MINUTE',120,0,1000000),
    poolOptions:{size:envInteger('CALCULATION_WORKERS',2,1,8),maxQueue:envInteger('MAX_QUEUE',32,0,1000),timeoutMs:envInteger('CALCULATION_TIMEOUT_MS',15000,10,120000)}});
  try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,host,resolve);});}
  catch(error){await app.close();throw error;}
  console.log(`U-value backend ${ENGINE_VERSION} listening on http://${host}:${port}`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close().then(()=>{process.exitCode=0;});});
  return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startFromEnvironment().catch(error=>{console.error(error.message);process.exitCode=1;});
