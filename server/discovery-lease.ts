import {randomUUID} from "node:crypto";
import {getMonitorRedis} from "./discovery-monitor.js";

// A paused worker may still be finishing an in-flight request when resumed.
// A renewable lease prevents both queue items from processing the same pages.
export async function discoveryLease(tenantId:number,jobId:number){
 const redis=await getMonitorRedis(),key=`storemap:discovery-lease:${tenantId}:${jobId}`,token=randomUUID();
 if(await redis.set(key,token,"EX",90,"NX")!=="OK")return null;
 let lost=false;
 const timer=setInterval(()=>{void redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('expire',KEYS[1],90) else return 0 end",1,key,token).then(value=>{if(!value)lost=true}).catch(()=>{lost=true})},15000);timer.unref();
 return {assert(){if(lost)throw new Error("查询执行锁已失效，请从断点继续")},async release(){clearInterval(timer);await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",1,key,token).catch(()=>{})}};
}
