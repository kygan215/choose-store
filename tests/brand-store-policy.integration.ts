import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import { pool } from "../server/db.js";
import { assessBrandStore, BRAND_IDENTITIES } from "../shared/brand-store-policy.js";
import { brandPolicyMigrationSql } from "../server/brand-store-policy-sql.js";
import { listBrandStores, saveDiscoveredStores, storeFilterSql } from "../server/brand-library.js";
import { reviewAilingshiPoi } from "../server/ailingshi-review.js";
after(()=>pool.end());

test("统一品牌规则：SQL与应用一致、候选保存、人工名单、默认统计、分页、租户隔离",async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  for(const t of ["brand_stores","brand_region_cache","brand_dashboard_snapshots","stores","audit_logs","ailingshi_poi_overrides"])
   await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await client.query(brandPolicyMigrationSql);
  await client.query("CREATE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores FOR EACH ROW EXECUTE FUNCTION apply_ailingshi_override()");
  let id=0;
  const fixtures=[];
  for(const brand of Object.keys(BRAND_IDENTITIES))for(const name of [brand,`${brand}超市（中心店）`,`${brand}便利店(公寓店)`,`${brand}量贩零食(饭店路店)`,`${brand}·特卖`,`${brand}蛋糕店`])
   for(const evidence of [{type:"购物服务",typecode:"060000"},{type:"餐饮服务;糕饼店",typecode:"050800"},{business:{keytag:"零食"}},{},{type:"购物服务",business:{tag:"蛋糕店"}},{typecode:"061200|050100"}]){
    const row={brand,name,id:`RULE-${++id}`,address:"测试地址",...evidence};fixtures.push(row);
   }
  for(const row of fixtures){
   const expected=assessBrandStore(row.brand,row);
   const result=(await client.query("SELECT brand_policy_decision($1,$2,$3,'',$4,$5,$6) decision,brand_policy_reason($1,$2,$3,'',$4,$5,$6) reason",[row.brand,row.name,row.id,row.type||"",row.typecode||"",JSON.stringify(row)])).rows[0];
   assert.equal(result.decision,expected.decision,JSON.stringify(row));assert.equal(result.reason,expected.decision_reason);
  }
  const runQuery=(sql:string,values?:unknown[])=>client.query(sql,values);
  await client.query("CREATE TEMP SEQUENCE policy_ids START 1");
  await client.query("ALTER TABLE brand_stores ALTER COLUMN id SET DEFAULT nextval('policy_ids')");
  for(const brand of Object.keys(BRAND_IDENTITIES))await saveDiscoveredStores(1,null,brand,"测试省","测试市",fixtures.filter(r=>r.brand===brand).map(r=>({...r,location:[114,30]})),false,runQuery);
  const count=fixtures.filter(row=>assessBrandStore(row.brand,row).decision==="接受").length;
  assert.equal((await listBrandStores(1,{},runQuery)).total,count);
  assert.equal((await listBrandStores(1,{review_status:"pending"},runQuery)).total,fixtures.filter(r=>assessBrandStore(r.brand,r).decision==="待核实").length);
  assert.equal((await listBrandStores(1,{review_status:"name_excluded"},runQuery)).total,fixtures.filter(r=>assessBrandStore(r.brand,r).decision==="排除").length);
  assert.equal((await listBrandStores(2,{},runQuery)).total,0);
  const connection={query:(sql:string,v?:unknown[])=>client.query(sql==="BEGIN"?"SAVEPOINT review":sql==="COMMIT"?"RELEASE SAVEPOINT review":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT review":sql,v),release:()=>{}} as PoolClient;
  const admin={id:1,tenantId:1,role:"admin"} as Parameters<typeof reviewAilingshiPoi>[0];
  const pending=fixtures.find(r=>r.brand==="糖巢"&&r.name.includes("·")&&r.type==="购物服务"&&!r.business)!;
  await assert.rejects(reviewAilingshiPoi({...admin,role:"member"},{poi_id:pending.id,decision:"accept",reason:"人工核对"},"",async()=>connection),/管理员/);
  await assert.rejects(reviewAilingshiPoi({...admin,tenantId:2},{poi_id:pending.id,decision:"accept",reason:"人工核对"},"",async()=>connection),/不存在/);
  await reviewAilingshiPoi(admin,{poi_id:pending.id,decision:"accept",reason:"人工核对"},"",async()=>connection);
  assert.equal((await listBrandStores(1,{},runQuery)).total,count+1);
  await saveDiscoveredStores(1,null,"糖巢","测试省","测试市",[{...pending,location:[114,30]}],false,runQuery);
  assert.equal((await listBrandStores(1,{},runQuery)).total,count+1,"重新检索保持白名单且不重复");
  await reviewAilingshiPoi(admin,{poi_id:pending.id,decision:"reset",reason:"恢复自动规则"},"",async()=>connection);
  assert.equal((await listBrandStores(1,{},runQuery)).total,count);
  await reviewAilingshiPoi(admin,{poi_id:pending.id,decision:"exclude",reason:"人工排除"},"",async()=>connection);
  assert.equal((await client.query("SELECT name_decision FROM brand_stores WHERE amap_poi_id=$1",[pending.id])).rows[0].name_decision,"排除");
  const noTags=fixtures.find(r=>r.brand==="爱零食"&&r.name==="爱零食"&&!r.type&&!r.typecode&&!r.business)!;
  await reviewAilingshiPoi(admin,{poi_id:noTags.id,decision:"accept",reason:"仅确认品牌"},"",async()=>connection);
  assert.equal((await client.query("SELECT name_decision FROM brand_stores WHERE amap_poi_id=$1",[noTags.id])).rows[0].name_decision,"待核实","白名单不能绕过标签证据");
  assert.equal(Number((await client.query("SELECT count(*) n FROM audit_logs WHERE action='review_brand_poi'")).rows[0].n),4);
  await client.query("INSERT INTO brand_stores(tenant_id,brand_name,source_uid,amap_poi_id,amap_name,poi_type,longitude,latitude) SELECT 3,'糖巢','PERF-'||n,'PERF-'||n,'糖巢('||n||'店)',CASE WHEN n%10=0 THEN '' ELSE '购物服务' END,114,30 FROM generate_series(1,60000) n");
  await client.query("ANALYZE brand_stores");
  for(const filter of [{page:1},{page:58},{page:1000},{page:1,review_status:"pending"},{page:58,review_status:"pending"}]){
   const start=performance.now(),result=await listBrandStores(3,filter,runQuery),ms=Math.round(performance.now()-start);
   assert.equal(result.total,filter.review_status?6000:54000);assert.equal(result.rows.length,50);assert.ok(ms<500,`查询${ms}ms`);
   const built=storeFilterSql(3,filter),ids=(await client.query(`SELECT id FROM brand_stores bs WHERE ${built.where}`,built.values)).rows;
   assert.equal(ids.length,result.total);console.log(JSON.stringify({filter,total:result.total,ms}));
  }
  console.log(`SQL/JS parity: ${fixtures.length} evidence combinations`);
 }finally{await client.query("ROLLBACK");client.release()}
});
