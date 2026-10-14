import type { PoolClient } from "pg";
import type { AuthUser } from "./auth.js";
import { pool } from "./db.js";
import { BrandStoreManagementError } from "./brand-store-management.js";
import { archiveExactMissingPoiDuplicates, findExactMissingPoiDuplicate } from "./brand-store-dedupe.js";

export async function reviewAilingshiPoi(user: AuthUser, input: Record<string, unknown>, ip: string,
  connect: () => Promise<PoolClient> = () => pool.connect()) {
  if (user.role !== "admin") throw new BrandStoreManagementError("需要管理员权限", 403);
  const poiId = String(input.poi_id || "").trim(), storeId = input.store_id;
  const byRecord = !poiId && typeof storeId === "number" && Number.isSafeInteger(storeId) && storeId > 0;
  const decision = String(input.decision || ""), reason = String(input.reason || "").trim();
  if ((!poiId && !byRecord) || (poiId && storeId !== undefined) || poiId.length > 100 || !["accept", "exclude", "reset"].includes(decision) || !reason || reason.length > 500)
    throw new BrandStoreManagementError("请提供高德 POI ID 或门店记录编号、名单操作和1–500字核实依据");
  const client = await connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query(`SELECT id,amap_poi_id,ailingshi_override,name_decision FROM brand_stores
      WHERE tenant_id=$1 AND ${byRecord ? "id=$2" : "amap_poi_id=$2"} AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [user.tenantId, byRecord ? storeId : poiId])).rows;
    if (!rows.length) throw new BrandStoreManagementError("门店不存在、已删除或无权操作", 404);
    if (rows.some(row => !row.name_decision)) throw new BrandStoreManagementError("该门店尚不支持名单核验");
    if (byRecord && rows.some(row => String(row.amap_poi_id || "").trim()))
      throw new BrandStoreManagementError("门店已获得高德 POI ID，请刷新列表后重试", 409);
    if (byRecord && decision === "accept") {
      const duplicate = await findExactMissingPoiDuplicate(user.tenantId, Number(storeId), (sql, values) => client.query(sql, values));
      if (duplicate) throw new BrandStoreManagementError(duplicate.matchCount===1
        ? `这条无 ID 候选与已有高德 POI 门店记录 #${duplicate.canonicalId} 重复，请核验带 ID 的原门店`
        : "这条无 ID 候选与多个同名同坐标的高德 POI 门店重合，请逐条核对", 409);
    }
    if (byRecord) {
      if (decision === "reset") await client.query("DELETE FROM brand_store_record_overrides WHERE tenant_id=$1 AND brand_store_id=$2", [user.tenantId, storeId]);
      else await client.query(`INSERT INTO brand_store_record_overrides(tenant_id,brand_store_id,decision,reason,reviewed_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,brand_store_id) DO UPDATE SET decision=EXCLUDED.decision,reason=EXCLUDED.reason,reviewed_by=EXCLUDED.reviewed_by,updated_at=NOW()`, [user.tenantId, storeId, decision, reason, user.id]);
    } else {
      if (decision === "reset") await client.query("DELETE FROM ailingshi_poi_overrides WHERE tenant_id=$1 AND poi_id=$2", [user.tenantId, poiId]);
      else await client.query(`INSERT INTO ailingshi_poi_overrides(tenant_id,poi_id,decision,reason,reviewed_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,poi_id) DO UPDATE SET decision=EXCLUDED.decision,reason=EXCLUDED.reason,reviewed_by=EXCLUDED.reviewed_by,updated_at=NOW()`, [user.tenantId, poiId, decision, reason, user.id]);
    }
    // The trigger reapplies the POI-specific decision; generated visibility changes atomically.
    await client.query(`UPDATE brand_stores SET updated_at=NOW() WHERE tenant_id=$1 AND ${byRecord ? "id=$2" : "amap_poi_id=$2"}`, [user.tenantId, byRecord ? storeId : poiId]);
    if (!byRecord && decision === "accept")
      await archiveExactMissingPoiDuplicates(user.tenantId, null, null, (sql, values) => client.query(sql, values), [poiId]);
    const classifications = (await client.query(`SELECT id,amap_name,name_decision,name_decision_reason FROM brand_stores WHERE tenant_id=$1 AND ${byRecord ? "id=$2" : "amap_poi_id=$2"} AND deleted_at IS NULL ORDER BY id`, [user.tenantId, byRecord ? storeId : poiId])).rows;
    const counts = {accepted:classifications.filter(row=>row.name_decision==="接受").length,excluded:classifications.filter(row=>row.name_decision==="排除").length,pending:classifications.filter(row=>row.name_decision==="待核实").length};
    await client.query(`UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL) WHERE c.tenant_id=$1`, [user.tenantId]);
    await client.query("INSERT INTO brand_dashboard_snapshots(tenant_id,invalidated_at) VALUES($1,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET invalidated_at=NOW()", [user.tenantId]);
    await client.query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,'review_brand_poi',$3,$4,$5,$6)", [user.tenantId, user.id, byRecord ? "brand_store" : "amap_poi", String(byRecord ? storeId : poiId), ip, JSON.stringify({ decision, reason, scope: byRecord ? "record" : "poi", previous: rows.map(row => row.ailingshi_override),counts })]);
    await client.query("COMMIT");
    return { poi_id: poiId || null, store_id: byRecord ? storeId : null, decision, ...counts, rows: classifications };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
