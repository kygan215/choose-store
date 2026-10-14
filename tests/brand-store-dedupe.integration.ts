import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import type { PoolClient } from "pg";
import { pool } from "../server/db.js";
import { saveDiscoveredStores } from "../server/brand-library.js";
import { archiveExactMissingPoiDuplicates, findExactMissingPoiDuplicate, findExactMissingPoiDuplicates } from "../server/brand-store-dedupe.js";

after(() => pool.end());

async function withTempTables(run: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of ["brand_stores", "brand_store_removals", "brand_dashboard_snapshots", "brand_region_cache", "audit_logs", "brand_store_record_overrides", "ailingshi_poi_overrides"])
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES)`);
    await client.query("CREATE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores FOR EACH ROW EXECUTE FUNCTION public.apply_ailingshi_override()");
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test("同名同坐标的无 ID 建议被归档；刷新不能重新加入且不误并近邻", async () => {
  await withTempTables(async client => {
    const runQuery = (sql: string, values?: unknown[]) => client.query(sql, values);
    const nameless = { name: "湖北省武汉市洪山区糖巢(中心店)", address: "糖巢(中心店)", location: [114.2, 30.4], province: "湖北省", city: "武汉市" };
    const actual = { id: "B0TESTDEDUP", name: "糖巢(中心店)", address: "中心路1号", location: [114.2, 30.4], province: "湖北省", city: "武汉市", type: "购物服务;专卖店;专营店", tag: "零食" };
    await saveDiscoveredStores(1, null, "糖巢", "湖北省", "武汉市", [nameless, actual], false, runQuery);
    let rows = (await client.query("SELECT source_uid,amap_poi_id,deleted_at,delete_reason FROM brand_stores ORDER BY id")).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.deleted_at).length, 1);
    assert.ok(rows.find(row => row.deleted_at)?.source_uid.startsWith("brand-missing:"));
    assert.equal(rows.find(row => !row.deleted_at)?.amap_poi_id, "B0TESTDEDUP");
    assert.match(rows.find(row => row.deleted_at)?.delete_reason || "", /自动归并/);
    assert.equal((await client.query("SELECT count(*) FROM brand_store_removals")).rows[0].count, "1");
    assert.equal((await client.query("SELECT count(*) FROM audit_logs WHERE action='archive_duplicate_missing_poi_brand_store'")).rows[0].count, "1");
    assert.equal((await client.query("SELECT count(*) FROM brand_dashboard_snapshots WHERE invalidated_at IS NOT NULL")).rows[0].count, "1");
    await saveDiscoveredStores(1, null, "糖巢", "湖北省", "武汉市", [nameless, actual], false, runQuery);
    assert.equal((await client.query("SELECT count(*) FROM brand_stores WHERE deleted_at IS NULL")).rows[0].count, "1");
    assert.equal((await client.query("SELECT count(*) FROM brand_store_removals")).rows[0].count, "1");
    await saveDiscoveredStores(1, null, "糖巢", "湖北省", "武汉市", [{ ...nameless, location: [114.200001, 30.4] }], false, runQuery);
    rows = (await client.query("SELECT source_uid,deleted_at FROM brand_stores ORDER BY id")).rows;
    assert.equal(rows.filter(row => !row.deleted_at).length, 2, "相距很近但坐标不同的候选不应自动归并");
  });
});

test("多重 POI 匹配及已人工核验记录不会自动归并", async () => {
  await withTempTables(async client => {
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude)
      VALUES (92001,1,'糖巢','ambiguous-missing','','湖北省武汉市糖巢(多店)','湖北省','武汉市','糖巢(多店)',114.1,30.1),
        (92002,1,'糖巢','real-one','B0ONE','糖巢(多店)','湖北省','武汉市','测试路',114.1,30.1),
        (92003,1,'糖巢','real-two','B0TWO','糖巢(多店)','湖北省','武汉市','测试路',114.1,30.1),
        (92004,1,'糖巢','reviewed-missing','','湖北省武汉市糖巢(人工店)','湖北省','武汉市','糖巢(人工店)',114.2,30.2),
        (92005,1,'糖巢','reviewed-real','B0THREE','糖巢(人工店)','湖北省','武汉市','测试路',114.2,30.2)`);
    await client.query("INSERT INTO brand_store_record_overrides(tenant_id,brand_store_id,decision,reason,reviewed_by) VALUES(1,92004,'accept','人工确认',1)");
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE id=92004");
    assert.deepEqual(await findExactMissingPoiDuplicate(1, 92001, (sql, values) => client.query(sql, values)), { canonicalId: 92002, poiId: "B0ONE", matchCount: 2 });
    assert.deepEqual(await findExactMissingPoiDuplicate(1, 92004, (sql, values) => client.query(sql, values)), { canonicalId: 92005, poiId: "B0THREE", matchCount: 1 });
    assert.deepEqual(await findExactMissingPoiDuplicates(1, [92001,92004,99999], (sql, values) => client.query(sql, values)), [
      { storeId: 92001, canonicalId: 92002, poiId: "B0ONE", matchCount: 2 },
      { storeId: 92004, canonicalId: 92005, poiId: "B0THREE", matchCount: 1 },
    ]);
    assert.equal(await archiveExactMissingPoiDuplicates(1, "糖巢", "武汉市", (sql, values) => client.query(sql, values)), 0);
    assert.equal((await client.query("SELECT count(*) FROM brand_stores WHERE deleted_at IS NULL")).rows[0].count, "5");
  });
});

test("已人工纳入的无 ID 门店仅在正式 POI 也接受时归并，不扩大人工名单", async () => {
  await withTempTables(async client => {
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude,poi_type,raw_json)
      VALUES (94001,1,'糖巢','accepted-missing','','湖北省武汉市糖巢(接受店)','湖北省','武汉市','糖巢(接受店)',114.4,30.4,'','{}'),
        (94002,1,'糖巢','accepted-real','B0ACCEPT','糖巢(接受店)','湖北省','武汉市','测试路',114.4,30.4,'购物服务;专卖店;专营店','{"tag":"零食"}')`);
    await client.query("INSERT INTO brand_store_record_overrides(tenant_id,brand_store_id,decision,reason,reviewed_by) VALUES(1,94001,'accept','管理员已核实原记录',1)");
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE id=94001");
    const before = (await client.query("SELECT id,name_decision FROM brand_stores WHERE id IN(94001,94002) ORDER BY id")).rows;
    assert.deepEqual(before.map(row => row.name_decision), ["接受", "接受"]);
    await client.query("INSERT INTO brand_region_cache(tenant_id,brand_name,province,city,store_count) VALUES(1,'糖巢','湖北省','武汉市',2)");
    assert.equal(await archiveExactMissingPoiDuplicates(1, "糖巢", "武汉市", (sql, values) => client.query(sql, values)), 1);
    assert.equal((await client.query("SELECT count(*) FROM brand_stores WHERE id=94001 AND deleted_at IS NOT NULL")).rows[0].count, "1");
    assert.equal((await client.query("SELECT name_decision FROM brand_stores WHERE id=94002")).rows[0].name_decision, "接受");
    assert.equal((await client.query("SELECT count(*) FROM ailingshi_poi_overrides")).rows[0].count, "0", "记录核验不得扩散成 POI 白名单");
    assert.equal((await client.query("SELECT count(*) FROM brand_store_record_overrides WHERE brand_store_id=94001")).rows[0].count, "1", "原核验依据留作归档证据");
    assert.equal((await client.query("SELECT store_count FROM brand_region_cache WHERE brand_name='糖巢'")).rows[0].store_count, 1);

    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude,poi_type)
      VALUES (94011,1,'糖巢','pending-missing','','湖北省武汉市糖巢(待核店)','湖北省','武汉市','糖巢(待核店)',114.5,30.5,''),
        (94012,1,'糖巢','pending-real','B0PENDING','糖巢(待核店)','湖北省','武汉市','测试路',114.5,30.5,''),
        (94021,1,'糖巢','excluded-missing','','湖北省武汉市糖巢(排除店)','湖北省','武汉市','糖巢(排除店)',114.6,30.6,''),
        (94022,1,'糖巢','excluded-real','B0EXCLUDE','糖巢(排除店)','湖北省','武汉市','测试路',114.6,30.6,'购物服务;专卖店;专营店')`);
    await client.query("INSERT INTO brand_store_record_overrides(tenant_id,brand_store_id,decision,reason,reviewed_by) VALUES(1,94011,'accept','人工确认',1),(1,94021,'accept','人工确认',1)");
    await client.query("INSERT INTO ailingshi_poi_overrides(tenant_id,poi_id,decision,reason,reviewed_by) VALUES(1,'B0EXCLUDE','exclude','人工确认排除',1)");
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE id IN(94011,94021,94022)");
    assert.deepEqual((await client.query("SELECT name_decision FROM brand_stores WHERE id IN(94011,94012,94021,94022) ORDER BY id")).rows.map(row => row.name_decision), ["接受", "待核实", "接受", "排除"]);
    assert.equal(await archiveExactMissingPoiDuplicates(1, "糖巢", "武汉市", (sql, values) => client.query(sql, values)), 0);
    assert.equal((await client.query("SELECT count(*) FROM brand_stores WHERE id IN(94011,94021) AND deleted_at IS NULL AND name_decision='接受'")).rows[0].count, "2", "正式 POI 待核或排除时保留人工接受的原记录");
  });
});

test("031 迁移归档旧数据可重复执行", async () => {
  await withTempTables(async client => {
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude,poi_type,raw_json)
      VALUES (93001,1,'糖巢','legacy-missing','','湖北省武汉市糖巢(老店)','湖北省','武汉市','糖巢(老店)',114.3,30.3,'','{}'),
        (93002,1,'糖巢','legacy-real','B0LEGACY','糖巢(老店)','湖北省','武汉市','测试路',114.3,30.3,'','{}'),
        (93011,1,'糖巢','legacy-accepted-missing','','湖北省武汉市糖巢(已核店)','湖北省','武汉市','糖巢(已核店)',114.31,30.31,'','{}'),
        (93012,1,'糖巢','legacy-accepted-real','B0LEGACYACCEPT','糖巢(已核店)','湖北省','武汉市','测试路',114.31,30.31,'购物服务;专卖店;专营店','{"tag":"零食"}'),
        (93021,1,'糖巢','legacy-pending-missing','','湖北省武汉市糖巢(保留店)','湖北省','武汉市','糖巢(保留店)',114.32,30.32,'','{}'),
        (93022,1,'糖巢','legacy-pending-real','B0LEGACYPENDING','糖巢(保留店)','湖北省','武汉市','测试路',114.32,30.32,'','{}')`);
    await client.query("INSERT INTO brand_store_record_overrides(tenant_id,brand_store_id,decision,reason,reviewed_by) VALUES(1,93011,'accept','人工确认',1),(1,93021,'accept','人工确认',1)");
    await client.query("UPDATE brand_stores SET updated_at=NOW() WHERE id IN(93011,93021)");
    assert.deepEqual(await findExactMissingPoiDuplicate(1, 93001, (sql, values) => client.query(sql, values)), { canonicalId: 93002, poiId: "B0LEGACY", matchCount: 1 });
    const migration = await readFile(new URL("../server/migrations/031_archive_exact_missing_poi_duplicates.sql", import.meta.url), "utf8");
    const first = await client.query(migration);
    assert.equal((Array.isArray(first) ? first.at(-1) : first)?.rows[0].archived, 2);
    assert.equal(await findExactMissingPoiDuplicate(1, 93001, (sql, values) => client.query(sql, values)), null);
    const second = await client.query(migration);
    assert.equal((Array.isArray(second) ? second.at(-1) : second)?.rows[0].archived, 0);
    assert.equal((await client.query("SELECT count(*) FROM brand_store_removals")).rows[0].count, "2");
    assert.equal((await client.query("SELECT count(*) FROM brand_stores WHERE id=93021 AND deleted_at IS NULL")).rows[0].count, "1");
  });
});
