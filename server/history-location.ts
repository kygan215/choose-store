import type {PoolClient} from "pg";
import {pool,query} from "./db.js";
import {HistoryLinkError} from "./history-linking.js";
import {brandIdentityEvidenceNames} from "../shared/brand-store-policy.js";
import {canonicalSnackBrand} from "./snack-brands.js";

type Row=Record<string,unknown>;
export type HistoryLocationRegion={province:string;city:string};
export type HistoryLocationRegionVerifier=(longitude:number,latitude:number)=>Promise<HistoryLocationRegion>;
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const id=(value:unknown)=>{if(typeof value!=="number"&&(typeof value!=="string"||!/^\d+$/.test(value)))return 0;const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:0};
export const realHistoryPoiId=(value:unknown)=>/^B[A-Z0-9]{9}$/i.test(text(value))?text(value).toUpperCase():null;
const coordinate=(value:unknown)=>typeof value==="number"?value:typeof value==="string"&&/^-?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN;
export function parseHistoryLocationInput(body:Row){
 const address=text(body.address),reason=text(body.reason),longitude=coordinate(body.longitude),latitude=coordinate(body.latitude),source=text(body.source??body.location_source)||"manual",evidence=text(body.evidence??body.location_share);
 if(!address||address.length>500)throw new HistoryLinkError("核实地址须为 1 至 500 个字符",400,"HISTORY_LOCATION_INVALID");
 if(reason.length<2||reason.length>1000)throw new HistoryLinkError("请填写 2 至 1000 字的核实依据或修改原因",400,"HISTORY_LOCATION_INVALID");
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude<72.004||longitude>137.8347||latitude<0.8293||latitude>55.8271)throw new HistoryLinkError("请填写有效的中国境内 GCJ02 经度和纬度，地址定位点不代表真实 POI",400,"HISTORY_LOCATION_INVALID");
 if(!["manual","amap_share"].includes(source)||evidence.length>2000)throw new HistoryLinkError("位置来源或核实线索无效",400,"HISTORY_LOCATION_INVALID");
 return {address,longitude,latitude,reason,source,evidence};
}
export function analysisHistoryIdentityIssues(history:Row,target:Row){
 const issues:string[]=historySourceIdentityIssues(history),sourceBrand=canonicalSnackBrand(text(history.brand_name)),declaredBrand=canonicalSnackBrand(text(target.library_brand)||text(target.brand));
 if(declaredBrand&&sourceBrand!==declaredBrand)issues.push("分析门店品牌与历史品牌不一致");
 if(text(target.library_brand)&&text(target.brand)&&canonicalSnackBrand(text(target.library_brand))!==canonicalSnackBrand(text(target.brand)))issues.push("分析记录的品牌字段与已关联品牌库门店不一致");
 if(!declaredBrand&&!brandIdentityEvidenceNames(sourceBrand).some(alias=>(text(target.standard_name)||text(target.input_name)).normalize("NFKC").includes(alias)))issues.push("分析记录缺少可确认的品牌信息，请先核对分析门店品牌");
 if(history.province&&target.province&&history.province!==target.province)issues.push("分析门店省份与历史门店不一致");
 if(history.city&&target.city&&history.city!==target.city)issues.push("分析门店城市与历史门店不一致");
 if(target.history_store_id&&Number(target.history_store_id)!==Number(history.id))issues.push("该分析记录已关联其他历史档案，不能直接覆盖");
 for(const key of ["province","city"]){if(target[`library_${key}`]&&history[key]&&target[`library_${key}`]!==history[key])issues.push(`分析记录品牌库门店${key==="province"?"省份":"城市"}与历史门店不一致`);if(target[key]&&target[`library_${key}`]&&target[key]!==target[`library_${key}`])issues.push("分析记录地区与其品牌库门店不一致")}
 const original=realHistoryPoiId(history.poi_id)||realHistoryPoiId(history.history_library_poi_id),next=realHistoryPoiId(target.amap_poi_id)||realHistoryPoiId(target.library_poi_id);
 if(realHistoryPoiId(target.amap_poi_id)&&realHistoryPoiId(target.library_poi_id)&&realHistoryPoiId(target.amap_poi_id)!==realHistoryPoiId(target.library_poi_id))issues.push("分析记录的真实 POI 与其品牌库门店不一致");
 if(original&&next&&original!==next)issues.push("分析门店与历史档案已有不同真实 POI ID");
 if(history.brand_store_id&&target.brand_store_id&&Number(history.brand_store_id)!==Number(target.brand_store_id)&&!(original&&next&&original===next))issues.push("分析记录与历史档案关联了不同品牌库门店");
 return issues;
}
export function historySourceIdentityIssues(history:Row){
 const issues:string[]=[],original=realHistoryPoiId(history.poi_id),library=realHistoryPoiId(history.history_library_poi_id);
 if(original&&library&&original!==library)issues.push("历史档案的原 POI 与已关联品牌库 POI 不一致，请先核对");
 if(history.history_library_brand&&canonicalSnackBrand(text(history.history_library_brand))!==canonicalSnackBrand(text(history.brand_name)))issues.push("历史档案与已关联品牌库的品牌不一致");
 for(const key of ["province","city"])if(history[key]&&history[`history_library_${key}`]&&history[key]!==history[`history_library_${key}`])issues.push("历史档案与已关联品牌库的省市不一致");
 return issues;
}
const historySourceSelect=`SELECT h.*,b.amap_poi_id history_library_poi_id,b.brand_name history_library_brand,b.province history_library_province,b.city history_library_city,b.longitude history_library_longitude,b.latitude history_library_latitude FROM history_stores h LEFT JOIN brand_stores b ON b.id=h.brand_store_id AND b.tenant_id=h.tenant_id WHERE h.tenant_id=$1 AND h.id=$2`;
const regionKey=(value:unknown)=>text(value).replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u,"");
export function historyLocationRegionIssues(history:Row,region:HistoryLocationRegion){
 const issues:string[]=[];
 if(text(history.province)&&regionKey(history.province)!==regionKey(region.province))issues.push("核实位置所在省份与历史门店不一致");
 if(text(history.city)&&regionKey(history.city)!==regionKey(region.city))issues.push("核实位置所在城市与历史门店不一致");
 return issues;
}
function distanceMetres(a:number,b:number,c:number,d:number){const rad=Math.PI/180,x=Math.sin((d-b)*rad/2)**2+Math.cos(b*rad)*Math.cos(d*rad)*Math.sin((c-a)*rad/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
async function transaction<T>(tenantId:number,run:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,97134)",[tenantId]);const result=await run(client);await client.query("COMMIT");return result}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}}
const historyNotFound=()=>new HistoryLinkError("历史门店不存在或不属于当前组织",404,"HISTORY_STORE_NOT_FOUND");
export async function saveHistoryLocation(tenantId:number,userId:number,historyId:number,body:Row,ip="",verifyRegion?:HistoryLocationRegionVerifier){
 if(!id(historyId))throw new HistoryLinkError("历史门店编号无效",400,"HISTORY_LOCATION_INVALID");
 const input=parseHistoryLocationInput(body);
 const original=(await query(historySourceSelect,[tenantId,historyId])).rows[0];if(!original)throw historyNotFound();
 let region:HistoryLocationRegion;
 try{if(!verifyRegion)throw new Error("未提供位置地区核验服务");region=await verifyRegion(input.longitude,input.latitude);if(!text(region.province)||!text(region.city))throw new Error("高德没有返回可核对的省市")}catch{throw new HistoryLinkError("暂时无法核对该坐标的省市，位置尚未保存。请保留输入，稍后重试；原始活动仍可正常查看",503,"HISTORY_LOCATION_REGION_UNAVAILABLE")}
 return transaction(tenantId,async client=>{
  const old=(await client.query(`${historySourceSelect} FOR UPDATE OF h`,[tenantId,historyId])).rows[0];if(!old)throw historyNotFound();
  const sourceIssues=historySourceIdentityIssues(old);if(sourceIssues.length)throw new HistoryLinkError("历史档案现有关联身份冲突，请先核对",409,"HISTORY_LOCATION_IDENTITY_MISMATCH",{issues:sourceIssues.map(reason=>({history_store_id:historyId,reason}))});
  const expected=text(body.expected_updated_at);if(expected&&new Date(expected).getTime()!==new Date(old.updated_at).getTime())throw new HistoryLinkError("历史档案已被其他操作更新，请刷新后重新核对",409,"HISTORY_LOCATION_STALE");
  const regionIssues=historyLocationRegionIssues(old,region);if(regionIssues.length)throw new HistoryLinkError("坐标所在地区与历史门店不一致，请核对地址和经纬度",409,"HISTORY_LOCATION_REGION_MISMATCH",{issues:regionIssues.map(reason=>({history_store_id:historyId,reason})),actual_region:region});
  if(old.brand_store_id){const brand=(await client.query("SELECT longitude,latitude FROM brand_stores WHERE tenant_id=$1 AND id=$2 FOR SHARE",[tenantId,old.brand_store_id])).rows[0];if(brand&&Number.isFinite(Number(brand.longitude))&&Number.isFinite(Number(brand.latitude))&&distanceMetres(input.longitude,input.latitude,Number(brand.longitude),Number(brand.latitude))>5000)throw new HistoryLinkError("核实位置与已关联品牌门店的位置相距超过 5 公里，请先核对原关联",409,"HISTORY_LOCATION_IDENTITY_MISMATCH")}
  const unchanged=old.verified_address===input.address&&Number(old.verified_longitude)===input.longitude&&Number(old.verified_latitude)===input.latitude&&old.location_source===input.source&&text(old.location_evidence)===input.evidence;
  let store=old;
  if(!unchanged){store=(await client.query(`UPDATE history_stores SET verified_address=$3,verified_longitude=$4,verified_latitude=$5,location_source=$6,location_evidence=$7,location_confirmed_by=$8,location_confirmed_at=now(),location_version=location_version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,historyId,input.address,input.longitude,input.latitude,input.source,input.evidence,userId])).rows[0];await client.query("DELETE FROM history_poi_candidates WHERE tenant_id=$1 AND history_store_id=$2",[tenantId,historyId]);await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_location_confirm','history_store',$3,$4,$5)",[tenantId,userId,String(historyId),ip,JSON.stringify({reason:input.reason,before:{address:old.verified_address,longitude:old.verified_longitude,latitude:old.verified_latitude,source:old.location_source,evidence:old.location_evidence},after:input,coordinate_system:"GCJ02",actual_region:region,not_a_poi:true})])}
  return {store:{...store,id:Number(store.id)},history_store_id:historyId,changed:unchanged?0:1,location:{address:store.verified_address,longitude:store.verified_longitude,latitude:store.verified_latitude,source:store.location_source,evidence:store.location_evidence,confirmed_by:Number(store.location_confirmed_by),confirmed_at:store.location_confirmed_at},history_store_ids:[historyId]};
 });
}

export async function searchAnalysisHistoryCandidates(tenantId:number,historyId:number,q:string){
 if(!id(historyId)||q.length>100)throw new HistoryLinkError("请输入有效的历史门店编号及 100 字以内的搜索条件",400,"HISTORY_ANALYSIS_INVALID");
 const history=(await query(historySourceSelect,[tenantId,historyId])).rows[0];if(!history)throw historyNotFound();
 const rows=(await query(`SELECT s.id,s.input_name,s.standard_name,s.province,s.city,s.address,s.job_id,s.amap_poi_id,s.brand,s.brand_store_id,s.history_store_id,b.brand_name library_brand,b.amap_poi_id library_poi_id,b.province library_province,b.city library_city
 FROM stores s LEFT JOIN brand_stores b ON b.id=s.brand_store_id AND b.tenant_id=s.tenant_id
 WHERE s.tenant_id=$1 AND ($2::text='' OR s.id::text=$2 OR s.job_id::text=$2 OR upper(COALESCE(s.amap_poi_id,''))=upper($2)
 OR position(lower($2) IN lower(s.input_name))>0 OR position(lower($2) IN lower(COALESCE(s.standard_name,'')))>0 OR position(lower($2) IN lower(COALESCE(s.address,'')))>0)
 AND ($2::text<>'' OR ((s.province='' OR s.province IS NULL OR s.province=$3) AND (s.city='' OR s.city IS NULL OR s.city=$4)))
 ORDER BY (s.history_store_id=$5) DESC NULLS LAST,s.id DESC LIMIT 30`,[tenantId,q,text(history.province),text(history.city),historyId])).rows;
 return {history_store:{...history,id:Number(history.id)},rows:rows.map(row=>({...row,id:Number(row.id),job_id:row.job_id==null?null:Number(row.job_id),history_store_id:row.history_store_id==null?null:Number(row.history_store_id),conflicts:analysisHistoryIdentityIssues(history,row)}))};
}
export async function linkHistoryAnalysisStore(tenantId:number,userId:number,historyId:number,analysisId:number,reason:string,ip=""){
 if(!id(historyId)||!id(analysisId)||reason.length<2||reason.length>1000)throw new HistoryLinkError("请选择有效的分析记录，并填写 2 至 1000 字的人工核实依据",400,"HISTORY_ANALYSIS_INVALID");
 return transaction(tenantId,async client=>{
  const history=(await client.query(`${historySourceSelect} FOR UPDATE OF h`,[tenantId,historyId])).rows[0];if(!history)throw historyNotFound();
  const target=(await client.query(`SELECT s.*,b.brand_name library_brand,b.amap_poi_id library_poi_id,b.province library_province,b.city library_city FROM stores s LEFT JOIN brand_stores b ON b.id=s.brand_store_id AND b.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.id=$2 FOR UPDATE OF s`,[tenantId,analysisId])).rows[0];if(!target)throw new HistoryLinkError("分析记录不存在或不属于当前组织",404,"HISTORY_ANALYSIS_NOT_FOUND");
  const issues=analysisHistoryIdentityIssues(history,target);if(issues.length)throw new HistoryLinkError("分析记录与历史档案不一致，请先核对",409,"HISTORY_ANALYSIS_IDENTITY_MISMATCH",{issues:issues.map(reason=>({history_store_id:historyId,analysis_store_id:analysisId,reason}))});
  const realPoi=realHistoryPoiId(target.amap_poi_id)||realHistoryPoiId(target.library_poi_id)||realHistoryPoiId(history.poi_id)||realHistoryPoiId(history.history_library_poi_id),brandStoreId=target.brand_store_id||history.brand_store_id||null;
  const existingIdentity=(await client.query("SELECT id,amap_poi_id,brand_store_id FROM stores WHERE tenant_id=$1 AND history_store_id=$2 AND id<>$3",[tenantId,historyId,analysisId])).rows;
  if(existingIdentity.some(row=>{const previous=realHistoryPoiId(row.amap_poi_id);return Boolean(realPoi&&previous&&realPoi!==previous)||Boolean(brandStoreId&&row.brand_store_id&&Number(brandStoreId)!==Number(row.brand_store_id)&&!(realPoi&&realPoi===previous))}))throw new HistoryLinkError("该历史档案已有不同门店身份的分析记录，请先核对原关联",409,"HISTORY_ANALYSIS_IDENTITY_MISMATCH");
  const collisions=(await client.query(`WITH peers AS (
   SELECT DISTINCT h.id,h.store_name FROM history_stores h
   LEFT JOIN brand_stores b ON b.id=h.brand_store_id AND b.tenant_id=h.tenant_id
   LEFT JOIN stores s ON s.history_store_id=h.id AND s.tenant_id=h.tenant_id
   WHERE h.tenant_id=$1 AND h.id<>$2 AND (($3::text IS NOT NULL AND (upper(btrim(COALESCE(h.poi_id,'')))=$3 OR upper(btrim(COALESCE(b.amap_poi_id,'')))=$3 OR upper(btrim(COALESCE(s.amap_poi_id,'')))=$3))
    OR ($4::bigint IS NOT NULL AND (h.brand_store_id=$4 OR s.brand_store_id=$4)))
  ) SELECT DISTINCT p.id history_store_id,p.store_name,a.start_date::text,a.end_date::text FROM peers p
   JOIN history_activities a ON a.history_store_id=p.id AND a.tenant_id=$1 AND a.revoked_at IS NULL
   JOIN history_activities incoming ON incoming.tenant_id=$1 AND incoming.history_store_id=$2 AND incoming.revoked_at IS NULL AND incoming.start_date=a.start_date AND incoming.end_date=a.end_date LIMIT 100`,[tenantId,historyId,realPoi,brandStoreId])).rows;
  if(collisions.length)throw new HistoryLinkError("同一门店在相同日期已有另一份历史活动，系统未保存本次关联",409,"HISTORY_ACTIVITY_DUPLICATE",{store_conflicts:collisions.map(row=>({...row,reason:`${row.store_name} 在 ${row.start_date} 至 ${row.end_date} 已有相同门店的活动`}))});
  const already=Number(target.history_store_id)===historyId;
  if(!already){await client.query("UPDATE stores SET history_store_id=$3,history_linked_by=$4,history_linked_at=now(),history_link_reason=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,analysisId,historyId,userId,reason]);await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_link_analysis','store',$3,$4,$5)",[tenantId,userId,String(analysisId),ip,JSON.stringify({history_store_id:historyId,reason,previous_history_store_id:target.history_store_id,real_poi_id:realPoi,coordinate_only:!realHistoryPoiId(target.amap_poi_id)})])}
  return {linked:1,changed:already?0:1,already_linked:already?1:0,history_store_id:historyId,analysis_store_id:analysisId,history_store_ids:[historyId]};
 });
}

export async function createHistoryAnalysisStore(tenantId:number,userId:number,historyId:number,reason:string,ip="",expectedUpdatedAt=""){
 if(!id(historyId)||reason.length<2||reason.length>1000)throw new HistoryLinkError("请填写有效的历史门店编号及 2 至 1000 字的人工核实依据",400,"HISTORY_ANALYSIS_INVALID");
 return transaction(tenantId,async client=>{
  const history=(await client.query(`${historySourceSelect} FOR UPDATE OF h`,[tenantId,historyId])).rows[0];if(!history)throw historyNotFound();
  if(expectedUpdatedAt&&new Date(expectedUpdatedAt).getTime()!==new Date(history.updated_at).getTime())throw new HistoryLinkError("历史档案或核实位置已更新，请刷新并重新核对后再创建分析",409,"HISTORY_LOCATION_STALE");
  const sourceIssues=historySourceIdentityIssues(history);if(sourceIssues.length)throw new HistoryLinkError("历史档案现有关联身份冲突，请先核对",409,"HISTORY_ANALYSIS_IDENTITY_MISMATCH",{issues:sourceIssues.map(reason=>({history_store_id:historyId,reason}))});
  if(realHistoryPoiId(history.poi_id)||realHistoryPoiId(history.history_library_poi_id))throw new HistoryLinkError("历史档案已有真实 POI 关联，请使用已关联门店进行分析，不应另建无 POI 位置替代",409,"HISTORY_LOCATION_HAS_POI");
  if(!history.location_confirmed_at||!history.location_confirmed_by||!text(history.brand_name)||!text(history.store_name)||!text(history.province)||!text(history.city))throw new HistoryLinkError("请先人工核实品牌、省市、门店身份及位置，保存核实位置后再创建分析",409,"HISTORY_LOCATION_NOT_VERIFIED");
  const location=parseHistoryLocationInput({address:history.verified_address,longitude:history.verified_longitude,latitude:history.verified_latitude,reason,source:history.location_source,evidence:history.location_evidence});
  const candidate={id:`COORD-history-${historyId}`,name:history.store_name,province:history.province,city:history.city,district:"",address:location.address,location:[location.longitude,location.latitude],type:"人工核实位置",source:"history_verified",score:0,status:"人工核实位置",reasons:["管理员已人工核实门店身份与位置"],conflicts:[],warnings:["没有高德 POI ID；位置经人工核实，不代表高德认证"]};
  const existing=(await client.query("SELECT id FROM stores WHERE tenant_id=$1 AND created_by=$2 AND history_store_id=$3 AND job_id IS NULL AND amap_poi_id IS NULL AND confirmation_method='历史档案人工核实位置' AND longitude=$4 AND latitude=$5 AND address=$6 AND brand=$7 AND input_name=$8 AND province=$9 AND city=$10 ORDER BY id DESC LIMIT 1",[tenantId,userId,historyId,location.longitude,location.latitude,location.address,history.brand_name,history.store_name,history.province,history.city])).rows[0];
  if(existing)return {analysis_store_id:Number(existing.id),created:false,candidate};
  const row=(await client.query(`INSERT INTO stores(tenant_id,created_by,input_name,standard_name,longitude,latitude,province,city,address,brand,status,match_status,match_score,match_candidates_json,confirmation_method,history_store_id,history_linked_by,history_linked_at,history_link_reason)
   VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'已确认','人工核实位置',0,$10,'历史档案人工核实位置',$11,$2,now(),$12) RETURNING id`,[tenantId,userId,history.store_name,location.longitude,location.latitude,history.province,history.city,location.address,history.brand_name,JSON.stringify([candidate]),historyId,reason])).rows[0];
  await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_create_analysis','store',$3,$4,$5)",[tenantId,userId,String(row.id),ip,JSON.stringify({history_store_id:historyId,reason,location_confirmed_at:history.location_confirmed_at,real_poi_id:null,coordinate_system:"GCJ02"})]);
  return {analysis_store_id:Number(row.id),created:true,candidate};
 });
}
