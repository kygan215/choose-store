import crypto from "node:crypto";
import {Router, type Request, type Response, type NextFunction} from "express";
import multer from "multer";
import type {PoolClient} from "pg";
import {pool,query} from "./db.js";
import {resolveStoreCandidates} from "./services.js";
import {exactHistoryPreview,validateExactHistoryLinks,cacheHistoryCandidates} from "./history-matching.js";
import {HistoryLinkError,applyHistoryLinks,historyLinkCollisions,linkHistoryStores} from "./history-linking.js";
import {consumeBackgroundQuota} from "./amap-usage.js";
import {amapRequest} from "./services.js";
import {saveDiscoveredStores} from "./brand-library.js";
import {assessBrandStore} from "../shared/brand-store-policy.js";
import {isRetiredSnackBrand} from "./snack-brands.js";
import {canAccessHistory} from "./history-export-data.js";
import {calendarTags,dateRangeHeader,historyIdentity,parseHistoryWorkbook,salesAmount,validDate,type HistoryParsed,type HistorySourceRow} from "./history-parse.js";

type DataRow=Record<string,unknown>;
const router=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024}});
const respond=(res:Response,data:unknown,message="操作成功",status=200)=>res.status(status).json({success:true,data,message});
const bad=(res:Response,message:string,status=400,details?:unknown,code?:string)=>res.status(status).json({success:false,data:details||null,message,error:{code:code||(status===409?"CONFLICT":"REQUEST_ERROR"),message}});
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const positiveId=(v:unknown)=>{if(typeof v!=="number"&&(typeof v!=="string"||!/^\d+$/.test(v)))return 0;const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:0};
const year=(v:unknown)=>{const n=Number(v);return Number.isInteger(n)&&n>=1900&&n<=2100?n:0};
const amount=(v:unknown)=>v==null||v===""?null:salesAmount(String(v));
const refund=(v:unknown)=>["refunded","not_refunded","unknown"].includes(String(v))?String(v):"unknown";
const pageSize=(v:unknown)=>Math.min(100,Math.max(1,Math.floor(Number(v)||50)));
const page=(v:unknown)=>Math.max(1,Math.floor(Number(v)||1));
const requireAdmin=(req:Request,res:Response,next:NextFunction)=>req.user?.role==="admin"?next():bad(res,"需要管理员权限",403);
const requireHistory=(kind:"view"|"export")=>async(req:Request,res:Response,next:NextFunction)=>{try{if(!req.user||!await canAccessHistory(req.user.tenantId,req.user.id,req.user.role,kind))return bad(res,kind==="view"?"没有历史活动数据查看权限":"没有历史活动数据导出权限",403);next()}catch(e){next(e)}};
const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next)};
const normalize=(v:unknown)=>str(v).normalize("NFKC").toLowerCase().replace(/\s+/g,"");

router.get("/permissions",wrap(async(req,res)=>{const user=req.user!,row=(await query<{can_view:boolean;can_export:boolean}>("SELECT can_view,can_export FROM history_permissions WHERE tenant_id=$1 AND user_id=$2",[user.tenantId,user.id])).rows[0];return respond(res,{can_view:user.role==="admin"||Boolean(row?.can_view),can_export:user.role==="admin"||Boolean(row?.can_view&&row?.can_export),can_manage:user.role==="admin"})}));
router.get("/admin/permissions/:userId",requireAdmin,wrap(async(req,res)=>{const userId=positiveId(req.params.userId),row=(await query<DataRow>("SELECT u.id,h.can_view,h.can_export FROM users u LEFT JOIN history_permissions h ON h.user_id=u.id AND h.tenant_id=u.tenant_id WHERE u.tenant_id=$1 AND u.id=$2",[req.user!.tenantId,userId])).rows[0];if(!row)return bad(res,"账号不存在",404);return respond(res,{user_id:Number(row.id),can_view:Boolean(row.can_view),can_export:Boolean(row.can_export)})}));
router.put("/admin/permissions/:userId",requireAdmin,wrap(async(req,res)=>{const userId=positiveId(req.params.userId),canView=req.body?.can_view===true,canExport=req.body?.can_export===true;if(!userId||typeof req.body?.can_view!=="boolean"||typeof req.body?.can_export!=="boolean"||canExport&&!canView)return bad(res,"请分别设置查看和导出权限，导出须同时具有查看权限");const user=(await query<DataRow>("SELECT id,role FROM users WHERE tenant_id=$1 AND id=$2",[req.user!.tenantId,userId])).rows[0];if(!user)return bad(res,"账号不存在",404);await query("INSERT INTO history_permissions(tenant_id,user_id,can_view,can_export,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id) DO UPDATE SET can_view=EXCLUDED.can_view,can_export=EXCLUDED.can_export,updated_by=EXCLUDED.updated_by,updated_at=NOW()",[req.user!.tenantId,userId,canView,canExport,req.user!.id]);await query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_permission','user',$3,$4,$5)",[req.user!.tenantId,req.user!.id,String(userId),req.ip||"",{can_view:canView,can_export:canExport}]);return respond(res,{user_id:userId,can_view:canView,can_export:canExport})}));

function dateFilter(req:Request){const start=str(req.query.start),end=str(req.query.end),y=year(req.query.year);if((start&&!validDate(start))||(end&&!validDate(end))||(start&&end&&end<start))throw new Error("日期范围无效");return {start:start||null,end:end||null,year:y||null}}
router.get("/stores",requireHistory("view"),wrap(async(req,res)=>{
  const tenantId=req.user!.tenantId,{start,end,year:y}=dateFilter(req),brand=str(req.query.brand),province=str(req.query.province),city=str(req.query.city),basis=str(req.query.refund_basis),p=page(req.query.page),size=pageSize(req.query.page_size);if(basis&&!["refunded","not_refunded","unknown"].includes(basis))return bad(res,"销售额口径筛选值无效");
  const base=`FROM history_activities a JOIN history_stores hs ON hs.id=a.history_store_id AND hs.tenant_id=a.tenant_id LEFT JOIN brand_stores bs ON bs.id=hs.brand_store_id AND bs.tenant_id=hs.tenant_id WHERE a.tenant_id=$1 AND a.revoked_at IS NULL AND ($2::text='' OR a.brand_name=$2) AND ($3::text='' OR a.province=$3) AND ($4::text='' OR a.city=$4) AND ($5::int IS NULL OR EXTRACT(YEAR FROM a.start_date)=$5) AND ($6::date IS NULL OR a.start_date >= $6::date) AND ($7::date IS NULL OR a.start_date <= $7::date) AND ($8::text='' OR a.refund_basis=$8)`;
  const args=[tenantId,brand,province,city,y,start,end,basis],groupKey="CASE WHEN hs.brand_store_id IS NOT NULL THEN 'b:'||hs.brand_store_id::text ELSE 'h:'||hs.id::text END",result=(await query<DataRow>(`SELECT MIN(hs.id) id,MIN(hs.brand_store_id) brand_store_id,BOOL_OR(hs.archive_only) archive_only,(ARRAY_AGG(a.store_name ORDER BY a.start_date DESC,a.id DESC))[1] store_name,(ARRAY_AGG(a.brand_name ORDER BY a.start_date DESC,a.id DESC))[1] brand_name,(ARRAY_AGG(a.province ORDER BY a.start_date DESC,a.id DESC))[1] province,(ARRAY_AGG(a.city ORDER BY a.start_date DESC,a.id DESC))[1] city,MAX(bs.amap_name) current_store_name,MAX(bs.data_status) current_status,MAX(bs.deleted_at) current_deleted_at,BOOL_AND(bs.library_visible) current_library_visible,MAX(bs.name_decision) current_name_decision,COUNT(*)::int activity_count,MAX(a.start_date)::text latest_activity_start,SUM(a.sales_amount)::text sales_amount,COUNT(*) FILTER(WHERE a.sales_amount IS NULL)::int unknown_amount_count,COUNT(DISTINCT a.refund_basis)::int refund_basis_count ${base} GROUP BY ${groupKey} ORDER BY latest_activity_start DESC,id DESC LIMIT $9 OFFSET $10`,[...args,size,(p-1)*size])).rows;
  const metrics=(await query<DataRow>(`SELECT COUNT(DISTINCT ${groupKey})::int store_count,COUNT(*)::int activity_count,SUM(a.sales_amount)::text sales_amount,COUNT(*) FILTER(WHERE a.sales_amount IS NULL)::int unknown_amount_count,COUNT(DISTINCT a.refund_basis)::int refund_basis_count ${base}`,args)).rows[0];
  return respond(res,{rows:result.map(row=>({...row,id:Number(row.id),brand_store_id:row.brand_store_id==null?null:Number(row.brand_store_id)})),total:Number(metrics.store_count),metrics:{...metrics,mixed_refund_basis:Number(metrics.refund_basis_count)>1},page:p,page_size:size});
}));
router.get("/stores/:id/activities",requireHistory("view"),wrap(async(req,res)=>{
  const id=positiveId(req.params.id),tenantId=req.user!.tenantId,{start,end,year:y}=dateFilter(req),brand=str(req.query.brand),province=str(req.query.province),city=str(req.query.city),basis=str(req.query.refund_basis);
  if(basis&&!['refunded','not_refunded','unknown'].includes(basis))return bad(res,"销售额口径筛选值无效");
  const store=(await query<DataRow>("SELECT hs.*,bs.amap_name current_store_name,bs.data_status current_status,bs.deleted_at current_deleted_at,bs.library_visible current_library_visible,bs.name_decision current_name_decision FROM history_stores hs LEFT JOIN brand_stores bs ON bs.id=hs.brand_store_id AND bs.tenant_id=hs.tenant_id WHERE hs.tenant_id=$1 AND hs.id=$2",[tenantId,id])).rows[0];
  if(!store)return bad(res,"历史门店不存在",404);
  const rows=(await query<DataRow>(`SELECT a.id,a.history_store_id,a.start_date::text,a.end_date::text,a.activity_name,a.sales_amount::text,a.refund_basis,a.brand_name,a.store_name,a.province,a.city,a.address,a.source_import_id,a.source_sheet,a.source_cell,a.calendar_tags,a.revoked_at,a.created_at,a.updated_at
    FROM history_activities a JOIN history_stores hs ON hs.id=a.history_store_id AND hs.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND (hs.id=$2 OR ($3::bigint IS NOT NULL AND hs.brand_store_id=$3))
      AND ($4::int IS NULL OR EXTRACT(YEAR FROM a.start_date)=$4)
      AND ($5::date IS NULL OR a.start_date >= $5::date) AND ($6::date IS NULL OR a.start_date <= $6::date)
      AND ($7::text='' OR a.refund_basis=$7) AND ($8::text='' OR a.brand_name=$8)
      AND ($9::text='' OR a.province=$9) AND ($10::text='' OR a.city=$10)
    ORDER BY a.start_date DESC,a.id DESC`,[tenantId,id,store.brand_store_id||null,y,start,end,basis,brand,province,city])).rows;
  return respond(res,{store,rows});
}));
router.get("/facets",requireHistory("view"),wrap(async(req,res)=>{const rows=(await query<{brand_name:string;province:string;city:string}>("SELECT DISTINCT brand_name,province,city FROM history_activities WHERE tenant_id=$1 AND revoked_at IS NULL ORDER BY brand_name,province,city",[req.user!.tenantId])).rows;return respond(res,{rows,brands:[...new Set(rows.map(r=>r.brand_name))],provinces:[...new Set(rows.map(r=>r.province).filter(Boolean))],cities:[...new Set(rows.map(r=>r.city).filter(Boolean))]})}));

type Candidate={id:number;brand_name:string;amap_name:string;province:string;city:string;address:string;amap_poi_id:string|null};
// Candidate lookup is advisory only. Keep punctuation-free names together so a
// workbook's "零食很忙湖北…店" can find a library POI named "零食很忙(湖北…店)".
export function historyCandidateNameKey(value:unknown){return str(value).normalize("NFKC").toLowerCase().replace(/[\s()（）·•—_-]/g,"")}
const candidateNameSql="regexp_replace(lower(normalize(b.amap_name, NFKC)), '[[:space:]()（）·•—_-]+', '', 'g')";
export function historyAmapLibraryCandidates(source:{brand_name:unknown;province:unknown;city:unknown},poi:DataRow,library:Candidate[]){
  return library.filter(item=>item.amap_poi_id===poi.id&&item.brand_name===source.brand_name&&(!source.province||item.province===source.province)&&(!source.city||item.city===source.city)&&(!poi.province||item.province===poi.province)&&(!poi.city||item.city===poi.city));
}
router.post("/stores/:id/amap-candidates",requireAdmin,wrap(async(req,res)=>{
  const id=positiveId(req.params.id),tenantId=req.user!.tenantId;
  const source=(await query<{brand_name:string;store_name:string;province:string;city:string;address:string;poi_id:string|null}>("SELECT brand_name,store_name,province,city,address,poi_id FROM history_stores WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rows[0];
  if(!source)return bad(res,"历史门店不存在",404);
  const name=str(req.body?.q)||str(source.store_name);if(!name||name.length>100)return bad(res,"门店搜索名称须为 1 至 100 个字符");
  const requestedPoi=/^B[A-Z0-9]{9}$/i.test(name)?name.toUpperCase():"";
  const foundRaw=await resolveStoreCandidates({originalName:source.store_name,searchName:name,province:source.province,city:source.city,address:source.address,poiId:requestedPoi||(str(req.body?.q)?"":str(source.poi_id))},async(path,params)=>{await consumeBackgroundQuota(tenantId,{userId:req.user!.id,sourceType:"history_matching",sourceId:id,operation:"manual_candidate_search",details:{path,page:params.page_num||params.page}});return amapRequest(path,params)});
  const found=requestedPoi?foundRaw.filter(row=>String(row.id).toUpperCase()===requestedPoi):foundRaw;
  if(requestedPoi&&!found.length)return bad(res,"高德未返回该 POI ID 的门店，请核对 ID 后重试",404,null,"HISTORY_POI_NOT_FOUND");
  await cacheHistoryCandidates(tenantId,{...source,id},found.filter(item=>/^B[A-Z0-9]{9}$/i.test(String(item.id))) as unknown as DataRow[]);
  const pois=[...new Map(found.filter(item=>item.id&&!/^(COORD-|GEOCODE-)/i.test(String(item.id))&&item.source!=="amap_geocode").map(item=>[String(item.id),item])).values()].slice(0,10);
  const ids=pois.map(item=>String(item.id));
  const library=ids.length?(await query<Candidate>("SELECT id,brand_name,amap_name,province,city,address,amap_poi_id FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=ANY($2::text[])",[tenantId,ids])).rows.map(item=>({...item,id:Number(item.id)})):[];
  return respond(res,{rows:pois.map(item=>({id:item.id,name:item.name,province:item.province,city:item.city,district:item.district,address:item.address,type:item.type,score:item.score,reasons:item.reasons||[],conflicts:item.conflicts||[],warnings:item.warnings||[],library_candidates:historyAmapLibraryCandidates(source,item,library)}))},"高德候选已返回，请核对后人工确认；查询不会修改历史活动关联");
}));
router.get("/brand-stores/search",requireAdmin,wrap(async(req,res)=>{
  const tenantId=req.user!.tenantId,q=str(req.query.q),brand=str(req.query.brand),province=str(req.query.province),city=str(req.query.city);
  if(!q&&!brand&&!province&&!city)return bad(res,"请输入门店名称、地址或 POI ID，或选择品牌和地区");
  if([q,brand,province,city].some(value=>value.length>100))return bad(res,"搜索条件过长");
  const nameKey=historyCandidateNameKey(q);
  const rows=(await query<Candidate>(`SELECT id,brand_name,amap_name,province,city,address,amap_poi_id FROM brand_stores b
    WHERE tenant_id=$1 AND ($2::text='' OR POSITION(LOWER($2) IN LOWER(COALESCE(amap_poi_id,'')))>0 OR POSITION(LOWER($2) IN LOWER(amap_name))>0 OR POSITION(LOWER($2) IN LOWER(COALESCE(address,'')))>0 OR (length($6::text)>=4 AND ${candidateNameSql}=$6))
      AND ($3::text='' OR brand_name=$3) AND ($4::text='' OR province=$4) AND ($5::text='' OR city=$5)
    ORDER BY CASE WHEN amap_poi_id=$2 AND $2<>'' THEN 0 WHEN LOWER(amap_name)=LOWER($2) AND $2<>'' THEN 1 WHEN length($6::text)>=4 AND ${candidateNameSql}=$6 THEN 2 WHEN LEFT(LOWER(amap_name),LENGTH($2))=LOWER($2) AND $2<>'' THEN 3 ELSE 4 END,id DESC LIMIT 20`,[tenantId,q,brand,province,city,nameKey])).rows;
  return respond(res,{rows:rows.map(row=>({...row,id:Number(row.id)}))});
}));
async function candidates(tenantId:number,rows:HistorySourceRow[]){
  const input=rows.map(r=>{const p=r.province.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/,""),c=r.city.replace(/(市|地区|自治州)$/,""),withoutProvince=p&&r.name.startsWith(p)?r.name.slice(p.length):r.name,withoutCity=c&&withoutProvince.startsWith(c)?withoutProvince.slice(c.length):withoutProvince;return {row_number:r.row_number,brand:r.brand,province:r.province,city:r.city,name:r.name,search_name:withoutCity.slice(0,50),search_key:historyCandidateNameKey(r.name),poi_id:r.poi_id}});
  if(!input.length)return new Map<number,Candidate[]>();
  const found=(await query<Candidate&{row_number:number}>(`SELECT r.row_number,b.id,b.brand_name,b.amap_name,b.province,b.city,b.address,b.amap_poi_id FROM jsonb_to_recordset($2::jsonb) AS r(row_number int,brand text,province text,city text,name text,search_name text,search_key text,poi_id text) CROSS JOIN LATERAL (SELECT id,brand_name,amap_name,province,city,address,amap_poi_id FROM brand_stores b WHERE b.tenant_id=$1 AND r.brand<>'' AND b.brand_name=r.brand AND (r.province='' OR b.province=r.province) AND (r.city='' OR b.city=r.city) AND ((r.poi_id<>'' AND b.amap_poi_id=r.poi_id) OR (length(r.search_key)>=4 AND ${candidateNameSql}=r.search_key) OR (length(r.search_name)>=2 AND (b.amap_name ILIKE '%'||r.search_name||'%' OR r.search_name ILIKE '%'||b.amap_name||'%'))) ORDER BY (b.amap_poi_id=r.poi_id AND r.poi_id<>'') DESC,(length(r.search_key)>=4 AND ${candidateNameSql}=r.search_key) DESC,(b.amap_name=r.search_name) DESC,abs(length(b.amap_name)-length(r.search_name)) LIMIT 5) b`,[tenantId,JSON.stringify(input)])).rows;
  const map=new Map<number,Candidate[]>();for(const row of found){const list=map.get(row.row_number)||[];list.push({...row,id:Number(row.id)});map.set(row.row_number,list)}return map;
}
async function poiAutoMatches(tenantId:number,rows:HistorySourceRow[]){const ids=[...new Set(rows.map(r=>r.poi_id).filter(Boolean))];if(!ids.length)return new Map<string,DataRow>();const found=(await query<DataRow>("SELECT amap_poi_id,COUNT(*)::int count,MIN(id) id,MIN(brand_name) brand_name,MIN(province) province,MIN(city) city FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=ANY($2::text[]) GROUP BY amap_poi_id",[tenantId,ids])).rows;return new Map(found.map(row=>[String(row.amap_poi_id),row]));}
function safeAutoMatch(row:HistorySourceRow,map:Map<string,DataRow>){const found=map.get(row.poi_id);return found&&Number(found.count)===1&&found.brand_name===row.brand&&(!row.province||row.province===found.province)&&(!row.city||row.city===found.city)?Number(found.id):null}
export function identityMismatch(row:Pick<HistorySourceRow,"brand"|"province"|"city"|"poi_id">,candidate:DataRow,poiField:"poi_id"|"amap_poi_id"){
  return Boolean(candidate.brand_name!==row.brand||(row.province&&candidate.province!==row.province)||(row.city&&candidate.city!==row.city)||(row.poi_id&&candidate[poiField]&&candidate[poiField]!==row.poi_id));
}
async function historicalPoiIdentity(tenantId:number,rows:CommitRow[]){
  const ids=[...new Set(rows.map(r=>r.poi_id).filter(Boolean))],issues:DataRow[]=[];
  if(!ids.length)return issues;
  const found=(await query<DataRow>("SELECT id,identity_key,poi_id,brand_name,store_name,province,city,address FROM history_stores WHERE tenant_id=$1 AND poi_id=ANY($2::text[])",[tenantId,ids])).rows,byPoi=new Map<string,DataRow[]>();
  for(const item of found){const group=byPoi.get(String(item.poi_id))||[];group.push(item);byPoi.set(String(item.poi_id),group)}
  for(const row of rows){
    if(!row.poi_id)continue;
    const group=byPoi.get(row.poi_id)||[];
    if(!group.length)continue;
    const selected=row.history_store_id?group.find(item=>Number(item.id)===row.history_store_id):null;
    if(selected&&!identityMismatch(row,selected,"poi_id"))continue;
    if(group.length===1&&group[0].identity_key===row.identity_key&&!identityMismatch(row,group[0],"poi_id"))continue;
    issues.push({row_number:row.row_number,history_store_id:group.length===1?group[0].id:null,candidate_ids:group.map(item=>item.id),candidate_stores:group.map(({id,brand_name,store_name,province,city,address,poi_id})=>({id,brand_name,store_name,province,city,address,poi_id})),reason:"相同 POI ID 已存在不同历史门店档案；请明确选择兼容的历史档案，避免重算或隐藏销售"});
  }
  return issues;
}
router.get("/matching/preview",requireAdmin,wrap(async(req,res)=>respond(res,await exactHistoryPreview(req.user!.tenantId))));
router.get("/matching/jobs",requireAdmin,wrap(async(req,res)=>respond(res,(await query("SELECT id,status,total,processed,error_message,updated_at FROM history_match_jobs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 5",[req.user!.tenantId])).rows)));
router.post("/matching/search",requireAdmin,wrap(async(req,res)=>{
 const tenantId=req.user!.tenantId,preview=await exactHistoryPreview(tenantId),requested=Array.isArray(req.body?.store_ids)?req.body.store_ids.map(positiveId):null;
 const ids=requested?[...new Set<number>(requested)].filter(id=>preview.rows.some(row=>row.id===id)):preview.rows.filter(row=>row.state!=="unique").map(row=>row.id);
 if(!ids.length||ids.length>500)return bad(res,"请选择 1 至 500 家待匹配门店；唯一同名候选可先批量确认，无需重复查询高德");
 const client=await pool.connect();let row:DataRow;
 try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,721121)",[tenantId]);
  const active=(await client.query("SELECT id FROM history_match_jobs WHERE tenant_id=$1 AND status IN ('waiting','running') ORDER BY id DESC LIMIT 1",[tenantId])).rows[0];if(active){await client.query("ROLLBACK");return bad(res,`候选查询任务 #${active.id} 正在执行，请等待完成`,409)}
  row=(await client.query("INSERT INTO history_match_jobs(tenant_id,created_by,store_ids_json,total) VALUES($1,$2,$3,$4) RETURNING id",[tenantId,req.user!.id,JSON.stringify(ids),ids.length])).rows[0];await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
 try{const {taskQueue}=await import("./queue.js");await taskQueue.add("history-candidates",{matchJobId:Number(row.id),tenantId,userId:req.user!.id},{jobId:`history-candidates-${row.id}`,attempts:2})}
 catch(error){await query("UPDATE history_match_jobs SET status='failed',error_message='队列派发失败，请重试',updated_at=now() WHERE id=$1",[row.id]);throw error}
 return respond(res,{id:Number(row.id),total:ids.length},"后台查询候选已启动；查询不会自动关联或修改历史销售额");
}));
router.get("/pending",requireHistory("view"),wrap(async(req,res)=>{
  const p=page(req.query.page),size=pageSize(req.query.page_size),tenantId=req.user!.tenantId;
  const rows=(await query<DataRow>(`SELECT hs.*,COUNT(a.id)::int activity_count,SUM(a.sales_amount)::text sales_amount,
      COUNT(a.id) FILTER (WHERE a.sales_amount IS NULL)::int unknown_amount_count,
      (hs.archive_only AND COUNT(a.id)=0) is_empty_archive
    FROM history_stores hs LEFT JOIN history_activities a ON a.history_store_id=hs.id AND a.tenant_id=hs.tenant_id AND a.revoked_at IS NULL
    WHERE hs.tenant_id=$1 AND hs.brand_store_id IS NULL GROUP BY hs.id
    HAVING (hs.archive_only=FALSE AND COUNT(a.id)>0) OR (hs.archive_only=TRUE AND COUNT(a.id)=0)
    ORDER BY hs.id DESC LIMIT $2 OFFSET $3`,[tenantId,size,(p-1)*size])).rows;
  const total=Number((await query<{n:string}>(`SELECT COUNT(*)::text n FROM history_stores hs WHERE tenant_id=$1 AND brand_store_id IS NULL
    AND ((archive_only=TRUE AND NOT EXISTS(SELECT 1 FROM history_activities a WHERE a.history_store_id=hs.id AND a.tenant_id=hs.tenant_id AND a.revoked_at IS NULL))
      OR (archive_only=FALSE AND EXISTS(SELECT 1 FROM history_activities a WHERE a.history_store_id=hs.id AND a.tenant_id=hs.tenant_id AND a.revoked_at IS NULL)))`,[tenantId])).rows[0]?.n||0);
  const sourceRows:HistorySourceRow[]=rows.map(r=>({row_number:Number(r.id),name:String(r.store_name),brand:String(r.brand_name),province:String(r.province),city:String(r.city),region_source:"column",address:String(r.address),poi_id:String(r.poi_id||""),values:{},issues:[]})),candidateMap=await candidates(tenantId,sourceRows);
  const saved=(await query<DataRow>("SELECT c.* FROM history_poi_candidates c JOIN history_stores h ON h.id=c.history_store_id AND h.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.history_store_id=ANY($2::bigint[]) AND c.source_name=h.store_name AND c.source_brand=h.brand_name AND c.source_province=h.province AND c.source_city=h.city",[tenantId,rows.map(r=>Number(r.id))])).rows;
  const poiIds=[...new Set(saved.flatMap(r=>(Array.isArray(r.candidates_json)?r.candidates_json:[]).map((c:DataRow)=>String(c.id))))];
  const library=poiIds.length?(await query<Candidate>("SELECT id,brand_name,amap_name,province,city,address,amap_poi_id FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=ANY($2::text[])",[tenantId,poiIds])).rows.map(row=>({...row,id:Number(row.id)})):[];
  return respond(res,{rows:rows.map(r=>{const cache=saved.find(c=>Number(c.history_store_id)===Number(r.id));return {...r,id:Number(r.id),brand_store_id:r.brand_store_id==null?null:Number(r.brand_store_id),candidates:candidateMap.get(Number(r.id))||[],poi_candidates:((cache?.candidates_json||[]) as DataRow[]).map(c=>({...c,library_candidates:historyAmapLibraryCandidates(r as never,c,library)})),candidate_error:cache?.error_message||null,candidates_checked_at:cache?.checked_at||null}}),total,page:p,page_size:size});
}));

type CommitRow=HistorySourceRow&{history_store_id?:number;brand_store_id?:number;identity_key:string};
type EventInput={row_number:number;column_index:number;identity_key:string;history_store_id?:number;start_date:string;end_date:string;activity_name:string;sales_amount:string;refund_basis:string;brand_name:string;store_name:string;province:string;city:string;address:string;source_sheet:string;source_cell:string;calendar_tags:string[]};
function columnLetters(n:number){let value="";for(let x=n;x>0;x=Math.floor((x-1)/26))value=String.fromCharCode(65+(x-1)%26)+value;return value}
function mergedRows(parsed:HistoryParsed,edits:unknown):CommitRow[]{
  const editMap=new Map<number,DataRow>();for(const edit of Array.isArray(edits)?edits:[]){const row=edit as DataRow,id=positiveId(row.row_number);if(!id||editMap.has(id))throw new Error("门店行修正包含无效或重复的行号");editMap.set(id,row)}
  const occurrence=new Map<string,number>();
  return parsed.rows.map(source=>{const edit=editMap.get(source.row_number)||{},brand=str(edit.brand??source.brand),name=str(edit.name??source.name),province=str(edit.province??source.province),city=str(edit.city??source.city),address=str(edit.address??source.address),poi_id=str(edit.poi_id??source.poi_id),key=[brand,name,province,city,address,poi_id].map(normalize).join("\0"),ordinal=(occurrence.get(key)||0)+1;occurrence.set(key,ordinal);return {...source,brand,name,province,city,address,poi_id,history_store_id:positiveId(edit.history_store_id)||undefined,brand_store_id:positiveId(edit.brand_store_id)||undefined,identity_key:historyIdentity(brand,name,province,city,address+"\0"+poi_id,ordinal)}})
}
export function duplicateEventRows(events:EventInput[],rows:CommitRow[],auto:Map<string,DataRow>){
  const rowMap=new Map(rows.map(row=>[row.row_number,row])),seen=new Map<string,number>(),conflicts:DataRow[]=[];
  for(const event of events){const row=rowMap.get(event.row_number)!;const linked=row.brand_store_id||safeAutoMatch(row,auto);const identityKeys=[row.history_store_id?`history:${row.history_store_id}`:"",linked?`brand:${linked}`:"",row.poi_id?`poi:${normalize(row.poi_id)}`:"",row.address?`address:${[row.brand,row.name,row.province,row.city,row.address].map(normalize).join("|")}`:"",!linked&&!row.poi_id&&!row.address?`name:${[row.brand,row.name,row.province,row.city].map(normalize).join("|")}`:""].filter(Boolean);
    for(const key of identityKeys){const period=`${key}|${event.start_date}|${event.end_date}`,prior=seen.get(period);if(prior&&prior!==event.row_number){if(!conflicts.some(c=>c.row_number===event.row_number))conflicts.push({row_number:event.row_number,other_row_number:prior,column_index:event.column_index,reason:"同一 POI／已确认品牌门店／门店名称在同日期段重复，不能重复累计；请修正原表或门店标识"})}else seen.set(period,event.row_number)}}
  return conflicts;
}
export function duplicateSourceStoreRows(rows:CommitRow[]){
  const seen=new Map<string,number>(),issues:DataRow[]=[];
  for(const row of rows){
    const key=row.poi_id?`poi:${normalize(row.poi_id)}`:`name:${[row.brand,row.name,row.province,row.city,row.address].map(normalize).join("|")}`;
    if(!row.brand||!row.name)continue;
    const prior=seen.get(key);
    if(prior&&(!row.history_store_id||row.history_store_id!==rows.find(other=>other.row_number===prior)?.history_store_id))issues.push({row_number:row.row_number,other_row_number:prior,reason:"导入表有重复门店行；请合并原表，或为重复行明确选择同一历史门店档案"});
    else seen.set(key,row.row_number);
  }
  return issues;
}
function mergedColumns(parsed:HistoryParsed,edits:unknown,defaultYear:number){
  const editMap=new Map<number,DataRow>();for(const edit of Array.isArray(edits)?edits:[]){const row=edit as DataRow,index=positiveId(row.index);if(!index||editMap.has(index))throw new Error("日期列修正包含无效或重复的列号");editMap.set(index,row)}
  return parsed.columns.map(source=>{const edit=editMap.get(source.index)||{},yearOverride=year(edit.year)||defaultYear,range=yearOverride?dateRangeHeader(source.header,yearOverride):null,start_date=str(edit.start_date)||range?.start_date||source.start_date,end_date=str(edit.end_date)||range?.end_date||source.end_date,ignored=edit.ignore===true;if(!ignored&&(!validDate(start_date)||!validDate(end_date)||end_date<start_date))throw new Error(`第 ${source.index} 列缺少有效的活动起止日期`);if(ignored&&!Array.isArray(edits))throw new Error(`忽略第 ${source.index} 列需要明确确认`);return {...source,start_date,end_date,activity_name:str(edit.name)||source.activity_name,ignored}})
}
function eventInputs(rows:CommitRow[],columns:ReturnType<typeof mergedColumns>,sheet:string,basis:string,onIssue?:(message:string)=>void){
  const events:EventInput[]=[],seen=new Set<string>();
  for(const row of rows){for(const col of columns){const raw=row.values[String(col.index)];if(raw==null||raw==="")continue;if(col.ignored)continue;if(!row.brand||!row.name)throw new Error(`第 ${row.row_number} 行缺少品牌或门店名称`);const sale=salesAmount(raw);if(sale===null)throw new Error(`第 ${row.row_number} 行、第 ${col.index} 列的销售额无效`);const key=`${row.identity_key}\0${col.start_date}\0${col.end_date}`;if(seen.has(key)){const message=`第 ${row.row_number} 行、第 ${col.index} 列的活动日期与同店其他列重复`;if(onIssue){onIssue(message);continue}throw new Error(message)}seen.add(key);events.push({row_number:row.row_number,column_index:col.index,identity_key:row.identity_key,history_store_id:row.history_store_id,start_date:col.start_date,end_date:col.end_date,activity_name:col.activity_name,sales_amount:sale,refund_basis:basis,brand_name:row.brand,store_name:row.name,province:row.province,city:row.city,address:row.address,source_sheet:sheet,source_cell:`${columnLetters(col.index)}${row.row_number}`,calendar_tags:calendarTags(col.start_date,col.end_date)})}}
  return events;
}
async function existingConflicts(tenantId:number,events:EventInput[],rows:CommitRow[],auto:Map<string,DataRow>){if(!events.length)return [];const rowMap=new Map(rows.map(r=>[r.row_number,r]));return (await query<DataRow>(`SELECT incoming.row_number,incoming.column_index,a.id activity_id,a.sales_amount::text existing_amount,incoming.sales_amount incoming_amount,a.activity_name existing_name,a.revoked_at FROM jsonb_to_recordset($2::jsonb) AS incoming(row_number int,column_index int,identity_key text,history_store_id bigint,brand_store_id bigint,start_date date,end_date date,sales_amount text) JOIN history_stores hs ON hs.tenant_id=$1 AND (hs.id=incoming.history_store_id OR (incoming.history_store_id IS NULL AND hs.identity_key=incoming.identity_key) OR (incoming.brand_store_id IS NOT NULL AND hs.brand_store_id=incoming.brand_store_id)) JOIN history_activities a ON a.history_store_id=hs.id AND a.tenant_id=$1 AND a.start_date=incoming.start_date AND a.end_date=incoming.end_date`,[tenantId,JSON.stringify(events.map(e=>{const row=rowMap.get(e.row_number)!;return {row_number:e.row_number,column_index:e.column_index,identity_key:e.identity_key,history_store_id:e.history_store_id||null,brand_store_id:row.brand_store_id||safeAutoMatch(row,auto),start_date:e.start_date,end_date:e.end_date,sales_amount:e.sales_amount}}))] )).rows}
async function sourceCellIdentityConflicts(tenantId:number,filename:string,events:EventInput[],rows:CommitRow[],client?:PoolClient){
  if(!events.length)return [];
  const statement=`SELECT incoming.row_number,incoming.column_index,a.history_store_id,a.start_date::text prior_start_date,a.end_date::text prior_end_date,hs.identity_key,hs.brand_store_id,hs.brand_name,hs.store_name,hs.province,hs.city,hs.address,hs.poi_id
    FROM jsonb_to_recordset($2::jsonb) AS incoming(row_number int,column_index int,source_sheet text,source_cell text)
    JOIN history_activities a ON a.tenant_id=$1 AND a.source_sheet=incoming.source_sheet AND a.source_cell=incoming.source_cell AND a.revoked_at IS NULL
    JOIN history_imports i ON i.id=a.source_import_id AND i.tenant_id=$1 AND i.filename=$3
    JOIN history_stores hs ON hs.id=a.history_store_id AND hs.tenant_id=$1`;
  const args=[tenantId,JSON.stringify(events.map(({row_number,column_index,source_sheet,source_cell})=>({row_number,column_index,source_sheet,source_cell}))),filename];
  const found=client?(await client.query<DataRow>(statement,args)).rows:(await query<DataRow>(statement,args)).rows;
  return sourceCellIdentityIssues(found,events,rows);
}
export function sourceCellIdentityIssues(found:DataRow[],events:EventInput[],rows:CommitRow[]){
  const byRow=new Map(rows.map(row=>[row.row_number,row])),byCell=new Map(events.map(event=>[`${event.row_number}:${event.column_index}`,event]));
  return found.filter(prior=>{const row=byRow.get(Number(prior.row_number)),event=byCell.get(`${prior.row_number}:${prior.column_index}`);return row&&event&&(event.start_date!==prior.prior_start_date||event.end_date!==prior.prior_end_date||row.history_store_id!==Number(prior.history_store_id)&&row.identity_key!==prior.identity_key&&(!row.brand_store_id||row.brand_store_id!==Number(prior.brand_store_id)))}).map(prior=>({row_number:Number(prior.row_number),column_index:Number(prior.column_index),history_store_id:Number(prior.history_store_id),candidate_stores:[{id:Number(prior.history_store_id),brand_name:String(prior.brand_name),store_name:String(prior.store_name),province:String(prior.province),city:String(prior.city),address:String(prior.address||""),poi_id:String(prior.poi_id||"")}],reason:byCell.get(`${prior.row_number}:${prior.column_index}`)?.start_date!==prior.prior_start_date||byCell.get(`${prior.row_number}:${prior.column_index}`)?.end_date!==prior.prior_end_date?"同名导入文件的该单元格活动日期已变化；请先核对并修正原历史活动，避免重复累计":"同名导入文件的该单元格此前属于另一历史门店；请核对原表，并明确选择原历史档案以修正，避免重复累计"}));
}
async function existingHistoryCandidates(tenantId:number,rows:CommitRow[]){const keys=rows.map(r=>r.identity_key),found=(await query<DataRow>("SELECT id,identity_key,brand_name,store_name,province,city,address,poi_id,brand_store_id FROM history_stores WHERE tenant_id=$1 AND identity_key=ANY($2::text[])",[tenantId,keys])).rows;return new Map(found.map(r=>[String(r.identity_key),r]))}
router.post("/imports/preview",requireAdmin,upload.single("file"),wrap(async(req,res)=>{
  if(!req.file)return bad(res,"请选择 .xlsx 文件");if(!/\.xlsx$/i.test(req.file.originalname))return bad(res,"首版仅支持 .xlsx 文件");const y=year(req.body?.default_year);
  const locations=(await query<{province:string;city:string}>("SELECT DISTINCT province,city FROM (SELECT province,city FROM brand_stores WHERE tenant_id=$1 UNION SELECT province,city FROM brand_region_cache WHERE tenant_id=$1) available WHERE province<>'' AND city<>''",[req.user!.tenantId])).rows;let parsed:HistoryParsed;try{parsed=await parseHistoryWorkbook(req.file.buffer,y,locations)}catch(error){return bad(res,error instanceof Error&&/^(缺少|没有|表格|一次)/.test(error.message)?error.message:"文件不是可读取的 Excel 宽表")}
  const cands=await candidates(req.user!.tenantId,parsed.rows),auto=await poiAutoMatches(req.user!.tenantId,parsed.rows),commitRows=mergedRows(parsed,[]),previewRows=commitRows.filter(r=>r.brand&&r.name&&!r.issues.length),previewIssues=[...parsed.issues],events=eventInputs(previewRows,parsed.columns.filter(c=>c.start_date&&c.end_date).map(c=>({...c,ignored:false})),parsed.sheet,"unknown",message=>previewIssues.push(message)),duplicates=[...duplicateSourceStoreRows(commitRows),...duplicateEventRows(events,commitRows,auto)],poiIssues=await historicalPoiIdentity(req.user!.tenantId,commitRows),sourceIssues=await sourceCellIdentityConflicts(req.user!.tenantId,req.file.originalname,events,commitRows),conflicts=await existingConflicts(req.user!.tenantId,events,commitRows,auto),historyExisting=await existingHistoryCandidates(req.user!.tenantId,commitRows),storeIssues=[...poiIssues,...sourceIssues];
  const sha=crypto.createHash("sha256").update(req.file.buffer).digest("hex"),saved=(await query<{id:number}>("INSERT INTO history_imports(tenant_id,created_by,filename,original_file,original_sha256,parsed_json) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[req.user!.tenantId,req.user!.id,req.file.originalname,req.file.buffer,sha,JSON.stringify(parsed)])).rows[0];
  return respond(res,{import_id:Number(saved.id),columns:parsed.columns,rows:parsed.rows.map(r=>({...r,issues:[...r.issues,...duplicates.filter(x=>x.row_number===r.row_number).map(x=>String(x.reason)),...storeIssues.filter(x=>x.row_number===r.row_number).map(x=>String(x.reason))],candidates:cands.get(r.row_number)||[],auto_match_id:safeAutoMatch(r,auto),history_store_candidate:historyExisting.get(commitRows.find(x=>x.row_number===r.row_number)!.identity_key)||null,history_store_candidates:storeIssues.flatMap(issue=>issue.row_number===r.row_number?issue.candidate_stores||[]:[])})),issues:previewIssues,conflicts,store_conflicts:storeIssues,total_rows:parsed.rows.length,event_count:events.length});
}));
router.get("/imports/:id/file",requireAdmin,wrap(async(req,res)=>{const row=(await query<{filename:string;original_file:Buffer}>("SELECT filename,original_file FROM history_imports WHERE tenant_id=$1 AND id=$2",[req.user!.tenantId,positiveId(req.params.id)])).rows[0];if(!row)return bad(res,"原文件不存在",404);res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`);return res.send(row.original_file)}));

class CommitConflict extends Error {constructor(public details:DataRow){super("导入存在需要确认的冲突")}}
router.post("/imports/:id/commit",requireAdmin,wrap(async(req,res)=>{
  const tenantId=req.user!.tenantId,importId=positiveId(req.params.id);if(!importId)return bad(res,"导入编号无效");
  const client=await pool.connect();try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,$2)",[tenantId,97134]);
    const saved=(await client.query<{parsed_json:HistoryParsed;committed_at:Date|null}>("SELECT parsed_json,committed_at FROM history_imports WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,importId])).rows[0];
    if(!saved)throw new Error("导入预览不存在");if(saved.committed_at)throw new CommitConflict({already_committed:true});
    const parsed=saved.parsed_json,rows=mergedRows(parsed,req.body?.rows),cols=mergedColumns(parsed,req.body?.columns,year(req.body?.default_year)),basis=refund(req.body?.refund_basis),events=eventInputs(rows,cols,parsed.sheet,basis);
    if(!events.length)throw new Error("没有可导入的活动记录");
    const activeRowNumbers=new Set(events.map(e=>e.row_number)),activeRows=rows.filter(r=>activeRowNumbers.has(r.row_number));
    const explicitHistoryIds=[...new Set(activeRows.map(r=>r.history_store_id).filter((n):n is number=>Boolean(n)))],explicitBrandIds=[...new Set(activeRows.map(r=>r.brand_store_id).filter((n):n is number=>Boolean(n)))];
    const existingById=(await client.query<DataRow>("SELECT * FROM history_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[])",[tenantId,explicitHistoryIds])).rows;
    if(existingById.length!==explicitHistoryIds.length)throw new Error("部分历史门店不属于当前组织");
    const existingIdMap=new Map(existingById.map(r=>[Number(r.id),r]));
    const manualBrand=(await client.query<DataRow>("SELECT id,brand_name,province,city,amap_poi_id FROM brand_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[])",[tenantId,explicitBrandIds])).rows;
    if(manualBrand.length!==explicitBrandIds.length)throw new Error("部分品牌门店不属于当前组织");
    const manualBrandMap=new Map(manualBrand.map(r=>[Number(r.id),r]));
    const knownByKey=(await client.query<DataRow>("SELECT * FROM history_stores WHERE tenant_id=$1 AND identity_key=ANY($2::text[])",[tenantId,activeRows.map(r=>r.identity_key)])).rows,keyMap=new Map(knownByKey.map(r=>[String(r.identity_key),r]));
    const auto=await poiAutoMatches(tenantId,activeRows),storeConflicts:DataRow[]=[...duplicateSourceStoreRows(activeRows),...duplicateEventRows(events,activeRows,auto),...await historicalPoiIdentity(tenantId,activeRows),...await sourceCellIdentityConflicts(tenantId,(await client.query<{filename:string}>("SELECT filename FROM history_imports WHERE tenant_id=$1 AND id=$2",[tenantId,importId])).rows[0].filename,events,activeRows,client)],newStores:DataRow[]=[],links:DataRow[]=[];
    for(const row of activeRows){const existing=row.history_store_id?existingIdMap.get(row.history_store_id):keyMap.get(row.identity_key),suggested=keyMap.get(row.identity_key),manualLink=row.brand_store_id?manualBrandMap.get(row.brand_store_id):null;
      if(row.history_store_id&&existing&&identityMismatch(row,existing,"poi_id"))storeConflicts.push({row_number:row.row_number,history_store_id:existing.id,reason:"手选历史档案的 POI ID、品牌或地区与导入行冲突"});
      if(manualLink&&identityMismatch(row,manualLink,"amap_poi_id"))storeConflicts.push({row_number:row.row_number,brand_store_id:manualLink.id,reason:"手选品牌门店的 POI ID、品牌或地区与导入行冲突"});
      if(!row.history_store_id&&suggested&&!row.poi_id&&!row.address){storeConflicts.push({row_number:row.row_number,history_store_id:suggested.id,reason:"同名且无 POI ID 或地址，不能自动合并历史门店"});continue}if(existing){row.history_store_id=Number(existing.id)}else newStores.push({identity_key:row.identity_key,brand_name:row.brand,store_name:row.name,province:row.province,city:row.city,address:row.address,poi_id:row.poi_id||null,brand_store_id:row.brand_store_id||safeAutoMatch(row,auto)});const link=row.brand_store_id||(!existing?.archive_only?safeAutoMatch(row,auto):null);if(existing&&link){if(existing.brand_store_id&&Number(existing.brand_store_id)!==link){if(row.brand_store_id)storeConflicts.push({row_number:row.row_number,history_store_id:existing.id,reason:"该历史门店已有确认的品牌库关联；请先在待匹配/门店管理中显式修正关联，导入不会自动覆盖"})}else if(!existing.brand_store_id)links.push({history_store_id:Number(existing.id),brand_store_id:link})}}
    if(storeConflicts.length)throw new CommitConflict({store_conflicts:storeConflicts});
    for(const event of events){const row=activeRows.find(r=>r.row_number===event.row_number)!;event.history_store_id=row.history_store_id}
    const prepared=events.map(event=>{const row=activeRows.find(r=>r.row_number===event.row_number)!,existing=row.history_store_id?existingIdMap.get(row.history_store_id)||keyMap.get(row.identity_key):keyMap.get(row.identity_key),brand_store_id=existing?.brand_store_id||row.brand_store_id||(!existing?.archive_only?safeAutoMatch(row,auto):null);return {...event,history_store_id:row.history_store_id||null,brand_store_id,poi_id:row.poi_id||null}});
    const matchedActivities=(await client.query<DataRow>(`SELECT incoming.row_number,incoming.column_index,a.* FROM jsonb_to_recordset($2::jsonb) AS incoming(row_number int,column_index int,identity_key text,history_store_id bigint,brand_store_id bigint,start_date date,end_date date) JOIN history_stores hs ON hs.tenant_id=$1 AND (hs.id=incoming.history_store_id OR (incoming.history_store_id IS NULL AND hs.identity_key=incoming.identity_key) OR (incoming.brand_store_id IS NOT NULL AND hs.brand_store_id=incoming.brand_store_id)) JOIN history_activities a ON a.history_store_id=hs.id AND a.tenant_id=$1 AND a.start_date=incoming.start_date AND a.end_date=incoming.end_date`,[tenantId,JSON.stringify(prepared)])).rows;
    const byEvent=new Map<string,DataRow[]>();for(const item of matchedActivities){const key=`${item.row_number}:${item.column_index}`,group=byEvent.get(key)||[];group.push(item);byEvent.set(key,group)}
    const ambiguous=[...byEvent].filter(([,group])=>group.filter(item=>!item.revoked_at).length>1).map(([key])=>({row_number:Number(key.split(":")[0]),column_index:Number(key.split(":")[1]),reason:"此门店同日期段有多条有效历史活动，需先人工消重"}));
    if(ambiguous.length)throw new CommitConflict({store_conflicts:ambiguous});
    const existingActivities=[...byEvent.values()].map(group=>group.find(item=>!item.revoked_at)||group.sort((a,b)=>Number(b.id)-Number(a.id))[0]);
    const decisions=new Map<string,string>();for(const input of Array.isArray(req.body?.conflicts)?req.body.conflicts:[]){const item=input as DataRow,key=`${positiveId(item.row_number)}:${positiveId(item.column_index)}`,action=str(item.action);if(decisions.has(key)||!["update","skip"].includes(action))throw new Error("冲突处理选项无效");decisions.set(key,action)}
    const forbiddenRestore=existingActivities.filter(a=>a.revoked_at&&decisions.get(`${a.row_number}:${a.column_index}`)==="update");if(forbiddenRestore.length)throw new CommitConflict({store_conflicts:forbiddenRestore.map(a=>({row_number:a.row_number,column_index:a.column_index,reason:"该期间活动已人工撤销；导入只能跳过，重新补录须单独操作并留痕"}))});
    const unresolved=existingActivities.filter(a=>!decisions.has(`${a.row_number}:${a.column_index}`)).map(a=>({row_number:a.row_number,column_index:a.column_index,activity_id:a.id,existing_amount:a.sales_amount,revoked_at:a.revoked_at,incoming_amount:events.find(e=>e.row_number===Number(a.row_number)&&e.column_index===Number(a.column_index))?.sales_amount}));
    if(unresolved.length)throw new CommitConflict({conflicts:unresolved});
    if(links.length){const collisions=await linkCollisions(client,tenantId,links as Array<{history_store_id:number;brand_store_id:number}>);if(collisions.length)throw new CommitConflict({store_conflicts:collisions.map(item=>({...item,reason:"关联后同一品牌门店同日期有多份有效活动，请先人工消重"}))})}
    const existingMap=new Map(existingActivities.map(a=>[`${a.row_number}:${a.column_index}`,a]));
    if(newStores.length){await client.query(`INSERT INTO history_stores(tenant_id,identity_key,brand_name,store_name,province,city,address,poi_id,brand_store_id,created_by) SELECT $1,s.identity_key,s.brand_name,s.store_name,s.province,s.city,s.address,NULLIF(s.poi_id,''),s.brand_store_id,$3 FROM jsonb_to_recordset($2::jsonb) AS s(identity_key text,brand_name text,store_name text,province text,city text,address text,poi_id text,brand_store_id bigint) ON CONFLICT(tenant_id,identity_key) DO NOTHING`,[tenantId,JSON.stringify(newStores),req.user!.id])}
    const allStores=(await client.query<{id:number;identity_key:string}>("SELECT id,identity_key FROM history_stores WHERE tenant_id=$1 AND identity_key=ANY($2::text[])",[tenantId,activeRows.map(r=>r.identity_key)])).rows,allMap=new Map(allStores.map(s=>[s.identity_key,Number(s.id)]));
    for(const row of activeRows)if(!row.history_store_id)row.history_store_id=allMap.get(row.identity_key);
    if(activeRows.some(r=>!r.history_store_id))throw new Error("无法建立历史门店档案");
    if(links.length)await client.query("UPDATE history_stores hs SET brand_store_id=l.brand_store_id,archive_only=FALSE,updated_at=NOW() FROM jsonb_to_recordset($2::jsonb) AS l(history_store_id bigint,brand_store_id bigint) WHERE hs.tenant_id=$1 AND hs.id=l.history_store_id",[tenantId,JSON.stringify(links)]);
    const creates:DataRow[]=[],updates:DataRow[]=[];let skipped=0;
    for(const event of events){const row=activeRows.find(r=>r.row_number===event.row_number)!,item={...event,history_store_id:row.history_store_id,source_import_id:importId};const key=`${event.row_number}:${event.column_index}`,existing=existingMap.get(key);if(!existing)creates.push(item);else if(decisions.get(key)==="skip")skipped++;else updates.push({...item,activity_id:Number(existing.id),before_json:existing})}
    let inserted=0,updated=0;
    if(creates.length){const created=(await client.query<{id:number}>(`INSERT INTO history_activities(tenant_id,history_store_id,start_date,end_date,activity_name,sales_amount,refund_basis,brand_name,store_name,province,city,address,source_import_id,source_sheet,source_cell,calendar_tags,created_by,updated_by) SELECT $1,x.history_store_id,x.start_date,x.end_date,x.activity_name,x.sales_amount::numeric,x.refund_basis,x.brand_name,x.store_name,x.province,x.city,x.address,x.source_import_id,x.source_sheet,x.source_cell,x.calendar_tags::jsonb,$3,$3 FROM jsonb_to_recordset($2::jsonb) AS x(history_store_id bigint,start_date date,end_date date,activity_name text,sales_amount text,refund_basis text,brand_name text,store_name text,province text,city text,address text,source_import_id bigint,source_sheet text,source_cell text,calendar_tags jsonb) RETURNING id`,[tenantId,JSON.stringify(creates),req.user!.id])).rows;inserted=created.length;await client.query("INSERT INTO history_activity_revisions(tenant_id,activity_id,action,after_json,changed_by) SELECT $1,a.id,'create',to_jsonb(a),$3 FROM history_activities a WHERE a.tenant_id=$1 AND a.id=ANY($2::bigint[])",[tenantId,created.map(r=>r.id),req.user!.id])}
    if(updates.length){const changed=(await client.query<DataRow>(`UPDATE history_activities a SET activity_name=x.activity_name,sales_amount=x.sales_amount::numeric,refund_basis=x.refund_basis,brand_name=x.brand_name,store_name=x.store_name,province=x.province,city=x.city,address=x.address,source_import_id=x.source_import_id,source_sheet=x.source_sheet,source_cell=x.source_cell,calendar_tags=x.calendar_tags::jsonb,updated_by=$3,updated_at=NOW() FROM jsonb_to_recordset($2::jsonb) AS x(activity_id bigint,activity_name text,sales_amount text,refund_basis text,brand_name text,store_name text,province text,city text,address text,source_import_id bigint,source_sheet text,source_cell text,calendar_tags jsonb) WHERE a.tenant_id=$1 AND a.id=x.activity_id RETURNING a.id`,[tenantId,JSON.stringify(updates),req.user!.id])).rows;updated=changed.length;await client.query("INSERT INTO history_activity_revisions(tenant_id,activity_id,action,before_json,after_json,reason,changed_by) SELECT $1,x.activity_id,'update',x.before_json::jsonb,to_jsonb(a),'导入文件确认更新',$3 FROM jsonb_to_recordset($2::jsonb) AS x(activity_id bigint,before_json jsonb) JOIN history_activities a ON a.id=x.activity_id AND a.tenant_id=$1",[tenantId,JSON.stringify(updates),req.user!.id])}
    await client.query("UPDATE history_imports SET committed_at=NOW() WHERE tenant_id=$1 AND id=$2",[tenantId,importId]);
    await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_import','history_import',$3,$4,$5)",[tenantId,req.user!.id,String(importId),req.ip||"",{inserted,updated,skipped,store_count:activeRows.length}]);
    await client.query("COMMIT");return respond(res,{import_id:importId,inserted,updated,skipped,store_count:activeRows.length},"历史活动已导入");
  }catch(error){await client.query("ROLLBACK");if(error instanceof CommitConflict)return bad(res,error.message,409,{conflicts:[],store_conflicts:[],...error.details});throw error}finally{client.release()}
}));

router.get("/imports",requireAdmin,wrap(async(req,res)=>{const rows=(await query<DataRow>("SELECT id,filename,original_sha256,created_at,committed_at,created_by FROM history_imports WHERE tenant_id=$1 ORDER BY id DESC LIMIT 100",[req.user!.tenantId])).rows;return respond(res,rows)}));
router.post("/stores/archive",requireAdmin,wrap(async(req,res)=>{const brand=str(req.body?.brand_name),name=str(req.body?.store_name),province=str(req.body?.province),city=str(req.body?.city),address=str(req.body?.address),poiId=str(req.body?.poi_id);if(!brand||!name)return bad(res,"品牌和历史门店名称必填");const row=(await query<DataRow>("INSERT INTO history_stores(tenant_id,identity_key,brand_name,store_name,province,city,address,poi_id,archive_only,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9) RETURNING *",[req.user!.tenantId,`manual:${crypto.randomUUID()}`,brand,name,province,city,address,poiId||null,req.user!.id])).rows[0];await query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_archive_create','history_store',$3,$4,$5)",[req.user!.tenantId,req.user!.id,String(row.id),req.ip||"",{brand,name}]);return respond(res,row,"已创建仅历史门店档案",201)}));
router.post("/stores/:id/archive",requireAdmin,wrap(async(req,res)=>{const id=positiveId(req.params.id),row=(await query<DataRow>("UPDATE history_stores SET archive_only=TRUE,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND brand_store_id IS NULL RETURNING *",[req.user!.tenantId,id])).rows[0];if(!row)return bad(res,"待匹配历史门店不存在或已关联当前门店",404);await query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_archive','history_store',$3,$4,$5)",[req.user!.tenantId,req.user!.id,String(id),req.ip||"",{reason:str(req.body?.reason)}]);return respond(res,row,"已改为仅历史门店档案")}));
async function linkCollisions(client:PoolClient,tenantId:number,links:Array<{history_store_id:number;brand_store_id:number}>){return historyLinkCollisions((sql,values)=>client.query(sql,values),tenantId,links)}

router.post("/stores/bulk-link",requireAdmin,wrap(async(req,res)=>{
 const links=Array.isArray(req.body?.links)?req.body.links.map((x:DataRow)=>({history_store_id:positiveId(x.history_store_id),brand_store_id:positiveId(x.brand_store_id)})):[];
 if(!links.length||links.length>1000||links.some((x:{history_store_id:number;brand_store_id:number})=>!x.history_store_id||!x.brand_store_id)||new Set(links.map((x:{history_store_id:number})=>x.history_store_id)).size!==links.length)return bad(res,"请选择 1 至 1000 家不同的历史门店及品牌门店");
 const result=await linkHistoryStores(req.user!.tenantId,req.user!.id,links,req.ip||"",req.body?.exact_only===true?async(client)=>{try{await validateExactHistoryLinks(req.user!.tenantId,links,(sql,values)=>client.query(sql,values))}catch(error){throw new HistoryLinkError(error instanceof Error?error.message:"候选已变化，请刷新预览",409,"HISTORY_PREVIEW_STALE")}}:undefined);
 return respond(res,result,result.changed?`已确认关联 ${result.changed} 家门店`:"这些门店已关联，当前关联保持不变");
}));
router.post("/stores/:id/link",requireAdmin,wrap(async(req,res)=>{
 const id=positiveId(req.params.id),brandId=positiveId(req.body?.brand_store_id);if(!id||!brandId)return bad(res,"历史门店和品牌门店编号无效");
 return respond(res,await linkHistoryStores(req.user!.tenantId,req.user!.id,[{history_store_id:id,brand_store_id:brandId}],req.ip||""),"门店关联已确认");
}));

router.post("/stores/:id/confirm-poi",requireAdmin,wrap(async(req,res)=>{
 const id=positiveId(req.params.id),poiId=str(req.body?.poi_id).toUpperCase(),tenantId=req.user!.tenantId;if(!id||!/^B[A-Z0-9]{9}$/i.test(poiId))return bad(res,"请选择已查询到的真实高德 POI");
 const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,97134)",[tenantId]);
  const source=(await client.query("SELECT * FROM history_stores WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,id])).rows[0];if(!source)throw new Error("历史门店不存在");if(isRetiredSnackBrand(source.brand_name))throw new Error("该系统已移除，不能重新补充入库");
  const cached=(await client.query("SELECT * FROM history_poi_candidates WHERE tenant_id=$1 AND history_store_id=$2 AND source_name=$3 AND source_brand=$4 AND source_province=$5 AND source_city=$6",[tenantId,id,source.store_name,source.brand_name,source.province,source.city])).rows[0];
  const poi=(cached?.candidates_json as DataRow[]|undefined)?.find(item=>item.id===poiId);if(!poi)throw new HistoryLinkError("候选已失效，请重新查询并核对名称和地址",409,"HISTORY_CANDIDATE_STALE");
  if((source.province&&poi.province!==source.province)||(source.city&&poi.city!==source.city))throw new HistoryLinkError("候选省市与历史门店不一致，请人工核对，不能直接补充关联",409,"HISTORY_IDENTITY_MISMATCH");
  let library=(await client.query("SELECT * FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=$2 AND brand_name=$3",[tenantId,poiId,source.brand_name])).rows;
  const created=!library.length;
  if(created){if(!Array.isArray(poi.location)||poi.location.length!==2||!poi.location.every(v=>Number.isFinite(Number(v))))throw new Error("候选缺少有效坐标");if(assessBrandStore(source.brand_name,poi).decision==="排除")throw new Error("候选与该品牌的名称或业态规则冲突，不能补充为该品牌门店；历史活动仍可正常查看");
   await saveDiscoveredStores(tenantId,null,source.brand_name,source.province,source.city,[poi],false,(sql,values)=>client.query(sql,values));library=(await client.query("SELECT * FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=$2 AND brand_name=$3",[tenantId,poiId,source.brand_name])).rows;
  }
  if(library.length!==1)throw new Error("该 POI 的品牌库记录不唯一或已归属其他品牌，请选择具体品牌库候选");
  const brandId=Number(library[0].id);await applyHistoryLinks(client,tenantId,req.user!.id,[{history_store_id:id,brand_store_id:brandId}],req.ip||"");
  await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,details) VALUES($1,$2,'history_confirm_poi','history_store',$3,$4)",[tenantId,req.user!.id,String(id),JSON.stringify({poi_id:poiId,brand_store_id:brandId,created_brand_store:created})]);await client.query("COMMIT");return respond(res,{linked:1,created_brand_store:created,brand_store_id:brandId},"POI 已确认并关联，历史销售记录保留");
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}));

function activityInput(body:DataRow,store:DataRow){
  const start_date=str(body.start_date),end_date=str(body.end_date),rawAmount=body.sales_amount,sale=amount(rawAmount),brand_name=str(body.brand_name??store.brand_name),store_name=str(body.store_name??store.store_name),province=str(body.province??store.province),city=str(body.city??store.city),address=str(body.address??store.address);
  if(!validDate(start_date)||!validDate(end_date)||end_date<start_date)throw new Error("活动起止日期无效");if(rawAmount!=null&&rawAmount!==""&&sale===null)throw new Error("销售额须为非负金额，最多两位小数");if(!brand_name||!store_name)throw new Error("活动发生时的品牌和店名必填");
  return {start_date,end_date,sales_amount:sale,activity_name:str(body.activity_name)||`${start_date} 至 ${end_date}`,refund_basis:refund(body.refund_basis),brand_name,store_name,province,city,address,calendar_tags:calendarTags(start_date,end_date)};
}
async function activityGroupCollision(client:PoolClient,tenantId:number,storeId:number,start:string,end:string,excludingId:number|null=null){
  return (await client.query<DataRow>(`SELECT a.id,a.history_store_id FROM history_stores subject
    JOIN history_stores peer ON peer.tenant_id=subject.tenant_id AND (peer.id=subject.id OR (subject.brand_store_id IS NOT NULL AND peer.brand_store_id=subject.brand_store_id))
    JOIN history_activities a ON a.history_store_id=peer.id AND a.tenant_id=subject.tenant_id AND a.revoked_at IS NULL
    WHERE subject.tenant_id=$1 AND subject.id=$2 AND a.start_date=$3::date AND a.end_date=$4::date AND ($5::bigint IS NULL OR a.id<>$5) LIMIT 1`,[tenantId,storeId,start,end,excludingId])).rows[0]||null;
}
router.post("/activities",requireAdmin,wrap(async(req,res)=>{
  const storeId=positiveId(req.body?.history_store_id),store=(await query<DataRow>("SELECT * FROM history_stores WHERE tenant_id=$1 AND id=$2",[req.user!.tenantId,storeId])).rows[0];if(!store)return bad(res,"历史门店不存在",404);const input=activityInput(req.body,store),client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,$2)",[req.user!.tenantId,97134]);const collision=await activityGroupCollision(client,req.user!.tenantId,storeId,input.start_date,input.end_date);if(collision)throw new CommitConflict({store_conflicts:[{history_store_id:storeId,activity_id:collision.id,reason:"这家门店在该日期段已有有效活动"}]});const row=(await client.query<DataRow>("INSERT INTO history_activities(tenant_id,history_store_id,start_date,end_date,activity_name,sales_amount,refund_basis,brand_name,store_name,province,city,address,calendar_tags,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *",[req.user!.tenantId,storeId,input.start_date,input.end_date,input.activity_name,input.sales_amount,input.refund_basis,input.brand_name,input.store_name,input.province,input.city,input.address,JSON.stringify(input.calendar_tags),req.user!.id])).rows[0];await client.query("INSERT INTO history_activity_revisions(tenant_id,activity_id,action,after_json,reason,changed_by) VALUES($1,$2,'create',$3,$4,$5)",[req.user!.tenantId,row.id,JSON.stringify(row),str(req.body?.reason)||"人工补录",req.user!.id]);await client.query("COMMIT");return respond(res,row,"活动已补录",201)}catch(e){await client.query("ROLLBACK");if(e instanceof CommitConflict)return bad(res,e.message,409,e.details);if((e as {code?:string}).code==="23505")return bad(res,"这家门店在该日期段已有活动，请修正原记录",409);throw e}finally{client.release()}
}));
router.patch("/activities/:id",requireAdmin,wrap(async(req,res)=>{
  const id=positiveId(req.params.id),reason=str(req.body?.reason);if(!reason)return bad(res,"请填写修改原因");const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,$2)",[req.user!.tenantId,97134]);const old=(await client.query<DataRow>("SELECT a.*,hs.brand_name hs_brand,hs.store_name hs_name,hs.province hs_province,hs.city hs_city,hs.address hs_address FROM history_activities a JOIN history_stores hs ON hs.id=a.history_store_id AND hs.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.id=$2 AND a.revoked_at IS NULL FOR UPDATE OF a",[req.user!.tenantId,id])).rows[0];if(!old){await client.query("ROLLBACK");return bad(res,"活动不存在或已撤销",404)}const store={brand_name:old.brand_name,store_name:old.store_name,province:old.province,city:old.city,address:old.address},input=activityInput({...old,...req.body},store),collision=await activityGroupCollision(client,req.user!.tenantId,Number(old.history_store_id),input.start_date,input.end_date,id);if(collision)throw new CommitConflict({store_conflicts:[{history_store_id:old.history_store_id,activity_id:collision.id,reason:"该品牌门店在目标日期段已有另一场有效活动"}]});const row=(await client.query<DataRow>("UPDATE history_activities SET start_date=$3,end_date=$4,activity_name=$5,sales_amount=$6,refund_basis=$7,brand_name=$8,store_name=$9,province=$10,city=$11,address=$12,calendar_tags=$13,updated_by=$14,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *",[req.user!.tenantId,id,input.start_date,input.end_date,input.activity_name,input.sales_amount,input.refund_basis,input.brand_name,input.store_name,input.province,input.city,input.address,JSON.stringify(input.calendar_tags),req.user!.id])).rows[0];await client.query("INSERT INTO history_activity_revisions(tenant_id,activity_id,action,before_json,after_json,reason,changed_by) VALUES($1,$2,'update',$3,$4,$5,$6)",[req.user!.tenantId,id,JSON.stringify(old),JSON.stringify(row),reason,req.user!.id]);await client.query("COMMIT");return respond(res,row,"活动已修正")}catch(e){await client.query("ROLLBACK");if(e instanceof CommitConflict)return bad(res,e.message,409,e.details);if((e as {code?:string}).code==="23505")return bad(res,"该门店日期段已有另一场活动",409);throw e}finally{client.release()}
}));
router.post("/activities/:id/revoke",requireAdmin,wrap(async(req,res)=>{const id=positiveId(req.params.id),reason=str(req.body?.reason);if(!reason)return bad(res,"撤销活动须填写原因");const client=await pool.connect();try{await client.query("BEGIN");const old=(await client.query<DataRow>("SELECT * FROM history_activities WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE",[req.user!.tenantId,id])).rows[0];if(!old){await client.query("ROLLBACK");return bad(res,"活动不存在或已撤销",404)}const row=(await client.query<DataRow>("UPDATE history_activities SET revoked_at=NOW(),revoked_by=$3,revoke_reason=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *",[req.user!.tenantId,id,req.user!.id,reason])).rows[0];await client.query("INSERT INTO history_activity_revisions(tenant_id,activity_id,action,before_json,after_json,reason,changed_by) VALUES($1,$2,'revoke',$3,$4,$5,$6)",[req.user!.tenantId,id,JSON.stringify(old),JSON.stringify(row),reason,req.user!.id]);await client.query("COMMIT");return respond(res,row,"活动已撤销")}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
router.get("/activities/:id/revisions",requireHistory("view"),wrap(async(req,res)=>{const id=positiveId(req.params.id),exists=(await query<DataRow>("SELECT id FROM history_activities WHERE tenant_id=$1 AND id=$2",[req.user!.tenantId,id])).rows[0];if(!exists)return bad(res,"活动不存在",404);return respond(res,(await query<DataRow>("SELECT * FROM history_activity_revisions WHERE tenant_id=$1 AND activity_id=$2 ORDER BY changed_at DESC,id DESC",[req.user!.tenantId,id])).rows)}));

router.use((error:unknown,_req:Request,res:Response,next:NextFunction)=>{
  if(error instanceof HistoryLinkError)return bad(res,error.message,error.status,error.details,error.code);
  if(error instanceof Error&&/^(活动|缺少|导入|没有|第 |门店|日期|销售额|部分|关联|一次|表格|冲突处理)/.test(error.message))return bad(res,error.message,400);
  next(error);
});


export default router;
