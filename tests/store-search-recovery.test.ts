import assert from "node:assert/strict";
import test from "node:test";
import {buildStoreSearchPlan,searchStoreCandidates} from "../server/store-search.js";
import {resolveStoreCandidates} from "../server/services.js";
import {persistentAmapPoiId} from "../server/store-resolution.js";

const input="零食很忙湖北孝感实验小学店",address="孝感市孝南区新华街道环城路澴川公园";
const poi={id:"B0VALID001",name:"零食很忙(孝感实验小学店)",address:"环城路澴川公园旁",pname:"湖北省",cityname:"孝感市",adname:"孝南区",location:"113.914087,30.914736",type:"购物服务;零食店",tag:"零食",typecode:"060200"};

test("有地址的五次预算保留地标周边召回，不能用虚构空响应跳过",async()=>{
 const calls:string[]=[],plan=buildStoreSearchPlan(input,"孝感市");
 const rows=await searchStoreCandidates(async(path,params)=>{calls.push(path);if(path==="/v5/place/text"&&params.keywords===plan.core)return {pois:[{name:"实验小学",location:poi.location,cityname:"孝感市"}]};return path==="/v5/place/around"?{pois:[poi]}:{pois:[],tips:[]}},input,"孝感市","",address,5);
 assert.ok(calls.includes("/v5/place/around"));assert.equal(rows[0]?.id,poi.id);assert.ok(calls.length<=5);
});

test("文字和提示均无结果时，地址定位后继续附近搜索并返回真实 POI",async()=>{
 const calls:string[]=[];
 const rows=await resolveStoreCandidates({searchName:input,address,city:"孝感市"},async(path)=>{calls.push(path);if(path==="/v3/geocode/geo")return {geocodes:[{location:poi.location,formatted_address:address,province:"湖北省",city:"孝感市",district:"孝南区"}]};return path==="/v5/place/around"?{pois:[poi]}:{pois:[],tips:[]}});
 assert.ok(calls.indexOf("/v5/place/around")>calls.indexOf("/v3/geocode/geo"));assert.equal(rows[0]?.id,poi.id);assert.equal(rows[0]?.auto_confirm,false);
});

test("高德分享坐标可找附近真实门店，坐标本身保留为非 POI 回退",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({searchName:input,city:"孝感市",locationShare:"https://uri.amap.com/marker?position=113.914087,30.914736"},async(path)=>{calls.push(path);return path==="/v5/place/around"?{pois:[poi]}:{regeocode:{addressComponent:{province:"湖北省",city:"孝感市",district:"孝南区"}}}});
 assert.ok(calls.includes("/v5/place/around"));assert.equal(rows[0].id,poi.id);assert.equal(rows[0].auto_confirm,false);const fallback=rows.find(row=>row.source==="input_coordinates");assert.ok(fallback);assert.equal(persistentAmapPoiId(fallback),null);assert.match(fallback.warnings.join(),/不是高德门店 POI/);
});
test("附近无结果或接口失败时保留位置且明确区分失败和真实空结果",async()=>{
 const run=(fail:boolean)=>resolveStoreCandidates({searchName:input,city:"孝感市",longitude:113.914087,latitude:30.914736},async(path)=>{if(path==="/v5/place/around"&&fail)throw new Error("provider unavailable");return {pois:[],regeocode:{addressComponent:{city:"孝感市"}}}});
 const empty=await run(false),failed=await run(true);assert.equal(empty.length,1);assert.equal(empty.diagnostics.failed_stages.length,0);assert.match(failed.diagnostics.failed_stages.join(),/附近/);assert.match(failed[0].warnings.join(),/不能视为没有门店/);assert.equal(persistentAmapPoiId(failed[0]),null);
});
test("预算不足以执行回退时返回诊断，而非伪造接口空结果",async()=>{
 let calls=0;const rows=await searchStoreCandidates(async()=>{calls++;return {pois:[],tips:[]}},input,"孝感市","",address,1);assert.equal(calls,1);assert.equal(rows.diagnostics.requests,1);assert.equal(rows.diagnostics.budget_exhausted,true);assert.match(rows.diagnostics.warnings.join(),/预算|预留/);
});
test("缺少显式城市时从官方省市字典确认孝感，并约束通用搜索",async()=>{
 const regions:string[]=[];let lookups=0;
 const rows=await resolveStoreCandidates({searchName:input},async(path,params)=>{if(path==="/v3/config/district"){lookups++;return {districts:[{name:"湖北省",districts:[{name:"武汉市",districts:[]},{name:"孝感市",districts:[{name:"孝南区"}]}]}]}}if(path==="/v5/place/text"){regions.push(String(params.region));return {pois:[poi]}}return {pois:[],tips:[]}});
 assert.equal(lookups,1);assert.ok(regions.every(region=>region==="孝感市"));assert.equal(rows[0]?.id,poi.id);
});
test("分享标识详情返回其他 ID 时不能当作该分享 ID 已核实",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({searchName:input,locationShare:`https://uri.amap.com/marker?poiid=${poi.id}`},async(path)=>{calls.push(path);return path==="/v5/place/detail"?{pois:[{...poi,id:"B0OTHER001"}]}:{pois:[],tips:[],districts:[]}});assert.equal(calls[0],"/v5/place/detail");assert.equal(rows.length,0);assert.equal(rows.diagnostics.location_hints?.poi_verified,false);
});

test("分享标识详情空时仍可沿分享位置检索，无真实结果则保留坐标和未核实线索",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({searchName:input,city:"孝感市",locationShare:"https://uri.amap.com/marker?poiid=B0M17UF52A&position=113.910898,30.913213&name=零食很忙&address=孝感市孝南区新华街道环城路澴川公园"},async(path)=>{calls.push(path);return path==="/v3/geocode/regeo"?{regeocode:{addressComponent:{province:"湖北省",city:"孝感市",district:"孝南区"}}}:{pois:[]}});
 assert.equal(calls[0],"/v5/place/detail");assert.ok(calls.includes("/v5/place/around"));assert.equal(rows.length,1);assert.equal(rows[0].source,"input_coordinates");assert.equal(persistentAmapPoiId(rows[0]),null);assert.equal(rows.diagnostics.location_hints?.poi_id,"B0M17UF52A");assert.equal(rows.diagnostics.location_hints?.poi_verified,false);assert.equal(rows.diagnostics.location_hints?.longitude,113.910898);assert.equal(rows.diagnostics.location_hints?.latitude,30.913213);assert.match(rows.diagnostics.location_hints?.address||"",/澴川公园/);assert.match(rows[0].warnings.join(),/分享标识未得到开放接口确认/);
});

test("手填精确 ID 即使同时提供分享位置也不能静默转为附近其他门店",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({searchName:input,poiId:"B0M17UF52A",locationShare:"https://uri.amap.com/marker?position=113.910898,30.913213"},async(path)=>{calls.push(path);return {pois:[]}});assert.deepEqual(calls,["/v5/place/detail"]);assert.equal(rows.length,0);
});
test("配额暂停不能被搜索容错吞成空结果",async()=>{
 class QuotaPauseError extends Error{}
 await assert.rejects(searchStoreCandidates(async()=>{throw new QuotaPauseError("quota")},input,"孝感市"),QuotaPauseError);
});

test("多个缺分类提示的详情不占用地址场景预留的地标和周边预算",async()=>{
 const calls:string[]=[],plan=buildStoreSearchPlan(input,"孝感市");
 const rows=await searchStoreCandidates(async(path,params)=>{calls.push(path);if(path==="/v3/assistant/inputtips")return {tips:[{id:"B0TIP00001",name:"零食很忙同名提示一",location:poi.location},{id:"B0TIP00002",name:"零食很忙同名提示二",location:poi.location}]};if(path==="/v5/place/detail")return {pois:[{id:String(params.id),name:"普通面馆",location:poi.location,type:"餐饮服务;面馆"}]};if(path==="/v5/place/text"&&params.keywords===plan.core)return {pois:[{name:"实验小学",location:poi.location,cityname:"孝感市"}]};return path==="/v5/place/around"?{pois:[poi]}:{pois:[],tips:[]}},input,"孝感市","",address,6);
 assert.ok(calls.includes("/v5/place/around"));assert.equal(rows[0]?.id,poi.id);assert.equal(calls.filter(path=>path==="/v5/place/detail").length,0);assert.ok(calls.length<=6);assert.match(rows.diagnostics.warnings.join(),/提示.*详情.*未执行/);
});

test("无地址的多条无关详情提示仍为地标周边保留预算",async()=>{
 const calls:string[]=[],plan=buildStoreSearchPlan(input,"孝感市");
 const rows=await searchStoreCandidates(async(path,params)=>{calls.push(path);if(path==="/v3/assistant/inputtips")return {tips:Array.from({length:10},(_,index)=>({id:`B0TIP0000${index}`,name:`零食很忙同名提示${index}`,location:poi.location}))};if(path==="/v5/place/detail")return {pois:[{id:String(params.id),name:"普通面馆",location:poi.location,type:"餐饮服务;面馆"}]};if(path==="/v5/place/text"&&params.keywords===plan.core)return {pois:[{name:"实验小学",location:poi.location,cityname:"孝感市"}]};return path==="/v5/place/around"?{pois:[poi]}:{pois:[],tips:[]}},input,"孝感市","","",6);
 assert.ok(calls.includes("/v5/place/around"));assert.equal(rows[0]?.id,poi.id);assert.ok(calls.filter(path=>path==="/v5/place/detail").length<=1);assert.ok(calls.length<=6);assert.match(rows.diagnostics.warnings.join(),/提示.*详情.*未执行/);
});
