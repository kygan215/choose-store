import { assessBrandStore } from "../shared/brand-store-policy.js";
import { brandPolicyMigrationSql } from "../server/brand-store-policy-sql.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import test,{after} from "node:test";
import {performance} from "node:perf_hooks";
import {pool} from "../server/db.js";
import {canRetainSnackStore,snackNeedsReviewSql,snackRetailSql,snackReviewStatus} from "../server/snack-retail.js";
import {listBrandStores,storeFilterSql} from "../server/brand-library.js";

after(()=>pool.end());
test("蛋糕排除与待核验生成列匹配应用规则，更新后自动重算，分页不串租户",async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  for(const table of ["brand_stores","brand_region_cache","brand_dashboard_snapshots","stores"])await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await client.query(brandPolicyMigrationSql);
  const cases:Array<{name:string;type:string;typecode:string;business:{keytag:string}}>=[];
  for(const name of ["糖巢(蛋糕店旁)","糖巢蛋糕店","糖巢省钱超市(公寓店)","厦门糖巢(测试店)","好想来"])
   for(const type of ["购物服务;专营店","餐饮服务;糕饼店","餐饮服务;中餐厅","生活服务;生活服务场所;生活服务场所"])
    for(const code of ["061200","050800","070000","061200|050100","050100;061200","未知","060000|070000",""])
     for(const tag of ["蛋糕店","零食","日杂店","综合超市","蛋糕店;零食",""])
      cases.push({name,type,typecode:code,business:{keytag:tag}});
  await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,poi_type,typecode,raw_json,longitude,latitude)
   SELECT n,1,'糖巢','review-'||n,p->>'name',p->>'type',p->>'typecode',p,114,30 FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS data(p,n)`,[JSON.stringify(cases)]);
  await client.query("UPDATE brand_stores SET amap_poi_id=source_uid");
  const rows=(await client.query("SELECT id,library_visible,needs_review FROM brand_stores ORDER BY id")).rows;
  for(const row of rows){const poi=cases[Number(row.id)-1];assert.equal(row.library_visible,assessBrandStore("糖巢",{...poi,id:`review-${row.id}`}).decision==="接受",JSON.stringify(poi));assert.equal(row.needs_review,assessBrandStore("糖巢",{...poi,id:`review-${row.id}`}).decision==="待核实",JSON.stringify(poi))}

  const runQuery=(sql:string,values?:unknown[])=>client.query(sql,values);
  const count=rows.filter(row=>row.needs_review).length;
  const pending=await listBrandStores(1,{review_status:"pending",page_size:2},runQuery);assert.equal(pending.total,count);assert.ok(pending.rows.every(row=>row.review_status==="待核验"));
  const next=await listBrandStores(1,{review_status:"pending",page_size:2,page:2},runQuery);assert.equal(pending.rows.some(row=>next.rows.some(other=>other.id===row.id)),false);
  assert.equal((await listBrandStores(2,{review_status:"pending"},runQuery)).total,0);
  const row=(await client.query("SELECT id FROM brand_stores WHERE needs_review LIMIT 1")).rows[0];
  await client.query("UPDATE brand_stores SET amap_name='糖巢',poi_type='购物服务;专营店',typecode='061200',raw_json=$2 WHERE id=$1",[row.id,JSON.stringify({business:{keytag:"零食"}})]);
  assert.equal((await client.query("SELECT needs_review FROM brand_stores WHERE id=$1",[row.id])).rows[0].needs_review,false);
  await client.query("UPDATE brand_stores SET raw_json=$2 WHERE id=$1",[row.id,JSON.stringify({business:{keytag:"蛋糕店"}})]);
  const excluded=(await client.query("SELECT library_visible,name_decision FROM brand_stores WHERE id=$1",[row.id])).rows[0];
  assert.equal(excluded.library_visible,false);assert.equal(excluded.name_decision,"排除");
  const built=storeFilterSql(1,{review_status:"pending"});assert.equal(Number((await client.query(`SELECT count(*) count FROM brand_stores bs WHERE ${built.where}`,built.values)).rows[0].count),count-1);
  console.log(JSON.stringify({classification_cases:cases.length,pending:count,generated_fields:'matched',pagination:'passed'}));
 }finally{await client.query("ROLLBACK");client.release()}
});

test("6万条品牌门店中筛选6000条待核验，首页和翻页在500ms内",async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  for(const table of ["brand_stores","brand_region_cache","brand_dashboard_snapshots","stores"])await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await client.query(brandPolicyMigrationSql);
  await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,province,city,district,longitude,latitude,poi_type,typecode,raw_json)
   SELECT n,1,'糖巢','perf-review-'||n,'糖巢('||n||'店)','福建省','三明市','三元区',117,26,'购物服务','061200',
    jsonb_build_object('business',jsonb_build_object('keytag',CASE WHEN n%10=0 THEN '' ELSE '零食' END)) FROM generate_series(1,60000) n`);
  await client.query("UPDATE brand_stores SET amap_poi_id=source_uid,poi_type=CASE WHEN id%10=0 THEN '' ELSE '购物服务' END,typecode=CASE WHEN id%10=0 THEN '' ELSE '061200' END");
  await client.query("ANALYZE brand_stores");
  for(const page of [1,58,120]){const start=performance.now(),result=await listBrandStores(1,{review_status:"pending",page},(sql,values)=>client.query(sql,values)),ms=Math.round(performance.now()-start);assert.equal(result.total,6000);assert.equal(result.rows.length,50);assert.ok(result.rows.every(row=>row.review_status==="待核验"));assert.ok(ms<500,`${ms}ms`);console.log(JSON.stringify({review_status:'pending',page,total:result.total,ms}))}
 }finally{await client.query("ROLLBACK");client.release()}
});
