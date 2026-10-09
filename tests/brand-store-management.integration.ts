import assert from "node:assert/strict";
import test,{after} from "node:test";
import type {PoolClient} from "pg";
import {pool} from "../server/db.js";
import {manageBrandStores} from "../server/brand-store-management.js";
import {listBrandStores,saveDiscoveredStores} from "../server/brand-library.js";
import type {AuthUser} from "../server/auth.js";

after(()=>pool.end());
const admin:AuthUser={id:1,tenantId:1,email:"admin@test.local",displayName:"管理员",role:"admin"};
test("删除、跨租户保护、归档、审计、刷新防重入与恢复使用真实PostgreSQL事务",async()=>{
  const client=await pool.connect();
  const connect=async()=>({query:client.query.bind(client),release:()=>{}} as unknown as PoolClient);
  try{
    // Session-local tables shadow production tables; no public fixture rows are written.
    for(const table of ["brand_stores","brand_store_removals","brand_region_cache","audit_logs","stores","brand_dashboard_snapshots"])
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES)`);
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,district,address,longitude,latitude)
      VALUES(900001,1,'糖巢','remove-fixture-1','remove-fixture-1','糖巢御品(测试店)','福建省','三明市','三元区','测试路1号',117.6,26.2),
      (900002,1,'糖巢','remove-fixture-2','remove-fixture-2','糖巢(保留测试店)','福建省','三明市','三元区','测试路2号',117.6,26.2),
      (900003,2,'糖巢','remove-fixture-3','remove-fixture-3','糖巢(其他租户)','福建省','三明市','三元区','测试路3号',117.6,26.2)`);
    await client.query("INSERT INTO stores(id,tenant_id,created_by,brand_store_id,input_name,status) VALUES(900001,1,1,900001,'历史分析测试','已确认')");
    const runQuery=(sql:string,values?:unknown[])=>client.query(sql,values);
    assert.equal((await listBrandStores(1,{},runQuery)).total,2);
    await assert.rejects(manageBrandStores(admin,"delete",{store_ids:[900001,900003],reason:"误匹配"},"",connect),/不存在或无权/);
    assert.equal((await client.query("SELECT count(*) FROM brand_store_removals")).rows[0].count,"0");
    const result=await manageBrandStores(admin,"delete",{store_ids:[900001],reason:"人工核实为蛋糕店"},"127.0.0.1",connect);
    assert.equal(result.changed,1);
    assert.equal((await listBrandStores(1,{},runQuery)).total,1);
    assert.equal((await client.query("SELECT count(*) FROM stores WHERE brand_store_id=900001")).rows[0].count,"1","历史报告引用保留");
    const snapshot=(await client.query("SELECT * FROM brand_store_removals")).rows[0];
    assert.equal(snapshot.snapshot_json.amap_name,"糖巢御品(测试店)");assert.equal(snapshot.reason,"人工核实为蛋糕店");assert.equal(Number(snapshot.deleted_by),1);
    assert.equal((await manageBrandStores(admin,"delete",{store_ids:[900001],reason:"重复请求"},"",connect)).changed,0);
    await saveDiscoveredStores(1,151,"糖巢","福建省","三明市",[{id:"remove-fixture-1",name:"糖巢御品(新名称)",location:[117.6,26.2],address:"刷新后的地址",province:"福建省",city:"三明市"}],true,runQuery);
    assert.equal((await listBrandStores(1,{},runQuery)).total,1);
    const removed=(await client.query("SELECT * FROM brand_stores WHERE id=900001")).rows[0];
    assert.ok(removed.deleted_at);assert.equal(removed.amap_name,"糖巢御品(测试店)");assert.equal(removed.delete_reason,"人工核实为蛋糕店");
    assert.equal((await client.query("SELECT store_count FROM brand_region_cache WHERE tenant_id=1")).rows[0].store_count,0);
    assert.equal((await manageBrandStores(admin,"restore",{store_ids:[900001]},"",connect)).changed,1);
    assert.equal((await listBrandStores(1,{},runQuery)).total,2);
    const history=(await client.query("SELECT * FROM brand_store_removals")).rows[0];assert.ok(history.restored_at);assert.equal(Number(history.restored_by),1);
    // Audit failure must roll back both visibility and the new archive snapshot.
    await client.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_test_delete CHECK(action<>'delete_brand_stores') NOT VALID");
    await assert.rejects(manageBrandStores(admin,"delete",{store_ids:[900001,900002],reason:"测试原子性"},"",connect));
    assert.equal((await listBrandStores(1,{},runQuery)).total,2);
    assert.equal((await client.query("SELECT count(*) FROM brand_store_removals")).rows[0].count,"1");
    await client.query("ALTER TABLE audit_logs DROP CONSTRAINT reject_test_delete");
    assert.equal((await manageBrandStores(admin,"delete",{store_ids:[900001,900002],reason:"批量核实"},"",connect)).changed,2);
    assert.equal((await listBrandStores(1,{},runQuery)).total,0);
    assert.equal((await client.query("SELECT count(*) FROM audit_logs")).rows[0].count,"3");
  }finally{
    await client.query("ROLLBACK");
    for(const table of ["brand_stores","brand_store_removals","brand_region_cache","audit_logs","stores","brand_dashboard_snapshots"])await client.query(`DROP TABLE IF EXISTS pg_temp.${table}`);
    client.release();
  }
});
