import assert from "node:assert/strict";
import test,{after} from "node:test";
import type {PoolClient} from "pg";
import type {AuthUser} from "../server/auth.js";
import {pool} from "../server/db.js";
import {reviewAilingshiPoi} from "../server/ailingshi-review.js";
import {bulkReviewBrandStores} from "../server/brand-store-bulk-review.js";
import {brandPolicyFunctionsSql} from "../server/brand-store-policy-sql.js";
import {brandStoreRecordReviewSql} from "../server/brand-store-record-review-sql.js";
import {listBrandStores,saveDiscoveredStores} from "../server/brand-library.js";
const admin:AuthUser={id:1,tenantId:1,email:"review@test.local",displayName:"核验管理员",role:"admin"};
after(()=>pool.end());

for(const mode of ["single","bulk"] as const)test(`${mode}：人工纳入服装误分类的标准好想来门店后，必须从待核验移到已接受`,async()=>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  for(const table of ["brand_stores","ailingshi_poi_overrides","brand_store_record_overrides","brand_region_cache","brand_dashboard_snapshots","audit_logs","stores"])await c.query(`CREATE TEMP TABLE ${table}(LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await c.query(brandPolicyFunctionsSql);
  await c.query(brandStoreRecordReviewSql);
  const raw={id:"MANUAL-REAL-CASE",name:"好想来零食乐园(临沂河东区八湖镇一店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",typecode:"061100",tag:"好想来;零食",business:{rectag:"好想来",keytag:"零食"},location:[114,30]};
  await c.query("INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,poi_type,typecode,raw_json,longitude,latitude) VALUES(1,1,'好想来',$1,$1,$2,$3,$4,$5,114,30)",[raw.id,raw.name,raw.type,raw.typecode,JSON.stringify(raw)]);
  const runQuery=(sql:string,values?:unknown[])=>c.query(sql,values);
  const connect=async()=>({query:(sql:string,values?:unknown[])=>c.query(sql==="BEGIN"?"SAVEPOINT manual_review":sql==="COMMIT"?"RELEASE SAVEPOINT manual_review":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT manual_review":sql,values),release:()=>{}} as PoolClient);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,1);
  const reviewed=mode==="single"?await reviewAilingshiPoi(admin,{poi_id:raw.id,decision:"accept",reason:"人工核实为正常目标品牌门店，高德分类不准确"},"",connect):await bulkReviewBrandStores(admin,{store_ids:[1],decision:"accept",reason:"人工核实为正常目标品牌门店，高德分类不准确"},"",connect);
  assert.equal(reviewed.accepted,1);assert.equal(reviewed.pending,0);
  assert.equal((await c.query("SELECT decision FROM ailingshi_poi_overrides WHERE poi_id=$1",[raw.id])).rows[0].decision,"accept");
  const accepted=(await c.query("SELECT name_decision,library_visible FROM brand_stores WHERE id=1")).rows[0];
  assert.equal(accepted.name_decision,"接受","人工纳入已保存，但自动标签规则仍将其留在待核验");assert.equal(accepted.library_visible,true);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,0);
  assert.equal((await listBrandStores(1,{},runQuery)).total,1);
  await saveDiscoveredStores(1,null,"好想来","测试省","测试市",[raw],false,runQuery);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"接受","再次搜索不能覆盖人工核验");
  await saveDiscoveredStores(1,null,"来优品","测试省","测试市",[{...raw,name:"来优品(中心店)",type:"购物服务",tag:"零食"}],false,runQuery);
  assert.equal((await c.query("SELECT brand_name FROM brand_stores WHERE id=1")).rows[0].brand_name,"好想来","人工核实的品牌归属不能被其他品牌召回覆盖");
  await reviewAilingshiPoi(admin,{poi_id:raw.id,decision:"reset",reason:"恢复自动判断"},"",connect);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"待核实");
  await c.query("INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,poi_type,longitude,latitude) VALUES(2,1,'好想来','BLOCKED','BLOCKED','好想来(配送仓库)','购物服务',114,30)");
  const blocked=await reviewAilingshiPoi(admin,{poi_id:"BLOCKED",decision:"accept",reason:"核验请求"},"",connect);
  assert.equal(blocked.accepted,0);assert.equal(blocked.excluded,1);assert.match(blocked.rows[0].name_decision_reason,/仓库/);
  await saveDiscoveredStores(1,null,"来优品","测试省","测试市",[{id:"BLOCKED",name:"来优品(中心店)",type:"购物服务",typecode:"060100",tag:"零食",location:[114,30]}],false,runQuery);
  assert.equal((await c.query("SELECT brand_name FROM brand_stores WHERE id=2")).rows[0].brand_name,"好想来","尚被硬规则排除的人工 POI 认定也不能被其他品牌覆盖");
 }finally{await c.query("ROLLBACK");c.release()}
});
