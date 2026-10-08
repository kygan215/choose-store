import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pool } from "../server/db.js";
import { processDiscoveryJob } from "../server/brand-library.js";

after(()=>pool.end());
const scenarios=[
  {name:"旧版本且不完整的新鲜缓存仍复用",complete:false,version:0,age:5,force:false,expected:0},
  {name:"分页截断的当前版本缓存仍复用并提示部分结果",complete:false,version:3,age:5,force:false,expected:0},
  {name:"完整的零结果缓存仍复用",complete:true,version:3,age:5,force:false,expected:0},
  {name:"好想来旧品牌名缓存继续复用",complete:false,version:0,age:5,force:false,brand:"好想来零食",expected:0},
  {name:"超过30天的缓存重新查询",complete:true,version:3,age:31,force:false,expected:1},
  {name:"用户强制刷新时重新查询",complete:true,version:3,age:5,force:true,expected:1},
  {name:"未查过的区域重新查询",complete:true,version:3,age:5,force:false,missing:true,expected:1},
  {name:"不能借用其他租户的缓存",complete:true,version:3,age:5,force:false,cacheTenant:2,expected:1},
];
for(const scenario of scenarios)test(scenario.name,async()=>{
 const client=await pool.connect();
 try {
  await client.query("BEGIN");
  for(const table of ["brand_discovery_jobs","brand_region_cache","brand_catalog","brand_stores"])await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
  await client.query(`INSERT INTO brand_discovery_jobs(id,tenant_id,created_by,province,cities_json,brands_json,status,control,force_refresh) VALUES(151,1,1,'北京市','["北京市"]','["好想来"]','等待执行','run',$1)`,[scenario.force]);
  if(!scenario.missing)await client.query(`INSERT INTO brand_region_cache(tenant_id,brand_name,province,city,store_count,complete,filter_version,refreshed_at) VALUES($1,$2,'北京市','北京市',0,$3,$4,NOW()-$5*INTERVAL '1 day')`,[scenario.cacheTenant||1,scenario.brand||"好想来",scenario.complete,scenario.version,scenario.age]);
  let searches=0;
  await processDiscoveryJob(151,1,1,{query:(sql,values)=>client.query(sql,values),consumeBackgroundQuota:async()=>({used:0,unlimited:true,limit:null,background_limit:null,remaining:null}),discoverBrandStores:async()=>{searches++;return {stores:[],brand:"好想来",city:"北京市",district:"",regions:[],requests:0,page_size:25,truncated:false,complete:true}},saveDiscoveredStores:async()=>{}});
  const job=(await client.query("SELECT cached_units,processed_units,status,error_message FROM brand_discovery_jobs WHERE id=151")).rows[0];
  assert.equal(searches,scenario.expected,"外部查询次数");
  assert.equal(Number(job.cached_units),scenario.expected===0?1:0);
  assert.equal(Number(job.processed_units),1);
  if(scenario.expected===0&&!scenario.complete){assert.equal(job.status,"部分完成");assert.match(job.error_message,/缓存/)}
 } finally {await client.query("ROLLBACK");client.release()}
});
