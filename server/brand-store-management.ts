import type { PoolClient } from "pg";
import type { AuthUser } from "./auth.js";
import { pool, query } from "./db.js";

export class BrandStoreManagementError extends Error {
  constructor(message:string, public status:number=400){super(message)}
}
export function validateRemovalInput(user:AuthUser,ids:unknown,action:"delete"|"restore",reason:unknown){
  if(user.role!=="admin")throw new BrandStoreManagementError("需要管理员权限",403);
  if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(id=>typeof id!=="number"||!Number.isSafeInteger(id)||id<=0))
    throw new BrandStoreManagementError("请选择1–5000家有效门店");
  const text=typeof reason==="string"?reason.trim():"";
  if(action==="delete"&&(!text||text.length>500))throw new BrandStoreManagementError("请填写删除原因（1–500字）");
  return {ids:[...new Set(ids)].sort((a,b)=>a-b),reason:text};
}

// Authorize, lock, snapshot, change visibility and audit in a single transaction.
export async function manageBrandStores(user:AuthUser,action:"delete"|"restore",input:{store_ids?:unknown;reason?:unknown},ip:string,connect:()=>Promise<PoolClient>=()=>pool.connect()){
  const validated=validateRemovalInput(user,input.store_ids,action,input.reason);
  const client=await connect();
  try{
    await client.query("BEGIN");
    const rows=(await client.query("SELECT * FROM brand_stores WHERE tenant_id=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR UPDATE",[user.tenantId,validated.ids])).rows;
    if(rows.length!==validated.ids.length)throw new BrandStoreManagementError("部分门店不存在或无权操作，请刷新列表",404);
    const changed=rows.filter(row=>action==="delete"?!row.deleted_at:Boolean(row.deleted_at)).map(row=>Number(row.id));
    if(changed.length){
      if(action==="delete"){
        await client.query(`INSERT INTO brand_store_removals(tenant_id,brand_store_id,snapshot_json,reason,deleted_by)
          SELECT bs.tenant_id,bs.id,to_jsonb(bs),$3,$4 FROM brand_stores bs WHERE bs.tenant_id=$1 AND bs.id=ANY($2::bigint[])`,[user.tenantId,changed,validated.reason,user.id]);
        await client.query("UPDATE brand_stores SET deleted_at=NOW(),deleted_by=$3,delete_reason=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=ANY($2::bigint[])",[user.tenantId,changed,user.id,validated.reason]);
      }else{
        await client.query("UPDATE brand_store_removals SET restored_at=NOW(),restored_by=$3 WHERE tenant_id=$1 AND brand_store_id=ANY($2::bigint[]) AND restored_at IS NULL",[user.tenantId,changed,user.id]);
        await client.query("UPDATE brand_stores SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,updated_at=NOW() WHERE tenant_id=$1 AND id=ANY($2::bigint[])",[user.tenantId,changed]);
      }
      await client.query("INSERT INTO brand_dashboard_snapshots(tenant_id,invalidated_at) VALUES($1,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET invalidated_at=NOW()",[user.tenantId]);
      await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,$3,'brand_store',NULL,$4,$5)",[user.tenantId,user.id,`${action}_brand_stores`,ip,JSON.stringify({store_ids:changed,reason:validated.reason})]);
    }
    await client.query("COMMIT");
    return {changed:changed.length,store_ids:changed};
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}

export async function listRemovedBrandStores(user:AuthUser,pageInput:unknown,keywordInput:unknown){
  if(user.role!=="admin")throw new BrandStoreManagementError("需要管理员权限",403);
  const page=Number(pageInput||1);
  if(!Number.isSafeInteger(page)||page<1)throw new BrandStoreManagementError("页码无效");
  const keyword=typeof keywordInput==="string"?keywordInput.trim().slice(0,200):"";
  const where="bs.tenant_id=$1 AND bs.deleted_at IS NOT NULL AND ($2='' OR bs.amap_name ILIKE '%'||$2||'%' OR bs.address ILIKE '%'||$2||'%')";
  const total=Number((await query(`SELECT COUNT(*) count FROM brand_stores bs WHERE ${where}`,[user.tenantId,keyword])).rows[0].count);
  const rows=(await query(`SELECT bs.id,bs.brand_name,bs.amap_name,bs.province,bs.city,bs.district,bs.address,bs.amap_poi_id,bs.deleted_at,bs.delete_reason,u.display_name deleted_by_name
    FROM brand_stores bs LEFT JOIN users u ON u.id=bs.deleted_by AND u.tenant_id=bs.tenant_id
    WHERE ${where} ORDER BY bs.deleted_at DESC,bs.id DESC LIMIT 50 OFFSET $3`,[user.tenantId,keyword,(page-1)*50])).rows;
  return {rows:rows.map(row=>({...row,id:Number(row.id)})),total,page,pages:Math.ceil(total/50)};
}
