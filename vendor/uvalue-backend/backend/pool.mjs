import {Worker} from 'node:worker_threads';
export class ServiceError extends Error{
  constructor(code,message,status=503){super(message);this.name='ServiceError';this.code=code;this.status=status;}
}
export class CalculationPool{
  constructor({size=2,maxQueue=32,timeoutMs=15000,workerUrl=new URL('./worker.mjs',import.meta.url)}={}){
    for(const [key,v,min,max]of [['size',size,1,8],['maxQueue',maxQueue,0,1000],['timeoutMs',timeoutMs,10,120000]])
      if(!Number.isInteger(v)||v<min||v>max)throw new RangeError(`${key} must be an integer from ${min} to ${max}`);
    this.size=size;this.maxQueue=maxQueue;this.timeoutMs=timeoutMs;this.workerUrl=workerUrl;
    this.slots=[];this.queue=[];this.closed=false;this.nextId=0;
    for(let i=0;i<size;i++)this.spawn(i);
  }
  spawn(index){
    if(this.closed)return;
    const worker=new Worker(this.workerUrl,{type:'module',execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256,stackSizeMb:8}});
    const slot={worker,index,ready:false,job:null,dead:false};this.slots[index]=slot;
    worker.on('message',message=>{
      if(slot.dead)return;
      if(message.ready){slot.ready=true;this.drain();return;}
      if(!slot.job||message.id!==slot.job.id){this.retire(slot,new ServiceError('WORKER_FAILED','Calculation worker returned an invalid response'));return;}
      const job=slot.job;slot.job=null;
      if(message.ok)this.settle(job,null,message.data);
      else {const e=new ServiceError(message.error.code,message.error.message,message.error.status);e.issues=message.error.issues;this.settle(job,e);}
      this.drain();
    });
    worker.on('error',()=>this.retire(slot,new ServiceError('WORKER_FAILED','Calculation worker failed; retry the request')));
    worker.on('exit',()=>{if(!slot.dead)this.retire(slot,new ServiceError('WORKER_FAILED','Calculation worker stopped; retry the request'));});
  }
  settle(job,error,data){
    if(job.settled)return;job.settled=true;clearTimeout(job.timer);
    job.signal?.removeEventListener('abort',job.abort);
    if(error)job.reject(error);else job.resolve(data);
  }
  retire(slot,error){
    if(slot.dead)return;slot.dead=true;
    if(slot.job){this.settle(slot.job,error);slot.job=null;}
    void slot.worker.terminate();if(!this.closed)this.spawn(slot.index);
  }
  drain(){
    if(this.closed)return;
    for(const slot of this.slots){
      if(!slot.ready||slot.dead||slot.job)continue;
      let job;while((job=this.queue.shift())&&job.settled){}if(!job)break;
      slot.job=job;job.slot=slot;
      clearTimeout(job.timer);
      job.timer=setTimeout(()=>this.retire(slot,new ServiceError('CALCULATION_TIMEOUT','Calculation exceeded its time budget',504)),this.timeoutMs);
      slot.worker.postMessage({id:job.id,operation:job.operation,payload:job.payload});
    }
  }
  submit(operation,payload,{signal}={}){
    if(this.closed)return Promise.reject(new ServiceError('SERVICE_CLOSED','Calculation service is shutting down'));
    if(signal?.aborted)return Promise.reject(new ServiceError('REQUEST_CANCELLED','Request was cancelled',499));
    const available=this.slots.some(s=>s.ready&&!s.dead&&!s.job);
    if(!available&&this.queue.length>=this.maxQueue)return Promise.reject(new ServiceError('SERVICE_BUSY','Calculation queue is full; retry shortly'));
    return new Promise((resolve,reject)=>{
      const job={id:++this.nextId,operation,payload,resolve,reject,signal,slot:null,settled:false};
      job.abort=()=>{
        const error=new ServiceError('REQUEST_CANCELLED','Request was cancelled',499);
        if(job.slot?.job===job)this.retire(job.slot,error);
        else {this.queue=this.queue.filter(x=>x!==job);this.settle(job,error);}
      };
      job.timer=setTimeout(()=>{this.queue=this.queue.filter(x=>x!==job);this.settle(job,new ServiceError('QUEUE_TIMEOUT','Calculation waited too long for a worker; retry shortly'));},this.timeoutMs);
      signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.drain();
    });
  }
  stats(){return {workers:this.size,ready:this.slots.filter(s=>s.ready&&!s.dead).length,running:this.slots.filter(s=>!!s.job).length,queued:this.queue.length};}
  async close(){
    if(this.closed)return;this.closed=true;
    const error=new ServiceError('SERVICE_CLOSED','Calculation service is shutting down');
    for(const job of this.queue)this.settle(job,error);this.queue=[];
    for(const slot of this.slots){slot.dead=true;if(slot.job)this.settle(slot.job,error);slot.job=null;}
    await Promise.all(this.slots.map(s=>s.worker.terminate()));
  }
}
