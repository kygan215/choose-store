import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BRANDS, PROVINCES, processDiscoveryJob, serializeDiscoveryJob, type DiscoveryJobDependencies } from "../server/brand-library.js";
import { canonicalSnackBrand, isRetiredSnackBrand } from "../server/snack-brands.js";
import type { Row } from "../server/services.js";

async function runNational(options:{failProvince?:string;pause?:boolean;truncated?:boolean;concurrency?:number;pauseDuringQueries?:boolean}={}) {
  const job:Row={id:30,tenant_id:1,created_by:2,province:"全国",cities_json:[],brands_json:["好想来零食","零食悦"],status:"等待执行",control:"run",api_calls:0};
  const loaded:string[]=[],saved:Array<{province:string;city:string;brand:string}>=[];
  let active=0,peak=0,started=0;
  const dependencies:DiscoveryJobDependencies={
    concurrency:options.concurrency,
    query:async(sql,values=[])=>{
      if(sql.startsWith("SELECT * FROM brand_discovery_jobs"))return {rows:[job]};
      if(sql.startsWith("SELECT COUNT(*)"))return {rows:[{count:saved.length}]};
      if(sql.startsWith("UPDATE brand_discovery_jobs SET cities_json=")){
        job.cities_json=JSON.parse(String(values[0]));job.total_units=values[1];job.processed_units=0;
      }
      if(sql.includes("processed_units=processed_units+1"))job.processed_units++;
      if(sql.startsWith("UPDATE brand_discovery_jobs SET status=$1")){
        job.status=values[0];job.found_stores=values[1];job.error_message=values[3];
      }
      return {rows:[]};
    },
    consumeBackgroundQuota:async()=>({used:1,unlimited:true,limit:null,background_limit:null,remaining:null}),
    listProvinceCities:async(province)=>{
      loaded.push(province);
      if(options.pause)job.control="pause";
      if(province===options.failProvince)throw new Error("区域接口失败");
      return [{name:`${province}第一市`,adcode:"1"},{name:`${province}第二市`,adcode:"2"}];
    },
    discoverBrandStores:async(brand,city)=>{active++;started++;peak=Math.max(peak,active);if(options.pauseDuringQueries&&started===3)job.control="pause";if(options.concurrency)await new Promise(resolve=>setTimeout(resolve,5));active--;return {brand,city,district:"",stores:[],regions:["测试区"],requests:1,page_size:25,truncated:!!options.truncated,complete:!options.truncated}},
    saveDiscoveredStores:async(_tenant,_job,brand,province,city)=>{saved.push({province,city,brand})},
  };
  await processDiscoveryJob(30,1,2,dependencies);
  return {job:serializeDiscoveryJob(job),loaded,saved,peak,started};
}

test("全国任务展开全部省份所有城市，并为每个品牌保留正确省市归属",async()=>{
  const result=await runNational(),provinces=PROVINCES.filter(name=>name!=="全国");
  assert.deepEqual(result.loaded,provinces);
  assert.equal(result.saved.length,provinces.length*2*2);
  assert.equal(result.job.total_units,result.saved.length);
  assert.equal(result.job.processed_units,result.saved.length);
  assert.equal(result.job.found_stores,result.saved.length);
  assert.equal(result.job.status,"已完成");
  assert.deepEqual(result.job.cities,[]);
  for(const province of provinces){
    for(const city of [`${province}第一市`,`${province}第二市`]){
      assert.deepEqual(result.saved.filter(row=>row.province===province&&row.city===city).map(row=>row.brand),["好想来","零食悦"]);
    }
  }
});

test("全国查询遇到单省失败仍处理其他省，并明确报告部分完成",async()=>{
  const result=await runNational({failProvince:"湖北省"});
  assert.equal(result.job.status,"部分完成");
  assert.match(result.job.error_message,/湖北省：区域接口失败/);
  assert.ok(result.saved.some(row=>row.province==="湖南省"));
  assert.ok(!result.saved.some(row=>row.province==="湖北省"));
});

test("全国查询读取区域期间可以暂停",async()=>{
  const result=await runNational({pause:true});
  assert.equal(result.loaded.length,1);
  assert.equal(result.saved.length,0);
  assert.notEqual(result.job.status,"已完成");
});

test("达到分页上限时不把全国任务误报为完整完成",async()=>{
  const result=await runNational({truncated:true});
  assert.equal(result.job.status,"部分完成");
  assert.match(result.job.error_message,/结果未完整/);
});

test("系统品牌名单只保留好想来，新增独立零食悦并禁止恢复废弃组合项",()=>{
  const names=DEFAULT_BRANDS.map(brand=>brand.name);
  for(const name of ["好想来","吖嘀吖嘀","陆小馋","零食悦"])assert.equal(names.filter(value=>value===name).length,1);
  for(const name of ["好想来零食","好像来零食","零食优选","零食好能嗨"])assert.ok(!names.includes(name));
  assert.equal(canonicalSnackBrand("好像来零食"),"好想来");
  assert.equal(isRetiredSnackBrand("零食优选，零食悦，零食好能嗨"),true);
  assert.equal(isRetiredSnackBrand("零食悦"),false);
});

test("品牌任务按配置并行，进度计数不丢失",async()=>{
 const result=await runNational({concurrency:3});assert.equal(result.peak,3);assert.equal(result.job.processed_units,result.saved.length);assert.equal(result.job.status,"已完成");
});
test("并行品牌任务暂停后只结束在途查询，不再派发新单元",async()=>{
 const result=await runNational({concurrency:3,pauseDuringQueries:true});assert.equal(result.started,3);assert.equal(result.saved.length,3);assert.notEqual(result.job.status,"已完成");
});
