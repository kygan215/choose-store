/* eslint-disable @typescript-eslint/no-explicit-any */
import { Worker, type Job } from "bullmq";
import { query } from "./db.js";
import { aggregateStore, createEnhancedAnalysis as createAnalysis, generateAi, searchCandidates, searchPois, type Poi, type Row } from "./services.js";
import { redisConnection } from "./queue.js";

async function ownerJob(jobId:number,tenantId:number,userId:number){return (await query<Row>("SELECT * FROM jobs WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[jobId,tenantId,userId])).rows[0]}
async function refreshJob(jobId:number,tenantId:number,userId:number,stage:"match"|"analysis"){
  const rows=(await query<{status:string}>("SELECT status FROM stores WHERE job_id=$1 AND tenant_id=$2 AND created_by=$3",[jobId,tenantId,userId])).rows,total=rows.length;
  if(stage==="match"){
    const processed=rows.filter(row=>row.status!=="等待匹配").length,matched=rows.filter(row=>["已确认","分析完成","分析失败"].includes(row.status)).length,failed=rows.filter(row=>row.status==="匹配失败").length;
    await query("UPDATE jobs SET processed_stores=$1,matched_stores=$2,failed_stores=$3,updated_at=NOW() WHERE id=$4 AND tenant_id=$5 AND created_by=$6",[processed,matched,failed,jobId,tenantId,userId]);return {processed,matched,failed,total};
  }
  const processed=rows.filter(row=>["分析完成","分析失败"].includes(row.status)).length,success=rows.filter(row=>row.status==="分析完成").length,failed=rows.filter(row=>["匹配失败","分析失败"].includes(row.status)).length;
  await query("UPDATE jobs SET processed_stores=$1,success_stores=$2,failed_stores=$3,updated_at=NOW() WHERE id=$4 AND tenant_id=$5 AND created_by=$6",[processed,success,failed,jobId,tenantId,userId]);return {processed,success,failed,total};
}

async function matchBatch(jobId:number,tenantId:number,userId:number){
  if(!await ownerJob(jobId,tenantId,userId))throw new Error("任务不存在或无权访问");
  await query("UPDATE jobs SET status='正在匹配门店',stage='match',control='run',processed_stores=0,current_store='',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[jobId,tenantId,userId]);
  const stores=(await query<Row>("SELECT * FROM stores WHERE job_id=$1 AND tenant_id=$2 AND created_by=$3 AND status IN ('等待匹配','匹配失败') ORDER BY id",[jobId,tenantId,userId])).rows;
  for(const store of stores){const control=(await query<{control:string}>("SELECT control FROM jobs WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[jobId,tenantId,userId])).rows[0]?.control;if(control!=="run")break;await query("UPDATE jobs SET current_store=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[store.input_name,jobId,tenantId,userId]);try{const top=(await searchCandidates(String(store.input_name),String(store.city||""),String(store.district||""),String(store.address||"")))[0] as any;if(!top)throw new Error("高德未返回有效候选");await query("UPDATE stores SET standard_name=$1,amap_poi_id=$2,longitude=$3,latitude=$4,province=$5,city=$6,district=$7,address=$8,match_score=$9,match_status=$10,status='已确认',error_message=NULL,updated_at=NOW() WHERE id=$11 AND tenant_id=$12 AND created_by=$13",[top.name,top.id,top.location[0],top.location[1],top.province||store.province,top.city||store.city,top.district||store.district,top.address||store.address,top.score,top.status,store.id,tenantId,userId])}catch(error){await query("UPDATE stores SET status='匹配失败',error_message=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[error instanceof Error?error.message:"匹配失败",store.id,tenantId,userId])}await refreshJob(jobId,tenantId,userId,"match")}
  const counts=await refreshJob(jobId,tenantId,userId,"match"),state=await ownerJob(jobId,tenantId,userId);if(state?.control==="run")await query("UPDATE jobs SET status=$1,control='idle',current_store='',updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[counts.failed?"匹配部分失败":"匹配完成",jobId,tenantId,userId]);return counts;
}

async function analyzeBatch(jobId:number,tenantId:number,userId:number){
  const job=await ownerJob(jobId,tenantId,userId);if(!job)throw new Error("任务不存在或无权访问");const config=job.config_json||{},categories=config.categories?.length?config.categories:["住宅小区","幼儿园","小学"],radii=config.radii?.length?config.radii:[500];
  await query("UPDATE jobs SET status='正在完整分析',stage='analysis',control='run',processed_stores=0,success_stores=0,current_store='',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[jobId,tenantId,userId]);
  const stores=(await query<Row>("SELECT * FROM stores WHERE job_id=$1 AND tenant_id=$2 AND created_by=$3 AND longitude IS NOT NULL AND status IN ('已确认','分析失败','分析完成') ORDER BY id",[jobId,tenantId,userId])).rows;
  for(const store of stores){const state=await ownerJob(jobId,tenantId,userId);if(state?.control!=="run")break;await query("UPDATE jobs SET current_store=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[store.input_name,jobId,tenantId,userId]);try{const pois=await searchPois(store,categories,radii),analysis=createAnalysis(store,pois,radii,categories);await query("UPDATE stores SET pois_json=$1,analysis_json=$2,status='分析完成',error_message=NULL,updated_at=NOW() WHERE id=$3 AND tenant_id=$4 AND created_by=$5",[JSON.stringify(pois),JSON.stringify(analysis),store.id,tenantId,userId])}catch(error){await query("UPDATE stores SET status='分析失败',error_message=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[error instanceof Error?error.message:"分析失败",store.id,tenantId,userId])}await refreshJob(jobId,tenantId,userId,"analysis")}
  const counts=await refreshJob(jobId,tenantId,userId,"analysis"),state=await ownerJob(jobId,tenantId,userId);if(state?.control==="run")await query("UPDATE jobs SET status=$1,control='idle',current_store='',updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND created_by=$4",[counts.failed?"部分完成":"已完成",jobId,tenantId,userId]);return counts;
}

async function processJob(job:Job){
  let tenantId=Number(job.data.tenantId||0),userId=Number(job.data.userId||0);
  if(!userId&&job.data.jobId){const legacy=(await query<Row>("SELECT tenant_id,created_by FROM jobs WHERE id=$1",[job.data.jobId])).rows[0];tenantId=Number(legacy?.tenant_id||tenantId);userId=Number(legacy?.created_by||0)}
  if(!userId&&job.data.storeId){const legacy=(await query<Row>("SELECT tenant_id,created_by FROM stores WHERE id=$1",[job.data.storeId])).rows[0];tenantId=Number(legacy?.tenant_id||tenantId);userId=Number(legacy?.created_by||0)}
  if(!tenantId||!userId)throw new Error("任务缺少账号归属信息");
  if(job.name==="match-batch")return matchBatch(Number(job.data.jobId),Number(tenantId),Number(userId));
  if(job.name==="analyze-batch")return analyzeBatch(Number(job.data.jobId),Number(tenantId),Number(userId));
  if(job.name==="analyze-single"){const {storeId,categories,radii}=job.data,store=(await query<Row>("SELECT * FROM stores WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[storeId,tenantId,userId])).rows[0];if(!store)throw new Error("门店不存在");const pois=await searchPois(store,categories,radii),analysis=createAnalysis(store,pois,radii,categories);await query("UPDATE stores SET pois_json=$1,analysis_json=$2,status='分析完成',updated_at=NOW() WHERE id=$3 AND tenant_id=$4 AND created_by=$5",[JSON.stringify(pois),JSON.stringify(analysis),storeId,tenantId,userId]);return {pois,analysis}}
  if(job.name==="ai-single"){const {storeId,radii}=job.data,store=(await query<Row>("SELECT * FROM stores WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[storeId,tenantId,userId])).rows[0];if(!store)throw new Error("门店不存在");return generateAi(Number(tenantId),Number(userId),"single",[aggregateStore("门店A",(store.pois_json||[]) as Poi[],radii)],store.job_id?Number(store.job_id):null,Number(storeId),[Number(storeId)])}
  if(job.name==="ai-comparison"){const {jobId,storeIds,radii}=job.data;if(!await ownerJob(Number(jobId),Number(tenantId),Number(userId)))throw new Error("任务不存在");const rows=(await query<Row>("SELECT * FROM stores WHERE tenant_id=$1 AND created_by=$2 AND job_id=$3 AND id=ANY($4::bigint[])",[tenantId,userId,jobId,storeIds])).rows,ordered=(storeIds as number[]).map(id=>rows.find(row=>Number(row.id)===Number(id)));if(ordered.some(row=>!row))throw new Error("部分门店不存在");return generateAi(Number(tenantId),Number(userId),"comparison",ordered.map((row,index)=>aggregateStore(`门店${String.fromCharCode(65+index)}`,(row?.pois_json||[]) as Poi[],radii)),Number(jobId),null,storeIds)}
  throw new Error(`未知任务类型：${job.name}`);
}

const worker=new Worker("store-analysis",processJob,{connection:redisConnection,concurrency:Math.max(1,Math.min(5,Number(process.env.WORKER_CONCURRENCY||3)))});worker.on("completed",job=>console.log(JSON.stringify({event:"job_completed",id:job.id,name:job.name})));worker.on("failed",(job,error)=>{console.error(JSON.stringify({event:"job_failed",id:job?.id,name:job?.name,error:error.message}));if(job?.data?.jobId&&job.data?.tenantId&&job.data?.userId)void query("UPDATE jobs SET status='任务执行失败',control='idle',current_store='',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[job.data.jobId,job.data.tenantId,job.data.userId])});console.log("Queue worker started");
async function stop(){await worker.close();process.exit(0)}process.on("SIGTERM",stop);process.on("SIGINT",stop);
