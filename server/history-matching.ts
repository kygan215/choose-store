import {query} from "./db.js";
import {resolveStoreCandidates,amapRequest} from "./services.js";
import {consumeBackgroundQuota} from "./amap-usage.js";
import {recordOps} from "./ops-log.js";
type Row=Record<string,unknown>;
type RunQuery=(sql:string,values?:unknown[])=>Promise<{rows:Row[]}>;
export const historyNameKey=(v:unknown)=>String(v??"").trim().normalize("NFKC").toLowerCase().replace(/[\s()（）·•—_-]/g,"");
export const exactHistoryPreviewSql=`WITH library AS MATERIALIZED (
 SELECT id,tenant_id,brand_name,amap_name,province,city,address,amap_poi_id,
 regexp_replace(lower(normalize(amap_name,NFKC)),'[[:space:]()（）·•—_-]+','','g') name_key
 FROM brand_stores WHERE tenant_id=$1 AND deleted_at IS NULL AND library_visible
 AND brand_name IN (SELECT brand_name FROM history_stores WHERE tenant_id=$1 AND brand_store_id IS NULL AND NOT archive_only)
) SELECT h.id,h.brand_name,h.store_name,h.province,h.city,h.address,
 COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'brand_name',b.brand_name,'amap_name',b.amap_name,'province',b.province,'city',b.city,'address',b.address,'amap_poi_id',b.amap_poi_id) ORDER BY b.id) FILTER(WHERE b.id IS NOT NULL),'[]'::jsonb) candidates
 FROM history_stores h LEFT JOIN library b ON b.tenant_id=h.tenant_id AND b.brand_name=h.brand_name
 AND h.province<>'' AND h.city<>'' AND b.province=h.province AND b.city=h.city
 AND b.name_key=regexp_replace(lower(normalize(h.store_name,NFKC)),'[[:space:]()（）·•—_-]+','','g')
 WHERE h.tenant_id=$1 AND h.brand_store_id IS NULL AND NOT h.archive_only
 AND EXISTS(SELECT 1 FROM history_activities a WHERE a.tenant_id=h.tenant_id AND a.history_store_id=h.id AND a.revoked_at IS NULL)
 GROUP BY h.id ORDER BY h.province,h.city,h.id LIMIT 5000`;
export function historyPreviewRow(row:Row){
 const candidates=(Array.isArray(row.candidates)?row.candidates:[]) as Row[];
 const unique=candidates.length===1&&/^B[A-Z0-9]{9}$/i.test(String(candidates[0].amap_poi_id));
 return {...row,id:Number(row.id),candidates:candidates.map(c=>({...c,id:Number(c.id)})),state:unique?"unique":candidates.length?"review":"none",reason:unique?"同品牌、同省市、标准化名称一致，且只有一个带 POI ID 的正常门店候选":candidates.length?"候选不唯一或缺少真实 POI ID，需人工核对":"没有完全同名候选，可批量查询高德候选"};
}
export async function exactHistoryPreview(tenantId:number,runQuery:RunQuery=query){const rows=(await runQuery(exactHistoryPreviewSql,[tenantId])).rows.map(historyPreviewRow);return {rows,unique:rows.filter(r=>r.state==="unique").length,review:rows.filter(r=>r.state==="review").length,none:rows.filter(r=>r.state==="none").length}}
export async function validateExactHistoryLinks(tenantId:number,links:Array<{history_store_id:number;brand_store_id:number}>,runQuery:RunQuery){
 const preview=await exactHistoryPreview(tenantId,runQuery),valid=new Map(preview.rows.filter(r=>r.state==="unique").map(r=>[r.id,r.candidates[0].id]));
 if(links.some(l=>valid.get(l.history_store_id)!==l.brand_store_id))throw new Error("匹配候选已变化或不再唯一，请重新预览后确认");
}
export async function cacheHistoryCandidates(tenantId:number,source:Row,candidates:Row[],error:string|null=null){
 await query(`INSERT INTO history_poi_candidates(tenant_id,history_store_id,source_name,source_brand,source_province,source_city,candidates_json,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(tenant_id,history_store_id) DO UPDATE SET source_name=EXCLUDED.source_name,source_brand=EXCLUDED.source_brand,source_province=EXCLUDED.source_province,source_city=EXCLUDED.source_city,candidates_json=EXCLUDED.candidates_json,error_message=EXCLUDED.error_message,checked_at=now()`,[tenantId,source.id,source.store_name,source.brand_name,source.province,source.city,JSON.stringify(candidates),error]);
}
export async function processHistoryMatchJob(id:number,tenantId:number,userId:number){
 const job=(await query("SELECT * FROM history_match_jobs WHERE id=$1 AND tenant_id=$2 AND created_by=$3",[id,tenantId,userId])).rows[0];if(!job)throw new Error("候选查询任务不存在");
 await query("UPDATE history_match_jobs SET status='running',error_message=NULL,updated_at=now() WHERE id=$1",[id]);
 const ids=(job.store_ids_json as number[]).slice(Number(job.processed)),errors:string[]=[];
 for(const storeId of ids){const source=(await query("SELECT * FROM history_stores WHERE tenant_id=$1 AND id=$2 AND brand_store_id IS NULL",[tenantId,storeId])).rows[0];
  if(source)try{const candidates=await resolveStoreCandidates({originalName:source.store_name,searchName:source.store_name,province:source.province,city:source.city,address:source.address,poiId:source.poi_id},async(path,params)=>{await consumeBackgroundQuota(tenantId,{userId,sourceType:"history_matching",sourceId:id,operation:"history_candidate_search",details:{path,page:params.page_num||params.page}});return amapRequest(path,params)});await cacheHistoryCandidates(tenantId,source,candidates.filter(p=>/^B[A-Z0-9]{9}$/i.test(p.id)) as unknown as Row[])}
  catch(error){const message=error instanceof Error?error.message:"候选查询失败";errors.push(`#${storeId} ${message}`);await cacheHistoryCandidates(tenantId,source,[],message);recordOps({tenantId,service:"worker",level:"warn",module:"history_matching",event:"candidate_search_failed",message,taskType:"history_matching",taskId:String(id)})}
  await query("UPDATE history_match_jobs SET processed=processed+1,updated_at=now() WHERE id=$1",[id]);
 }
 await query("UPDATE history_match_jobs SET status=$2,error_message=$3,updated_at=now() WHERE id=$1",[id,errors.length?"partial":"completed",errors.slice(-10).join("；")||null]);
}
