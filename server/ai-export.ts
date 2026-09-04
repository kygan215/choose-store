import fs from "node:fs/promises";
import path from "node:path";
import { query } from "./db.js";
import { buildBatchExportWorkbook, EXPORT_BASE_FIELDS, type ExportSelection } from "./batch-export.js";
import { activityCacheKey, normalizeActivityConfig, resolveActivityConfig, validateActivityConfig, type ActivityConfig } from "./activity-ai.js";
import { aggregateStore, generateAi, type Poi, type Row } from "./services.js";

export const AI_EXPORT_FIELDS:Set<string>=new Set(EXPORT_BASE_FIELDS.filter(field=>field.group==="AI 分析").map(field=>field.id));
const EXPORT_ROOT=process.env.AI_EXPORT_DIR||path.resolve("outputs/ai-exports");

export type AiExportRequest={
  job_ids:number[];store_ids:number[];fields:string[];radii:number[];categories:string[];
  include_poi_details:boolean;include_failures:boolean;include_notes:boolean;
  activity_config?:ActivityConfig;activity_overrides?:Record<string,ActivityConfig>;
  user_email:string;job_names:string[];
};

const uniqueNumbers=(value:unknown)=>[...new Set((Array.isArray(value)?value:[]).map(Number).filter(item=>Number.isInteger(item)&&item>0))];
const uniqueStrings=(value:unknown)=>[...new Set((Array.isArray(value)?value:[]).map(item=>String(item).trim()).filter(Boolean))];

export function normalizeAiExportRequest(value:unknown):AiExportRequest{
  const row=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
  const overrides:Record<string,ActivityConfig>={};
  if(row.activity_overrides&&typeof row.activity_overrides==="object")for(const [key,item] of Object.entries(row.activity_overrides as Record<string,unknown>))overrides[String(Number(key))]=normalizeActivityConfig(item);
  return {job_ids:uniqueNumbers(row.job_ids),store_ids:uniqueNumbers(row.store_ids),fields:uniqueStrings(row.fields),radii:uniqueNumbers(row.radii),categories:uniqueStrings(row.categories),include_poi_details:Boolean(row.include_poi_details),include_failures:row.include_failures!==false,include_notes:row.include_notes!==false,activity_config:resolveActivityConfig(row.activity_config),activity_overrides:overrides,user_email:String(row.user_email||""),job_names:uniqueStrings(row.job_names)};
}

function activityFor(request:AiExportRequest,storeId:number){return normalizeActivityConfig(request.activity_overrides?.[String(storeId)]||request.activity_config)}
function hasAi(request:AiExportRequest){return request.fields.some(field=>AI_EXPORT_FIELDS.has(field))}

export async function loadExportRows(tenantId:number,userId:number,request:AiExportRequest){
  const params:unknown[]=[tenantId,userId,request.job_ids],clause=request.store_ids.length?" AND s.id=ANY($4::bigint[])":"",values=request.store_ids.length?[...params,request.store_ids]:params;
  return (await query<Row>(`SELECT s.*,j.config_json AS job_config,j.filename AS job_filename FROM stores s JOIN jobs j ON j.id=s.job_id WHERE s.tenant_id=$1 AND s.created_by=$2 AND j.created_by=$2 AND s.job_id=ANY($3::bigint[])${clause} ORDER BY s.job_id,s.id`,values)).rows;
}

export async function previewAiExport(tenantId:number,userId:number,request:AiExportRequest){
  const rows=await loadExportRows(tenantId,userId,request);if(!rows.length)throw new Error("所选任务没有可导出的门店");
  if(request.store_ids.length&&rows.length!==request.store_ids.length)throw new Error("部分门店不存在或无权访问");
  if(!hasAi(request))return {selected:rows.length,reusable:0,new_generation:0,skipped:0,estimated_calls:0,ai_required:false};
  const common=validateActivityConfig(request.activity_config);if(common.errors.length)throw new Error(common.errors.join("；"));
  const selectedIds=new Set(rows.map(row=>Number(row.id)));for(const [storeId,override] of Object.entries(request.activity_overrides||{})){if(!selectedIds.has(Number(storeId)))throw new Error(`活动差异配置包含未选门店 #${storeId}`);const checked=validateActivityConfig(override);if(checked.errors.length)throw new Error(`门店 #${storeId} 活动配置：${checked.errors.join("、")}`)}
  let reusable=0,newGeneration=0,skipped=0;
  for(const row of rows){if(row.status!=="分析完成"||!Array.isArray(row.pois_json)||!row.analysis_json){skipped++;continue}const config=activityFor(request,Number(row.id)),store=aggregateStore("门店A",row.pois_json as Poi[],request.radii),cacheKey=activityCacheKey(store,config),found=await query("SELECT id FROM ai_analyses WHERE tenant_id=$1 AND created_by=$2 AND store_id=$3 AND scope='single' AND cache_key=$4 ORDER BY id DESC LIMIT 1",[tenantId,userId,row.id,cacheKey]);if(found.rowCount)reusable++;else newGeneration++}
  if(newGeneration>200)throw new Error(`本次需要新生成 ${newGeneration} 家 AI 分析，超过单次上限 200 家；可拆分门店后重试`);
  return {selected:rows.length,reusable,new_generation:newGeneration,skipped,estimated_calls:newGeneration,ai_required:true};
}

export async function createAiExport(tenantId:number,userId:number,request:AiExportRequest){
  const preview=await previewAiExport(tenantId,userId,request),created=(await query<Row>("INSERT INTO ai_export_jobs(tenant_id,created_by,status,total_stores,reusable_stores,skipped_stores,request_json) VALUES($1,$2,'pending',$3,$4,$5,$6) RETURNING *",[tenantId,userId,preview.selected,preview.reusable,preview.skipped,JSON.stringify(request)])).rows[0],rows=await loadExportRows(tenantId,userId,request);
  for(const row of rows){let status="pending",cacheKey:string|null=null,analysisId:number|null=null,error:string|null=null;if(row.status!=="分析完成"||!Array.isArray(row.pois_json)||!row.analysis_json){status="skipped";error="未生成：门店匹配或POI分析尚未完成"}else if(hasAi(request)){const config=activityFor(request,Number(row.id)),store=aggregateStore("门店A",row.pois_json as Poi[],request.radii);cacheKey=activityCacheKey(store,config);const found=(await query<Row>("SELECT id FROM ai_analyses WHERE tenant_id=$1 AND created_by=$2 AND store_id=$3 AND scope='single' AND cache_key=$4 ORDER BY id DESC LIMIT 1",[tenantId,userId,row.id,cacheKey])).rows[0];if(found){status="reused";analysisId=Number(found.id)}}else status="ready";
    await query("INSERT INTO ai_export_job_stores(export_job_id,store_id,status,cache_key,ai_analysis_id,activity_config_json,error_message) VALUES($1,$2,$3,$4,$5,$6,$7)",[created.id,row.id,status,cacheKey,analysisId,JSON.stringify(activityFor(request,Number(row.id))),error]);}
  return {id:Number(created.id),...preview,status:"pending",created_at:created.created_at};
}

async function updateProgress(exportId:number,current=""){
  const counts=(await query<Row>("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status IN ('reused','generated','failed','skipped','ready'))::int processed,COUNT(*) FILTER(WHERE status='generated')::int generated,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(*) FILTER(WHERE status='skipped')::int skipped FROM ai_export_job_stores WHERE export_job_id=$1",[exportId])).rows[0];
  await query("UPDATE ai_export_jobs SET processed_stores=$1,generated_stores=$2,failed_stores=$3,skipped_stores=$4,current_store=$5,updated_at=NOW() WHERE id=$6",[counts.processed,counts.generated,counts.failed,counts.skipped,current,exportId]);
}

export async function processAiExport(exportId:number,tenantId:number,userId:number){
  const record=(await query<Row>("SELECT * FROM ai_export_jobs WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[exportId,tenantId,userId])).rows[0];if(!record)throw new Error("AI导出任务不存在");const request=normalizeAiExportRequest(record.request_json);
  await query("UPDATE ai_export_jobs SET status='running',updated_at=NOW() WHERE id=$1",[exportId]);
  const children=(await query<Row>("SELECT es.*,s.input_name,s.job_id,s.pois_json,s.status AS store_status FROM ai_export_job_stores es JOIN stores s ON s.id=es.store_id WHERE es.export_job_id=$1 ORDER BY es.id",[exportId])).rows;
  for(const child of children){if(child.status!=="pending")continue;const control=(await query<Row>("SELECT control FROM ai_export_jobs WHERE id=$1",[exportId])).rows[0]?.control;if(control==="cancel")break;await updateProgress(exportId,String(child.input_name||""));try{const config=normalizeActivityConfig(child.activity_config_json),radii=request.radii.length?request.radii:[500],store=aggregateStore("门店A",child.pois_json as Poi[],radii),result=await generateAi(tenantId,userId,"single",[store],Number(child.job_id)||null,Number(child.store_id),[Number(child.store_id)],{activityConfig:config,cacheKey:String(child.cache_key||"")});await query("UPDATE ai_export_job_stores SET status='generated',ai_analysis_id=$1,attempts=attempts+1,error_message=NULL,updated_at=NOW() WHERE id=$2",[result.id,child.id])}catch(error){await query("UPDATE ai_export_job_stores SET status='failed',attempts=attempts+1,error_message=$1,updated_at=NOW() WHERE id=$2",[error instanceof Error?error.message:"AI生成失败",child.id])}await updateProgress(exportId)}
  const cancelled=(await query<Row>("SELECT control FROM ai_export_jobs WHERE id=$1",[exportId])).rows[0]?.control==="cancel";if(cancelled){await query("UPDATE ai_export_jobs SET status='cancelled',current_store='',completed_at=NOW(),updated_at=NOW() WHERE id=$1",[exportId]);return {cancelled:true}}
  const rows=await loadExportRows(tenantId,userId,request),aiRows=(await query<Row>("SELECT a.* FROM ai_export_job_stores es JOIN ai_analyses a ON a.id=es.ai_analysis_id WHERE es.export_job_id=$1",[exportId])).rows,errors=(await query<Row>("SELECT store_id,status,error_message FROM ai_export_job_stores WHERE export_job_id=$1 AND status IN ('failed','skipped')",[exportId])).rows;
  for(const item of errors)aiRows.push({store_id:item.store_id,result_json:{summary:item.status==="skipped"?item.error_message:`AI生成失败：${item.error_message||"未知原因"}`}});
  const selection:ExportSelection={jobIds:request.job_ids,storeIds:request.store_ids,fields:request.fields,radii:request.radii,categories:request.categories,includePoiDetails:request.include_poi_details,includeFailures:request.include_failures,includeNotes:request.include_notes},buffer=await buildBatchExportWorkbook(rows,aiRows,selection,{userEmail:request.user_email,jobNames:request.job_names});
  await fs.mkdir(EXPORT_ROOT,{recursive:true});const filePath=path.join(EXPORT_ROOT,`ai-export-${exportId}.xlsx`);await fs.writeFile(filePath,buffer);await updateProgress(exportId);await query("UPDATE ai_export_jobs SET status='completed',file_path=$1,file_expires_at=NOW()+INTERVAL '7 days',current_store='',completed_at=NOW(),updated_at=NOW() WHERE id=$2",[filePath,exportId]);return {filePath};
}

export function serializeAiExport(row:Row){const total=Number(row.total_stores||0),processed=Number(row.processed_stores||0);return {id:Number(row.id),status:row.status,control:row.control,total_stores:total,reusable_stores:Number(row.reusable_stores||0),generated_stores:Number(row.generated_stores||0),failed_stores:Number(row.failed_stores||0),skipped_stores:Number(row.skipped_stores||0),processed_stores:processed,current_store:row.current_store||"",progress_percent:Math.round(processed/Math.max(1,total)*100),error_message:row.error_message||"",download_ready:row.status==="completed"&&row.file_path&&(!row.file_expires_at||new Date(row.file_expires_at)>new Date()),created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString(),completed_at:row.completed_at?new Date(row.completed_at).toISOString():null};}
