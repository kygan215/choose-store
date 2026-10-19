import type {PoolClient} from "pg";
import {pool} from "./db.js";

type Row=Record<string,unknown>;
export type HistoryLink={history_store_id:number;brand_store_id:number};
type RunQuery=(sql:string,values?:unknown[])=>Promise<{rows:Row[]}>;
export class HistoryLinkError extends Error{
 constructor(message:string,public status=409,public code="HISTORY_LINK_CONFLICT",public details:Row={}){super(message)}
}
export function historyLinkIdentityIssues(history:Row,target:Row){
 const issues:string[]=[];
 if(history.brand_name&&history.brand_name!==target.brand_name)issues.push("历史品牌与所选门店品牌不一致");
 if(history.province&&target.province&&history.province!==target.province)issues.push("历史省份与所选门店不一致");
 if(history.city&&target.city&&history.city!==target.city)issues.push("历史城市与所选门店不一致");
 const original=String(history.poi_id||"").trim().toUpperCase(),next=String(target.amap_poi_id||"").trim().toUpperCase();
 if(original&&original!==next)issues.push("历史档案已有不同 POI ID，请先核对原关联");
 if(history.brand_store_id&&Number(history.brand_store_id)!==Number(target.id))issues.push("该历史档案已关联其他门店，请刷新后核对，不能直接覆盖");
 return issues;
}

// Compare real POI identity as well as library record IDs. A POI may have
// duplicate library records; those must not bypass same-event protection.
export async function historyLinkCollisions(runQuery:RunQuery,tenantId:number,links:HistoryLink[]){
 if(!links.length)return [];
 return (await runQuery(`WITH incoming AS MATERIALIZED (
 SELECT x.history_store_id,x.brand_store_id,b.amap_poi_id,
 CASE WHEN btrim(COALESCE(b.amap_poi_id,''))<>'' THEN 'poi:'||upper(btrim(b.amap_poi_id)) ELSE 'record:'||b.id::text END identity
 FROM jsonb_to_recordset($2::jsonb) x(history_store_id bigint,brand_store_id bigint)
 JOIN brand_stores b ON b.id=x.brand_store_id AND b.tenant_id=$1
 ), resolved AS (
 SELECT h.id history_store_id,COALESCE(i.brand_store_id,h.brand_store_id) brand_store_id,
 COALESCE(i.identity,CASE WHEN btrim(COALESCE(b.amap_poi_id,''))<>'' THEN 'poi:'||upper(btrim(b.amap_poi_id)) ELSE 'record:'||b.id::text END) identity,
 i.history_store_id IS NOT NULL requested,h.store_name
 FROM history_stores h LEFT JOIN incoming i ON i.history_store_id=h.id
 LEFT JOIN brand_stores b ON b.id=h.brand_store_id AND b.tenant_id=h.tenant_id
 WHERE h.tenant_id=$1 AND (i.history_store_id IS NOT NULL OR h.brand_store_id IN (SELECT brand_store_id FROM incoming)
 OR (b.amap_poi_id IS NOT NULL AND upper(btrim(b.amap_poi_id)) IN (SELECT upper(btrim(amap_poi_id)) FROM incoming WHERE btrim(COALESCE(amap_poi_id,''))<>'')))
 ) SELECT MIN(r.brand_store_id) brand_store_id,r.identity,a.start_date::text,a.end_date::text,
 ARRAY_AGG(DISTINCT a.history_store_id) history_store_ids,ARRAY_AGG(DISTINCT r.store_name) store_names
 FROM resolved r JOIN history_activities a ON a.history_store_id=r.history_store_id AND a.tenant_id=$1 AND a.revoked_at IS NULL
 WHERE r.brand_store_id IS NOT NULL GROUP BY r.identity,a.start_date,a.end_date
 HAVING COUNT(DISTINCT a.history_store_id)>1 AND BOOL_OR(r.requested) LIMIT 100`,[tenantId,JSON.stringify(links)])).rows;
}

// Caller must hold the tenant advisory lock (97134) in an open transaction.
export async function applyHistoryLinks(client:PoolClient,tenantId:number,userId:number,links:HistoryLink[],ip=""){
 const sourceIds=links.map(l=>l.history_store_id),targetIds=[...new Set(links.map(l=>l.brand_store_id))];
 const histories=(await client.query("SELECT id,store_name,brand_name,province,city,poi_id,brand_store_id,archive_only FROM history_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR UPDATE",[tenantId,sourceIds])).rows;
 const targets=(await client.query("SELECT id,brand_name,amap_name,amap_poi_id,province,city FROM brand_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR SHARE",[tenantId,targetIds])).rows;
 if(histories.length!==links.length||targets.length!==targetIds.length)throw new HistoryLinkError("部分历史门店或品牌库门店不存在，或不属于当前组织",404,"HISTORY_LINK_NOT_FOUND");
 const issues:Row[]=[];
 for(const link of links){const h=histories.find(row=>Number(row.id)===link.history_store_id)!,b=targets.find(row=>Number(row.id)===link.brand_store_id)!;for(const reason of historyLinkIdentityIssues(h,b))issues.push({...link,store_name:h.store_name,target_name:b.amap_name,reason})}
 if(issues.length)throw new HistoryLinkError("关联信息不一致，请核对下方门店后重试",409,"HISTORY_IDENTITY_MISMATCH",{issues});
 const collisions=await historyLinkCollisions((sql,values)=>client.query(sql,values),tenantId,links);
 if(collisions.length)throw new HistoryLinkError("同一 POI 在相同活动日期已有多份历史记录，请先核对，系统未保存本次关联",409,"HISTORY_ACTIVITY_DUPLICATE",{store_conflicts:collisions.map(row=>({...row,reason:`${row.start_date} 至 ${row.end_date} 存在相同 POI 的多份活动：${(row.store_names as string[]).join("、")}`}))});
 const already=histories.filter(h=>!h.archive_only&&links.some(l=>l.history_store_id===Number(h.id)&&l.brand_store_id===Number(h.brand_store_id))&&String(h.poi_id||"")===String(targets.find(b=>Number(b.id)===Number(h.brand_store_id))?.amap_poi_id||""));
 const changed=links.filter(l=>!already.some(h=>Number(h.id)===l.history_store_id));
 if(changed.length){
  await client.query(`UPDATE history_stores h SET brand_store_id=x.brand_store_id,poi_id=COALESCE(NULLIF(b.amap_poi_id,''),h.poi_id),archive_only=false,updated_at=now()
  FROM jsonb_to_recordset($2::jsonb) x(history_store_id bigint,brand_store_id bigint) JOIN brand_stores b ON b.id=x.brand_store_id AND b.tenant_id=$1
  WHERE h.tenant_id=$1 AND h.id=x.history_store_id`,[tenantId,JSON.stringify(changed)]);
  await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'history_bulk_link','history_store',$3,$4,$5)",[tenantId,userId,changed.map(l=>l.history_store_id).join(","),ip,JSON.stringify({links:changed,before:histories.map(h=>({id:h.id,brand_store_id:h.brand_store_id,poi_id:h.poi_id}))})]);
 }
 const withoutPoi=links.filter(l=>!String(targets.find(b=>Number(b.id)===l.brand_store_id)?.amap_poi_id||"").trim()).length;
 return {linked:links.length,changed:changed.length,already_linked:already.length,without_poi_id:withoutPoi,history_store_ids:sourceIds};
}

export async function linkHistoryStores(tenantId:number,userId:number,links:HistoryLink[],ip="",validate?:(client:PoolClient)=>Promise<void>){
 if(!links.length||links.length>1000||links.some(l=>!Number.isSafeInteger(l.history_store_id)||l.history_store_id<=0||!Number.isSafeInteger(l.brand_store_id)||l.brand_store_id<=0)||new Set(links.map(l=>l.history_store_id)).size!==links.length)throw new HistoryLinkError("请提供 1 至 1000 家不同历史门店的有效关联",400,"HISTORY_LINK_INVALID");
 const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1,97134)",[tenantId]);await validate?.(client);const result=await applyHistoryLinks(client,tenantId,userId,links,ip);await client.query("COMMIT");return result}
 catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
