import express from "express";
import {requireAdmin} from "./auth.js";
import {pool,query} from "./db.js";
import {getMonitorRedis,discoveryDiagnostics} from "./discovery-monitor.js";
import {taskQueue} from "./queue.js";
import {logBufferStats,safeLogText} from "./ops-log.js";
import os from "node:os";

type Row=Record<string,unknown>;
const router=express.Router();router.use(requireAdmin);
const ok=(res:express.Response,data:unknown)=>res.json({success:true,data});
import {logFilters} from "./ops-log-query.js";

const logSources=`
 SELECT 'runtime:'||id::text id,tenant_id,service,level,module,event,message,request_id,task_type,task_id,duration_ms,status_code,details_json,created_at FROM operations_logs
 UNION ALL SELECT 'discovery:'||id::text,tenant_id,'worker',level,'brand_discovery',stage,message,NULL,'brand_discovery',job_id::text,NULL,NULL,details_json,created_at FROM brand_discovery_events
 UNION ALL SELECT 'amap:'||id::text,tenant_id,'amap','info','amap',operation,'高德调用：'||operation,NULL,source_type,source_id,NULL,NULL,jsonb_build_object('calls',calls,'operation',operation),created_at FROM amap_usage_events
 UNION ALL SELECT 'audit:'||id::text,tenant_id,'audit','info','audit',action,'管理操作：'||action,NULL,target_type,target_id,NULL,NULL,jsonb_build_object('target_type',target_type,'target_id',target_id,'user_id',user_id),created_at FROM audit_logs
`;
router.get("/logs",async(req,res,next)=>{try{
  const {where,values}=logFilters(req.query,req.user!.tenantId),limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));
  values.push(limit+1);const rows=(await query<Row>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM (${logSources}) logs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values)).rows;
  const more=rows.length>limit,items:Row[]=rows.slice(0,limit).map(row=>({...row,message:safeLogText(row.message),details_json:row.details_json,created_at:new Date(String(row.created_at)).toISOString()}));
  const last=items.at(-1);ok(res,{items,next_cursor:more&&last?`${last.cursor_at}|${last.id}`:null,retention:{runtime_days:14,discovery_days:30},checked_at:new Date().toISOString()});
}catch(error){next(error)}});

const timed=<T>(promise:Promise<T>,ms=4000)=>{let timer:ReturnType<typeof setTimeout>;return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("检查超时")),ms);timer.unref()})]).finally(()=>clearTimeout(timer))};
router.get("/overview",async(req,res,next)=>{try{
  const tenantId=req.user!.tenantId,started=performance.now();
  const db=await timed(query("SELECT 1")).then(()=>({state:"ok",latency_ms:Math.round(performance.now()-started)})).catch(()=>({state:"error",latency_ms:null}));
  const redis=await getMonitorRedis();const queueStarted=performance.now();
  const queue=await timed(Promise.all([redis.ping(),redis.get("storemap:worker:heartbeat"),taskQueue.getJobCounts("active","waiting","delayed","failed","completed"),taskQueue.isPaused()])).then(([,heartbeat,counts,paused])=>({state:"ok",latency_ms:Math.round(performance.now()-queueStarted),heartbeat:heartbeat?JSON.parse(heartbeat):null,counts,paused})).catch(()=>({state:"error",latency_ms:null,heartbeat:null,counts:null,paused:null}));
  const [metrics,timeline,jobs]=await Promise.all([
    query<Row>(`SELECT COUNT(*)::int requests,COUNT(*) FILTER(WHERE status_code>=500)::int errors,COUNT(*) FILTER(WHERE duration_ms>=3000)::int slow,COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms))::numeric),0)::int p95_ms FROM operations_logs WHERE tenant_id=$1 AND module='http' AND created_at>NOW()-INTERVAL '15 minutes'`,[tenantId]),
    query<Row>(`SELECT date_trunc('minute',created_at) at,COUNT(*)::int requests,COUNT(*) FILTER(WHERE status_code>=500)::int errors FROM operations_logs WHERE tenant_id=$1 AND module='http' AND created_at>NOW()-INTERVAL '15 minutes' GROUP BY 1 ORDER BY 1`,[tenantId]),
    query<Row>(`SELECT id,status,current_region,processed_units,total_units,updated_at FROM brand_discovery_jobs WHERE tenant_id=$1 AND status IN ('正在查询','正在读取区域','等待执行','等待继续') ORDER BY updated_at DESC LIMIT 20`,[tenantId]),
  ]);
  const activeJobs:Array<Row&{id:number;updated_at:string;idle_seconds:number}>=await Promise.all(jobs.rows.map(async job=>{let latest=Date.parse(String(job.updated_at));try{const snapshot=await timed(redis.get(`storemap:discovery:${tenantId}:${job.id}`),2000);if(snapshot){for(const unit of JSON.parse(snapshot).units||[])latest=Math.max(latest,Date.parse(unit.updated_at)||0)}}catch{/* queue state already reports availability */}return {...job,id:Number(job.id),updated_at:new Date(String(job.updated_at)).toISOString(),idle_seconds:Math.max(0,Math.floor((Date.now()-latest)/1000))}}));
  const heartbeatAt=queue.heartbeat?.at,workerOnline=Boolean(heartbeatAt&&Date.now()-Date.parse(heartbeatAt)<45000),m=metrics.rows[0];
  const alerts:Array<{level:string;title:string;message:string;task_id?:number}>=[];
  if(db.state!=="ok")alerts.push({level:"error",title:"数据库连接异常",message:"检查 PostgreSQL 服务和连接池。"});
  if(queue.state!=="ok")alerts.push({level:"error",title:"队列连接异常",message:"检查 Redis 服务。后台任务可能无法调度。"});
  if(!workerOnline)alerts.push({level:"error",title:"后台 Worker 心跳过期",message:"最近 45 秒没有心跳，请检查 Worker 容器。"});
  if(Number(m.errors)>0)alerts.push({level:"warn",title:"最近 15 分钟存在请求错误",message:`${m.errors} 次服务器错误，可切换到错误日志定位请求编号。`});
  if(pool.waitingCount>0)alerts.push({level:"warn",title:"数据库连接正在排队",message:`${pool.waitingCount} 个请求等待连接，可能导致查询缓慢。`});
  const logging=logBufferStats();if(logging.failed||logging.dropped)alerts.push({level:"warn",title:"部分运行日志未能写入",message:`本次 API 启动以来，写入失败 ${logging.failed} 条，缓冲溢出 ${logging.dropped} 条。请检查数据库状态；这些记录不能从集中日志完整还原。`});
  for(const job of activeJobs)if(["正在查询","正在读取区域"].includes(String(job.status))&&job.idle_seconds>=120)alerts.push({level:"warn",title:`品牌查询 #${job.id} 较长时间无进展`,message:`${job.current_region||"当前区域"} · ${job.idle_seconds} 秒没有阶段更新，请打开任务诊断。`,task_id:job.id});
  ok(res,{checked_at:new Date().toISOString(),services:{api:{state:"ok",uptime_seconds:Math.round(process.uptime()),memory_mb:Math.round(process.memoryUsage().rss/1048576)},database:db,redis:{state:queue.state,latency_ms:queue.latency_ms},worker:{state:workerOnline?"ok":"error",last_heartbeat_at:heartbeatAt||null,...queue.heartbeat?.metrics?{metrics:queue.heartbeat.metrics}:{}}},queue:{scope:"全站共享队列",counts:queue.counts},database_pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:pool.options.max},metrics:m,timeline:timeline.rows,active_jobs:activeJobs,alerts,logging:logBufferStats(),host:{cpu_cores:os.availableParallelism()},retention:{runtime_days:14,discovery_days:30}});
}catch(error){next(error)}});
router.get("/discovery/:id",async(req,res,next)=>{try{const job=(await query<Row>("SELECT * FROM brand_discovery_jobs WHERE tenant_id=$1 AND id=$2",[req.user!.tenantId,Number(req.params.id)||0])).rows[0];if(!job)return res.status(404).json({success:false,message:"任务不存在"});ok(res,await discoveryDiagnostics(job,req.user!.tenantId))}catch(error){next(error)}});
export default router;
