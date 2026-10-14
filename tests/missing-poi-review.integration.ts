import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test,{after} from "node:test";
import type {PoolClient} from "pg";
import type {AuthUser} from "../server/auth.js";
import {pool} from "../server/db.js";
import {bulkReviewBrandStores} from "../server/brand-store-bulk-review.js";
import {reviewAilingshiPoi} from "../server/ailingshi-review.js";
import {brandStoreRecordReviewSql} from "../server/brand-store-record-review-sql.js";
import {brandPolicyFunctionsSql} from "../server/brand-store-policy-sql.js";
import {listBrandStores,saveDiscoveredStores} from "../server/brand-library.js";

const admin:AuthUser={id:1,tenantId:1,email:"review@test.local",displayName:"核验管理员",role:"admin"};
after(()=>pool.end());

test("缺少高德 POI ID 的门店也能按本条记录人工核验，且不会影响另一条门店",async()=>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  for(const table of ["brand_stores","brand_store_removals","ailingshi_poi_overrides","brand_store_record_overrides","brand_region_cache","brand_dashboard_snapshots","audit_logs","stores"])await c.query(`CREATE TEMP TABLE ${table}(LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await c.query(brandPolicyFunctionsSql);
  await c.query(brandStoreRecordReviewSql);
  const name="赵一鸣省钱超市(中心店)",location=[114,30],address="测试路1号";
  const legacyUid=`brand-missing:${createHash("sha256").update(JSON.stringify([name,address,location])).digest("hex")}`;
  const sourceUid=`${legacyUid}|赵一鸣零食`;
  const raw={name,address,location,type:"购物服务",tag:"零食"};
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,address,poi_type,raw_json,longitude,latitude)
    VALUES(1,1,'赵一鸣零食',$1,NULL,$2,$3,'购物服务',$4,114,30),
          (2,1,'赵一鸣零食','brand-missing:another',NULL,'赵一鸣省钱超市(另一店)','测试路2号','购物服务',$5,114,30)`,[sourceUid,name,address,JSON.stringify(raw),JSON.stringify({...raw,name:"赵一鸣省钱超市(另一店)",address:"测试路2号"})]);
  await c.query("UPDATE brand_stores SET source_uid=$1 WHERE id=1",[legacyUid]);
  const scopeMigration=await readFile(new URL("../server/migrations/032_scope_missing_poi_uid_by_brand.sql",import.meta.url),"utf8");
  await c.query(scopeMigration);
  await c.query(scopeMigration);
  assert.equal((await c.query("SELECT source_uid FROM brand_stores WHERE id=1")).rows[0].source_uid,sourceUid,"旧来源键迁移应幂等");
  const runQuery=(sql:string,values?:unknown[])=>c.query(sql,values);
  const connect=async()=>({query:(sql:string,values?:unknown[])=>c.query(sql==="BEGIN"?"SAVEPOINT missing_poi_review":sql==="COMMIT"?"RELEASE SAVEPOINT missing_poi_review":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT missing_poi_review":sql,values),release:()=>{}} as PoolClient);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,2);
  const result=await bulkReviewBrandStores(admin,{store_ids:[1],decision:"accept",reason:"人工核实此门店地址和品牌"},"",connect);
  assert.equal(result.accepted,1);
  assert.equal(result.pending,0);
  assert.deepEqual((await c.query("SELECT id,name_decision,library_visible FROM brand_stores ORDER BY id")).rows.map(row=>[Number(row.id),row.name_decision,row.library_visible]),[[1,"接受",true],[2,"待核实",false]]);
  assert.equal((await listBrandStores(1,{},runQuery)).total,1);
  assert.equal((await listBrandStores(1,{review_status:"name_pending"},runQuery)).total,1);
  assert.equal((await c.query("SELECT decision FROM brand_store_record_overrides WHERE brand_store_id=1")).rows[0].decision,"accept");
  await saveDiscoveredStores(1,null,"赵一鸣零食","湖北省","武汉市",[raw],false,runQuery);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"接受","相同来源再次查询仍沿用本条人工判断");
  assert.equal(Number((await c.query("SELECT count(*) AS n FROM brand_stores WHERE brand_name='赵一鸣零食' AND amap_name=$1",[name])).rows[0].n),1,"迁移后的来源键刷新时不得复制人工核验记录");
  await saveDiscoveredStores(1,null,"好想来","湖北省","武汉市",[raw],false,runQuery);
  const otherBrand=(await c.query("SELECT id,brand_name,name_decision FROM brand_stores WHERE brand_name='好想来' AND amap_name=$1",[name])).rows;
  assert.equal(otherBrand.length,1,"相同缺 ID 结果用于另一品牌时应是独立候选");
  assert.notEqual(otherBrand[0].name_decision,"接受","另一品牌不得继承本条人工纳入");
  await reviewAilingshiPoi(admin,{store_id:1,decision:"reset",reason:"重新核对"},"",connect);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"待核实");
  await reviewAilingshiPoi(admin,{store_id:1,decision:"exclude",reason:"人工确认不是目标门店"},"",connect);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"排除");
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=2")).rows[0].name_decision,"待核实");
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,address,longitude,latitude) VALUES
    (3,1,'赵一鸣零食','REAL-3','REAL-3','赵一鸣省钱超市(重合店)','真实门店地址',115,31),
    (4,1,'赵一鸣零食','brand-missing:duplicate',NULL,'湖北省武汉市赵一鸣省钱超市(重合店)','赵一鸣省钱超市(重合店)',115,31)`);
  await assert.rejects(bulkReviewBrandStores(admin,{store_ids:[4],decision:"accept",reason:"重复候选不应单独纳入"},"",connect),/记录 #3 重复/);
  await assert.rejects(reviewAilingshiPoi(admin,{store_id:4,decision:"accept",reason:"重复候选不应单独纳入"},"",connect),/记录 #3 重复/);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=4")).rows[0].name_decision,"待核实");
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude)
    VALUES(5,1,'赵一鸣零食','brand-missing:manual-first',NULL,'湖北省武汉市赵一鸣省钱超市(后续店)','湖北省','武汉市','赵一鸣省钱超市(后续店)',116,32)`);
  await reviewAilingshiPoi(admin,{store_id:5,decision:"accept",reason:"核实这条无 ID 候选"},"",connect);
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude,poi_type)
    VALUES(6,1,'赵一鸣零食','REAL-6','REAL-6','赵一鸣省钱超市(后续店)','湖北省','武汉市','后续路1号',116,32,'餐饮服务;中餐厅;中餐厅')`);
  await reviewAilingshiPoi(admin,{poi_id:"REAL-6",decision:"accept",reason:"人工确认有 ID 的真实门店"},"",connect);
  assert.equal((await c.query("SELECT deleted_at IS NOT NULL AS archived FROM brand_stores WHERE id=5")).rows[0].archived,true,"正式 POI 后续人工纳入时应归档重复的无 ID 候选");
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=6")).rows[0].name_decision,"接受");
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude)
    VALUES(7,1,'赵一鸣零食','brand-missing:bulk-first',NULL,'湖北省武汉市赵一鸣省钱超市(批量店)','湖北省','武汉市','赵一鸣省钱超市(批量店)',117,33)`);
  await bulkReviewBrandStores(admin,{store_ids:[7],decision:"accept",reason:"人工确认无 ID 候选"},"",connect);
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,province,city,address,longitude,latitude,poi_type)
    VALUES(8,1,'赵一鸣零食','REAL-8','REAL-8','赵一鸣省钱超市(批量店)','湖北省','武汉市','批量路1号',117,33,'餐饮服务;中餐厅;中餐厅')`);
  await bulkReviewBrandStores(admin,{store_ids:[8],decision:"accept",reason:"批量确认真实 POI"},"",connect);
  assert.equal((await c.query("SELECT deleted_at IS NOT NULL AS archived FROM brand_stores WHERE id=7")).rows[0].archived,true,"批量纳入真实 POI 时也应归档重复的无 ID 候选");
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=8")).rows[0].name_decision,"接受");
 }finally{await c.query("ROLLBACK");c.release()}
});
