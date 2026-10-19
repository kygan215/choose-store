import assert from "node:assert/strict";
import test from "node:test";
import {resolveStoreCandidates} from "../server/services.js";
const poi={id:"B0J1SSSRR6",name:"零食很忙(湖北襄阳襄州紫荆花园店)",pname:"湖北省",cityname:"襄阳市",adname:"襄州区",address:"紫荆花园",type:"购物服务;专卖店;专营店",tag:"零食",location:"112.2,32.0"};
test("单店名称框直接输入 POI ID 时查询详情，不把 ID 当普通店名搜索",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({searchName:poi.id.toLowerCase()},async(path,params)=>{calls.push(path);assert.equal(path,"/v5/place/detail");assert.equal(params.id,poi.id);return {pois:[poi]}});
 assert.deepEqual(calls,["/v5/place/detail"]);assert.equal(rows[0].id,poi.id);assert.equal(rows[0].name,poi.name);
});
test("显式 POI ID 未查到时不会用其他同名门店替代",async()=>{
 const calls:string[]=[];const rows=await resolveStoreCandidates({poiId:poi.id,searchName:poi.name},async(path)=>{calls.push(path);return {pois:[{...poi,id:"B0OTHER001"}]}});
 assert.ok(calls.includes("/v5/place/detail"));assert.ok(calls.every(path=>path.endsWith("/place/detail")||path==="/v3/assistant/inputtips"));assert.deepEqual(rows,[]);
});
test("POI ID 一致但填写城市冲突时保留候选并要求人工核对",async()=>{
 const rows=await resolveStoreCandidates({poiId:poi.id,searchName:poi.name,city:"武汉市"},async()=>({pois:[poi]}));
 assert.equal(rows[0].auto_confirm,false);assert.ok(rows[0].conflicts?.some((v:string)=>v.includes("城市冲突")));
});
test("POI ID 一致但省份冲突也不能自动确认",async()=>{
 const rows=await resolveStoreCandidates({poiId:poi.id,searchName:poi.name,province:"湖南省"},async()=>({pois:[poi]}));
 assert.equal(rows[0].auto_confirm,false);assert.ok(rows[0].conflicts?.some((v:string)=>v.includes("省份冲突")));
});
