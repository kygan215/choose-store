import type { PoolClient } from "pg";
import type { AuthUser } from "./auth.js";
import { pool } from "./db.js";
import { BrandStoreManagementError } from "./brand-store-management.js";

export async function reviewAilingshiPoi(user: AuthUser, input: Record<string, unknown>, ip: string,
  connect: () => Promise<PoolClient> = () => pool.connect()) {
  if (user.role !== "admin") throw new BrandStoreManagementError("需要管理员权限", 403);
  const poiId = String(input.poi_id || "").trim(), decision = String(input.decision || ""), reason = String(input.reason || "").trim();
  if (!poiId || poiId.length > 100 || !["accept", "exclude", "reset"].includes(decision) || !reason || reason.length > 500)
    throw new BrandStoreManagementError("请提供 POI ID、名单操作和1–500字核实依据");
  const client = await connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query(`SELECT id,ailingshi_override FROM brand_stores
      WHERE tenant_id=$1 AND amap_poi_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [user.tenantId, poiId])).rows;
    if (!rows.length) throw new BrandStoreManagementError("门店不存在、已删除或无权操作", 404);
    if (decision === "reset") await client.query("DELETE FROM ailingshi_poi_overrides WHERE tenant_id=$1 AND poi_id=$2", [user.tenantId, poiId]);
    else await client.query(`INSERT INTO ailingshi_poi_overrides(tenant_id,poi_id,decision,reason,reviewed_by) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,poi_id) DO UPDATE SET decision=EXCLUDED.decision,reason=EXCLUDED.reason,reviewed_by=EXCLUDED.reviewed_by,updated_at=NOW()`, [user.tenantId, poiId, decision, reason, user.id]);
    // The trigger reapplies the POI-specific decision; generated visibility changes atomically.
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE tenant_id=$1 AND amap_poi_id=$2", [user.tenantId, poiId]);
    await client.query(`UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL) WHERE c.tenant_id=$1`, [user.tenantId]);
    await client.query("INSERT INTO brand_dashboard_snapshots(tenant_id,invalidated_at) VALUES($1,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET invalidated_at=NOW()", [user.tenantId]);
    await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'review_brand_poi','amap_poi',$3,$4,$5)", [user.tenantId, user.id, poiId, ip, JSON.stringify({ decision, reason, previous: rows.map(row => row.ailingshi_override) })]);
    await client.query("COMMIT");
    return { poi_id: poiId, decision };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
