import {parentPort} from 'node:worker_threads';
import {runOperation} from './calculations.mjs';
import {InputError} from './schema.mjs';
parentPort.on('message',({id,operation,payload})=>{
  try{parentPort.postMessage({id,ok:true,data:runOperation(operation,payload)});}
  catch(error){parentPort.postMessage({id,ok:false,error:error instanceof InputError?
    {code:error.code,message:error.message,issues:error.issues,status:422}:
    {code:'INTERNAL_ERROR',message:'Calculation failed unexpectedly',status:500}});}
});
parentPort.postMessage({ready:true});
