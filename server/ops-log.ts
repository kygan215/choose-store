import pg from "pg";
import crypto from "node:crypto";
import type {RequestHandler} from "express";

export type OpsEvent={tenantId?:number|null;service:"api"|"worker"|"web";level:"info"|"warn"|"error";module:string;event:string;message:string;requestId?:string;taskType?:string;taskId?:string;durationMs?:number;statusCode?:number;details?:Record<string,unknown>;at?:string};
// No request bodies, cookies, headers, search terms or sales figures enter this allowlist.
const detailKeys=new Set(["method","path","code","error","stack","queue_id","attempt","completed","total","stage","reason","filename","line","column"]);
export function safeLogText(value:unknown,max=800):string {
  return String(value??"")
    .replace(/https?:\/\/[^\s"'<>]+/gi,url=>url.split(/[?#]/)[0])
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,"$1[已隐藏]")
    .replace(/(["']?(?:password|current_password|new_password|secret|api[_-]?key|token|access_token|refresh_token)["']?\s*[:=]\s*)["']?[^\s,;&"'}]+["']?/gi,"$1[已隐藏]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi,"postgresql://[已隐藏]")
    .slice(0,max);
}
export function safePath(value:string){return value.split(/[?#]/)[0].slice(0,240)}
export function cleanOpsEvent(event:OpsEvent):OpsEvent {
  const details=Object.fromEntries(Object.entries(event.details||{}).filter(([key])=>detailKeys.has(key)).map(([key,value])=>[key,typeof value==="number"?value:safeLogText(value,key==="stack"?2000:800)]));
  return {...event,tenantId:Number(event.tenantId)>0?Number(event.tenantId):null,message:safeLogText(event.message),module:safeLogText(event.module,60),event:safeLogText(event.event,80),requestId:event.requestId?.slice(0,100),taskType:event.taskType?.slice(0,80),taskId:event.taskId?.slice(0,100),details,at:event.at||new Date().toISOString()};
}

export function createLogBuffer(write:(events:OpsEvent[])=>Promise<void>,capacity=1000){
  const pending:OpsEvent[]=[];let flushing=false,dropped=0,failed=0,lastSuccess:string|null=null;
  return {
    add(event:OpsEvent){if(pending.length>=capacity){pending.shift();dropped++}pending.push(cleanOpsEvent(event))},
    stats:()=>({pending:pending.length,dropped,failed,last_success_at:lastSuccess}),
    async flush(){if(flushing||!pending.length)return;flushing=true;const batch=pending.splice(0,100);try{await write(batch);lastSuccess=new Date().toISOString()}catch{failed+=batch.length;console.error('{"event":"operations_log_write_failed"}')}finally{flushing=false}},
  };
}
let logPool:pg.Pool|undefined;
const buffer=createLogBuffer(async events=>{
  if(!logPool){logPool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:1000,idleTimeoutMillis:10000,statement_timeout:1500});logPool.on("error",()=>console.error('{"event":"operations_log_pool_error"}'))}
  await logPool.query(`INSERT INTO operations_logs(tenant_id,service,level,module,event,message,request_id,task_type,task_id,duration_ms,status_code,details_json,created_at)
    SELECT x.tenant_id,x.service,x.level,x.module,x.event,x.message,x.request_id,x.task_type,x.task_id,x.duration_ms,x.status_code,x.details_json,x.created_at FROM jsonb_to_recordset($1::jsonb) AS x(tenant_id bigint,service text,level text,module text,event text,message text,request_id text,task_type text,task_id text,duration_ms int,status_code int,details_json jsonb,created_at timestamptz)`,[JSON.stringify(events.map(e=>({tenant_id:e.tenantId,service:e.service,level:e.level,module:e.module,event:e.event,message:e.message,request_id:e.requestId,task_type:e.taskType,task_id:e.taskId,duration_ms:e.durationMs,status_code:e.statusCode,details_json:e.details||{},created_at:e.at})))]);
});
const flushTimer=setInterval(()=>void buffer.flush(),2000);flushTimer.unref();
export const recordOps=(event:OpsEvent)=>{const clean=cleanOpsEvent(event);buffer.add(clean);if(clean.level!=="info")console.error(JSON.stringify(clean))};
export const logBufferStats=()=>buffer.stats();
export async function closeOpsLog(){clearInterval(flushTimer);await buffer.flush();await logPool?.end()}

export function requestTelemetry(record:(event:OpsEvent)=>void=recordOps):RequestHandler {
  return (req,res,next)=>{
    const started=performance.now(),requestId=crypto.randomUUID();res.locals.requestId=requestId;res.setHeader("X-Request-ID",requestId);
    res.once("finish",()=>{
      // Monitoring traffic must not generate its own stream of requests and errors.
      if(req.path==="/api/health"||req.path.startsWith("/api/admin/ops")||req.path==="/api/telemetry/client")return;
      const durationMs=Math.round(performance.now()-started),status=res.statusCode,path=safePath(req.path);
      const level=status>=500?"error":status>=400||durationMs>=3000?"warn":"info";
      const task=/\/brand-library\/jobs\/(\d+)/.exec(path)||/\/jobs\/(\d+)/.exec(path);
      record({tenantId:req.user?.tenantId,service:"api",level,module:"http",event:status>=500?"request_failed":durationMs>=3000?"request_slow":"request_completed",message:`${req.method} ${path} → ${status}`,requestId,taskType:task?(path.includes("brand-library")?"brand_discovery":"analysis"):undefined,taskId:task?.[1],durationMs,statusCode:status,details:{method:req.method,path}});
    });next();
  };
}
