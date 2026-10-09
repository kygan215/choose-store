import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { PoolClient } from "pg";
import { pool } from "../server/db.js";
import { ailingshiMigrationSql } from "../server/ailingshi-sql.js";
import { assessBrandStore } from "../shared/brand-store-policy.js";
import { brandPolicyMigrationSql } from "../server/brand-store-policy-sql.js";
const assessAilingshi=(name:unknown,id:unknown)=>assessBrandStore("爱零食",{name,id,type:"购物服务"});
import { reviewAilingshiPoi } from "../server/ailingshi-review.js";
import { saveDiscoveredStores, listBrandStores } from "../server/brand-library.js";
after(()=>pool.end());

test("爱零食历史重分类、生成列一致、POI人工名单持久化、租户隔离和审计",async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  for(const table of ["brand_stores","brand_region_cache","brand_dashboard_snapshots","stores","audit_logs"])
   await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await client.query("CREATE TEMP TABLE ailingshi_poi_overrides(tenant_id bigint,poi_id text,decision text,reason text,reviewed_by bigint,updated_at timestamptz DEFAULT NOW(),PRIMARY KEY(tenant_id,poi_id)) ON COMMIT DROP");
  const names=["爱零食","爱零食（中心店）","爱零食量贩零食(南门店)","爱零食量贩零食店(南门店)","爱零食的喵(科技大学西门店)","我爱零食","我爱零食屋","最爱零食","爱零食小屋","爱零食硬折扣超市(横州新福店)","爱零食便利店(文岭街店)","爱零食中心店","爱零食·特卖","爱零食()","爱零食(店)","爱零食(中心店)特卖","爱零食量贩零食","　爱零食（Ａ店）　","爱零食(超市店)"];
  await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,longitude,latitude)
   SELECT n,1,'爱零食','B'||n,'B'||n,name,114,30 FROM unnest($1::text[]) WITH ORDINALITY AS t(name,n)`,[names]);
  await client.query(ailingshiMigrationSql);
  await client.query(brandPolicyMigrationSql);
  await client.query("UPDATE brand_stores SET poi_type='购物服务'");
  let rows=(await client.query("SELECT * FROM brand_stores ORDER BY id")).rows;
  for(const row of rows){const expected=assessAilingshi(row.amap_name,row.amap_poi_id);assert.equal(row.normalized_name,expected.normalized_name);assert.equal(row.name_decision,expected.decision,row.amap_name);assert.equal(row.name_decision_reason,expected.decision_reason);assert.equal(row.library_visible,expected.decision==="接受")}
  const runQuery=(sql:string,values?:unknown[])=>client.query(sql,values);
  const originalCount=names.filter(name=>assessAilingshi(name,"B").decision==="接受").length;
  assert.equal((await listBrandStores(1,{},runQuery)).total,originalCount);
  const pendingCount=names.filter(name=>assessAilingshi(name,"B").decision==="待核实").length;
  const excludedCount=names.filter(name=>assessAilingshi(name,"B").decision==="排除").length;
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,pendingCount);
  assert.equal((await listBrandStores(1,{review_status:"name_excluded"},runQuery)).total,excludedCount);
  assert.equal((await listBrandStores(1,{review_status:"name_pending",brands:["糖巢"]},runQuery)).total,0);
  assert.equal((await listBrandStores(2,{},runQuery)).total,0);
  const connection={query:(sql:string,values?:unknown[])=>client.query(sql==="BEGIN"?"SAVEPOINT review":sql==="COMMIT"?"RELEASE SAVEPOINT review":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT review":sql,values),release:()=>{}} as PoolClient;
  const admin={id:1,tenantId:1,role:"admin"} as Parameters<typeof reviewAilingshiPoi>[0];
  await assert.rejects(reviewAilingshiPoi({...admin,role:"member"},{poi_id:"B12",decision:"accept",reason:"已核对"},"",async()=>connection),/管理员/);
  await assert.rejects(reviewAilingshiPoi({...admin,tenantId:2},{poi_id:"B12",decision:"accept",reason:"已核对"},"",async()=>connection),/不存在/);
  await reviewAilingshiPoi(admin,{poi_id:"B12",decision:"accept",reason:"人工确认指定POI"},"",async()=>connection);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,pendingCount-1);
  await reviewAilingshiPoi(admin,{poi_id:"B1",decision:"exclude",reason:"人工确认非目标门店"},"",async()=>connection);
  const input=[{id:"B12",name:"爱零食中心店",type:"购物服务",location:[114,30],city:"测试市"},{id:"B1",name:"爱零食",type:"购物服务",location:[114,30],city:"测试市"},{id:"B_missing_location",name:"爱零食·待查",location:null,address:"无坐标记录"}];
  // All POI IDs are stable; repeated refresh must not duplicate or override manual decisions.
  await client.query("CREATE TEMP SEQUENCE ailingshi_test_ids START 1000");
  await client.query("ALTER TABLE brand_stores ALTER COLUMN id SET DEFAULT nextval('ailingshi_test_ids')");
  await saveDiscoveredStores(1,1,"爱零食","测试省","测试市",input,false,runQuery);
  await saveDiscoveredStores(1,1,"爱零食","测试省","测试市",input,false,runQuery);
  rows=(await client.query("SELECT * FROM brand_stores WHERE amap_poi_id=ANY($1::text[])",[["B12","B1","B_missing_location"]])).rows;
  assert.equal(rows.length,3);
  assert.equal(rows.find(row=>row.amap_poi_id==="B12")?.name_decision,"接受");
  assert.equal(rows.find(row=>row.amap_poi_id==="B1")?.name_decision,"排除");
  assert.equal(rows.find(row=>row.amap_poi_id==="B_missing_location")?.longitude,null);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).rows.find(row=>row.amap_poi_id==="B_missing_location")?.location,null);
  assert.equal((await listBrandStores(1,{},runQuery)).total,originalCount);
  await reviewAilingshiPoi(admin,{poi_id:"B12",decision:"reset",reason:"撤销人工确认"},"",async()=>connection);
  assert.equal((await client.query("SELECT name_decision FROM brand_stores WHERE amap_poi_id='B12'")).rows[0].name_decision,"待核实");
  assert.equal(Number((await client.query("SELECT count(*) count FROM audit_logs WHERE action='review_brand_poi'")).rows[0].count),3);
 }finally{await client.query("ROLLBACK");client.release()}
});
