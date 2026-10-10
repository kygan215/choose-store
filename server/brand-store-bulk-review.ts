import type {PoolClient} from "pg";
import type {AuthUser} from "./auth.js";
import {pool} from "./db.js";
import {BrandStoreManagementError,validateRemovalInput} from "./brand-store-management.js";

export function validateBulkReview(user:AuthUser,input:Record<string,unknown>){
  const validated=validateRemovalInput(user,input.store_ids,"restore",input.reason);
  if(!validated.reason||validated.reason.length>500)throw new BrandStoreManagementError("请填写核实依据（1–500字）");
  if(input.decision!=="accept"&&input.decision!=="exclude")throw new BrandStoreManagementError("请选择批量纳入或批量排除");
  return {...validated,decision:input.decision};
}

export async function bulkReviewBrandStores(user:AuthUser,input:Record<string,unknown>,ip:string,connect:()=>Promise<PoolClient>=()=>pool.connect()){
  const {ids,reason,decision}=validateBulkReview(user,input),client=await connect();
  try{
    await client.query("BEGIN");
    const selected=(await client.query("SELECT id,amap_poi_id,name_decision FROM brand_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[]) AND deleted_at IS NULL",[user.tenantId,ids])).rows;
    if(selected.length!==ids.length)throw new BrandStoreManagementError("部分门店不存在、已删除或无权操作，请刷新列表",404);
    if(selected.some(r=>!String(r.amap_poi_id||"").trim()||!r.name_decision))throw new BrandStoreManagementError("部分门店缺少 POI ID 或尚不支持名单核验，请取消勾选后重试");
    const poiIds=[...new Set(selected.map(r=>String(r.amap_poi_id)))].sort();
    // Lock all rows sharing these POI IDs in a stable order, as single review does.
    const locked=(await client.query("SELECT id,amap_poi_id,name_decision,ailingshi_override,deleted_at FROM brand_stores WHERE tenant_id=$1 AND amap_poi_id=ANY($2::text[]) ORDER BY id FOR UPDATE",[user.tenantId,poiIds])).rows;
    const activeIds=new Set(locked.filter(r=>!r.deleted_at&&r.name_decision).map(r=>Number(r.id)));
    if(ids.some(id=>!activeIds.has(id)))throw new BrandStoreManagementError("所选门店已发生变化，请刷新列表后重试",409);
    await client.query(`INSERT INTO ailingshi_poi_overrides(tenant_id,poi_id,decision,reason,reviewed_by)
      SELECT $1,poi_id,$3,$4,$5 FROM unnest($2::text[]) AS p(poi_id)
      ON CONFLICT(tenant_id,poi_id) DO UPDATE SET decision=EXCLUDED.decision,reason=EXCLUDED.reason,reviewed_by=EXCLUDED.reviewed_by,updated_at=NOW()`,[user.tenantId,poiIds,decision,reason,user.id]);
    // Existing trigger and classification rules remain the single source of truth.
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE tenant_id=$1 AND amap_poi_id=ANY($2::text[])",[user.tenantId,poiIds]);
    await client.query(`UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL) WHERE c.tenant_id=$1`,[user.tenantId]);
    await client.query("INSERT INTO brand_dashboard_snapshots(tenant_id,invalidated_at) VALUES($1,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET invalidated_at=NOW()",[user.tenantId]);
    const counts=(await client.query(`SELECT count(*) FILTER(WHERE name_decision='接受')::int accepted,count(*) FILTER(WHERE name_decision='排除')::int excluded,count(*) FILTER(WHERE name_decision='待核实')::int pending FROM brand_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[])`,[user.tenantId,ids])).rows[0];
    await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'bulk_review_brand_pois','brand_store','batch',$3,$4)",[user.tenantId,user.id,ip,JSON.stringify({decision,reason,store_ids:ids,poi_ids:poiIds,previous:locked.map(r=>({id:r.id,override:r.ailingshi_override})),counts})]);
    await client.query("COMMIT");
    return {selected:ids.length,poi_count:poiIds.length,affected:locked.filter(r=>!r.deleted_at).length,...counts};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
