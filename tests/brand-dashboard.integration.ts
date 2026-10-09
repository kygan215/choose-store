import assert from "node:assert/strict";
import test,{after} from "node:test";
import type {PoolClient} from "pg";
import {pool} from "../server/db.js";
import {refreshBrandDashboard} from "../server/brand-dashboard.js";
import {manageBrandStores} from "../server/brand-store-management.js";

after(()=>pool.end());
test("真实数据库汇总隔离租户、待核验不计数、排除已删和无关记录，并验证每日缓存和删除失效",async()=>{
  const client=await pool.connect(),tables=["brand_stores","brand_dashboard_snapshots","brand_store_removals","audit_logs"];
  const connect=async()=>({query:client.query.bind(client),release:()=>{}} as unknown as PoolClient);
  try{
    for(const table of tables)await client.query(`CREATE TEMP TABLE ${table}(LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES)`);
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,province,longitude,latitude,deleted_at)
      VALUES(1,1,'糖巢','bd1','糖巢(一店)','湖北省',114,30,NULL),
      (2,1,'好想来','bd2','好想来(二店)','湖北省',114,30,NULL),
      (3,1,'糖巢','bd3','糖巢御品(标签待核验)','福建省',117,26,NULL),
      (4,1,'零食有鸣','bd4','零食有鸣仓库','湖北省',114,30,NULL),
      (5,1,'糖巢','bd5','糖巢(管理员已删除)','福建省',117,26,NOW()),
      (6,2,'糖巢','bd6','糖巢(其他租户)','福建省',117,26,NULL),
      (7,1,'好想来','bd7','好想来(省份待补全)','未知',114,30,NULL)`);
    await client.query("UPDATE brand_stores SET amap_poi_id=source_uid,poi_type='购物服务'");
    await client.query("UPDATE brand_stores SET amap_name='好想来(省份待补全店)' WHERE id=7");
    await client.query("UPDATE brand_stores SET amap_name='糖巢(其他租户店)' WHERE id=6");
    const initial=await refreshBrandDashboard(1,false,connect);
    assert.equal(initial.total,3);assert.equal(initial.unknownProvinceCount,1);assert.equal(initial.matrix.find(row=>row.province==="福建省")?.total,0);
    assert.equal((await refreshBrandDashboard(2,false,connect)).total,1);
    await client.query("INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,province,longitude,latitude) VALUES(8,1,'零食有鸣','bd8','零食有鸣(新门店)','甘肃省',104,36)");
    await client.query("UPDATE brand_stores SET amap_poi_id=source_uid,poi_type='购物服务' WHERE id=8");
    const cached=await refreshBrandDashboard(1,false,connect);assert.equal(cached.total,3);assert.equal(cached.generatedAt,initial.generatedAt);
    const forced=await refreshBrandDashboard(1,true,connect);assert.equal(forced.total,4);
    await manageBrandStores({id:1,tenantId:1,role:"admin",email:"test@test.local",displayName:"测试"},"delete",{store_ids:[1],reason:"管理员删除测试"},"",connect);
    assert.equal((await refreshBrandDashboard(1,false,connect )).total,3,"删除后缓存自动失效");
    await manageBrandStores({id:1,tenantId:1,role:"admin",email:"test@test.local",displayName:"测试"},"restore",{store_ids:[1]},"",connect);
    assert.equal((await refreshBrandDashboard(1,false,connect )).total,4,"恢复后重新计入");
    await client.query("UPDATE brand_stores SET deleted_at=NOW() WHERE id=8");
    await client.query("UPDATE brand_dashboard_snapshots SET refresh_after=NOW()-INTERVAL '1 second' WHERE tenant_id=1");
    assert.equal((await refreshBrandDashboard(1,false,connect)).total,3,"超过每日更新时间自动重新汇总");
    await client.query("ALTER TABLE brand_dashboard_snapshots ADD CONSTRAINT fail_refresh CHECK (data_json IS NULL) NOT VALID");
    await assert.rejects(refreshBrandDashboard(1,true,connect));
    assert.equal((await client.query("SELECT data_json->>'total' total FROM brand_dashboard_snapshots WHERE tenant_id=1")).rows[0].total,"3","刷新失败保留上次快照");
  }finally{await client.query("ROLLBACK");for(const table of tables)await client.query(`DROP TABLE IF EXISTS pg_temp.${table}`);client.release()}
});
