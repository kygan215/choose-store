import {query} from "./db.js";
import {Redis} from "ioredis";

type Row=Record<string,unknown>;
export type DiscoveryMonitor={event:(level:"info"|"warn"|"error",stage:string,message:string,details?:Row)=>Promise<void>;unit:(key:string,value:Row|null)=>Promise<void>;finish:()=>Promise<void>};
export const quietDiscoveryMonitor:DiscoveryMonitor={event:async()=>{},unit:async()=>{},finish:async()=>{}};
const detailFields=new Set(["province","city","brand","path","page","saved","total","duration_ms","returned","error"]);
export function safeDiscoveryMessage(value:unknown){return String(value??"").replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi,"$1[已隐藏]").replace(/(authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,"$1[已隐藏]").replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,"$1[已隐藏]").slice(0,600)}
const safeDetails=(value:Row)=>Object.fromEntries(Object.entries(value).filter(([key])=>detailFields.has(key)).map(([key,item])=>[key,typeof item==="string"?safeDiscoveryMessage(item):item]));
let monitorRedis:Redis|null=null;
export async function getMonitorRedis(){const {redisUrl}=await import("./queue.js");return monitorRedis??=new Redis(redisUrl,{maxRetriesPerRequest:1,connectTimeout:5000})}

export function createDiscoveryMonitor(jobId:number,tenantId:number):DiscoveryMonitor{
  const units=new Map<string,Row>();let closed=false;
  const redis=getMonitorRedis();
  const heartbeat=async()=>{try{await (await redis).set(`storemap:discovery:${tenantId}:${jobId}`,JSON.stringify({at:new Date().toISOString(),active:!closed,units:[...units.values()]}),"EX",closed?86400:45)}catch{console.error(JSON.stringify({event:"discovery_heartbeat_unavailable",job_id:jobId}))}};
  const timer=setInterval(()=>void heartbeat(),10_000);timer.unref();void heartbeat();
  return {
    async event(level,stage,message,details={}){
      try{await query("INSERT INTO brand_discovery_events(tenant_id,job_id,level,stage,message,details_json) VALUES($1,$2,$3,$4,$5,$6)",[tenantId,jobId,level,stage,safeDiscoveryMessage(message),JSON.stringify(safeDetails(details))])}
      catch{console.error(JSON.stringify({event:"discovery_log_unavailable",job_id:jobId,stage}))}
    },
    async unit(key,value){if(value)units.set(key,{...safeDetails(value),stage:value.stage,updated_at:new Date().toISOString()});else units.delete(key);await heartbeat()},
    async finish(){closed=true;clearInterval(timer);await heartbeat()},
  };
}

export type DiscoveryHealthInput={status:string;queueState:string;heartbeatAt:string|null;lastActivityAt:string|null;now:number};
export function discoveryHealth(input:DiscoveryHealthInput){
  const elapsed=input.lastActivityAt?Math.max(0,Math.floor((input.now-Date.parse(input.lastActivityAt))/1000)):null;
  const heartbeatFresh=Boolean(input.heartbeatAt&&input.now-Date.parse(input.heartbeatAt)<45_000);
  if(["已暂停","额度暂停"].includes(input.status))return {state:"paused",message:"任务已暂停，进度不会继续增加",idle_seconds:elapsed};
  if(["已完成","部分完成","任务执行失败"].includes(input.status))return {state:input.status==="任务执行失败"?"error":"finished",message:input.status,idle_seconds:elapsed};
  if(input.queueState==="waiting"||input.queueState==="delayed")return {state:"waiting",message:"任务正在队列中等待执行",idle_seconds:elapsed};
  if(input.queueState==="missing")return {state:"warning",message:"数据库显示运行中，但队列没有对应执行项；请检查后台 Worker",idle_seconds:elapsed};
  if(input.queueState==="unavailable"||input.queueState==="unknown")return {state:"warning",message:"暂时无法确认队列状态，请查看最近活动时间或稍后刷新",idle_seconds:elapsed};
  if(elapsed!==null&&elapsed>=120)return {state:"warning",message:heartbeatFresh?"Worker 仍在线，但较长时间没有新进展，请查看当前阶段和最近日志":"较长时间没有新活动记录，请检查后台和接口状态",idle_seconds:elapsed};
  return {state:"running",message:heartbeatFresh?"后台在线，任务正在执行":"队列正在执行；当前 Worker 尚未上报详细心跳",idle_seconds:elapsed};
}

export async function discoveryDiagnostics(job:Row,tenantId:number){
  const jobId=Number(job.id),{taskQueue}=await import("./queue.js"),redis=await getMonitorRedis();
  let heartbeat:{at?:string;active?:boolean;units?:Row[]}|null=null,workerAt:string|null=null,queueState="unknown";
  let queueTimeout:ReturnType<typeof setTimeout>|undefined;
  try{
    const [snapshot,workerSnapshot,active,waiting,delayed]=await Promise.race([Promise.all([redis.get(`storemap:discovery:${tenantId}:${jobId}`),redis.get("storemap:worker:heartbeat"),taskQueue.getActive(0,99),taskQueue.getWaiting(0,99),taskQueue.getDelayed(0,99)]),new Promise<never>((_resolve,reject)=>{queueTimeout=setTimeout(()=>reject(new Error("queue timeout")),5000);queueTimeout.unref()})]);
    heartbeat=snapshot?JSON.parse(snapshot):null;workerAt=workerSnapshot?JSON.parse(workerSnapshot).at:null;
    const matches=(item:{name:string;data:Row})=>item.name==="discover-brand-stores"&&Number(item.data.jobId)===jobId&&Number(item.data.tenantId)===tenantId;
    queueState=active.some(matches)?"active":waiting.some(matches)?"waiting":delayed.some(matches)?"delayed":waiting.length<100&&delayed.length<100?"missing":"unknown";
  }catch{queueState="unavailable"}finally{clearTimeout(queueTimeout)}
  const [requests,requestCount,events,writes]=await Promise.all([
    query<Row>("SELECT id,created_at,operation,details_json FROM amap_usage_events WHERE tenant_id=$1 AND source_type='brand_discovery' AND source_id=$2 ORDER BY id DESC LIMIT 50",[tenantId,String(jobId)]),
    query<Row>("SELECT COALESCE(SUM(calls),0)::int count,MAX(created_at) last_at FROM amap_usage_events WHERE tenant_id=$1 AND source_type='brand_discovery' AND source_id=$2",[tenantId,String(jobId)]),
    query<Row>("SELECT id,created_at,level,stage,message,details_json FROM brand_discovery_events WHERE tenant_id=$1 AND job_id=$2 ORDER BY id DESC LIMIT 100",[tenantId,jobId]),
    query<Row>("SELECT COUNT(*)::int count,MAX(updated_at) last_at FROM brand_stores WHERE tenant_id=$1 AND last_job_id=$2",[tenantId,jobId]),
  ]);
  const iso=(value:unknown)=>value?new Date(String(value)).toISOString():null;
  const logs=[...events.rows.map(row=>({id:`event:${row.id}`,level:row.level,stage:row.stage,message:safeDiscoveryMessage(row.message),details:safeDetails((row.details_json||{}) as Row),created_at:iso(row.created_at)})),...requests.rows.map(row=>({id:`request:${row.id}`,level:"info",stage:"request_started",message:row.operation==="province_city_lookup"?"请求省份城市列表":"高德门店请求已发起",details:safeDetails((row.details_json||{}) as Row),created_at:iso(row.created_at)}))].sort((a,b)=>Date.parse(String(b.created_at))-Date.parse(String(a.created_at))).slice(0,100);
  const lastActivity=[iso(job.updated_at),iso(requestCount.rows[0]?.last_at),iso(writes.rows[0]?.last_at),logs[0]?.created_at].filter((value):value is string=>Boolean(value)).sort().at(-1)||null;
  return {job_id:jobId,checked_at:new Date().toISOString(),queue_state:queueState,worker_heartbeat_at:workerAt,heartbeat_at:heartbeat?.active?heartbeat.at||null:null,active_units:heartbeat?.active&&Array.isArray(heartbeat.units)?heartbeat.units.slice(0,12):[],last_activity_at:lastActivity,last_request_at:iso(requestCount.rows[0]?.last_at),last_saved_at:iso(writes.rows[0]?.last_at),request_count:Number(requestCount.rows[0]?.count||0),saved_store_count:Number(writes.rows[0]?.count||0),health:discoveryHealth({status:String(job.status),queueState,heartbeatAt:heartbeat?.active?heartbeat.at||null:null,lastActivityAt:lastActivity,now:Date.now()}),logs};
}
