import assert from "node:assert/strict";
import test from "node:test";
import { amapRating, formatAmapRating, matchedAmapRating } from "../app/amap-rating.js";
import { buildStoreSearchPlan, discoverBrandStores, scoreStoreCandidate } from "../server/store-search.js";
import { serializeBrandStore } from "../server/brand-library.js";

const poi = {id:"RATING-1",name:"好想来(人民路店)",location:"114.3,30.5",type:"购物服务;零食店",typecode:"060200",cityname:"武汉市",business:{rating:"3.9"}};

test("评分从高德搜索经过候选和品牌入库序列化后保留，与匹配分独立",async()=>{
  const candidate=scoreStoreCandidate(poi,buildStoreSearchPlan("好想来人民路店","武汉市"));
  assert.equal(candidate?.rating,3.9);
  assert.ok(candidate!.score>5);
  const result=await discoverBrandStores(async(_path,params)=>{
    assert.match(String(params.show_fields),/business/);
    return {pois:[poi]};
  },"好想来","武汉市","洪山区");
  assert.equal(result.stores[0].rating,3.9);
  const persisted=JSON.parse(JSON.stringify(result.stores[0]));
  assert.equal(serializeBrandStore({raw_json:persisted}).rating,3.9);
  assert.equal(formatAmapRating(persisted.rating),"3.9 分");
});

test("缺失、空数组、异常评分显示暂无评分，不使用匹配分或虚构零分",()=>{
  for(const rating of [undefined,null,"",[],{},"--",0,"0",-1,5.1,"NaN",true]){
    assert.equal(amapRating({business:{rating},score:99}),null);
    assert.equal(formatAmapRating(rating),"暂无评分");
  }
  assert.equal(amapRating({biz_ext:{rating:"4.2"}}),4.2);
  assert.equal(amapRating({rating:5}),5);
  assert.equal(serializeBrandStore({raw_json:{score:100}}).rating,null);
});

test("批量确认使用选中的 POI 评分，不能错用第一候选",()=>{
  const candidates=[{id:"first",rating:4.8},{id:"chosen",rating:3.9}];
  assert.equal(matchedAmapRating("chosen",candidates),3.9);
  assert.equal(matchedAmapRating("missing",candidates),null);
});

test("合并重复候选时保留其他查询返回的评分",async()=>{
  let count=0;
  const result=await discoverBrandStores(async()=>{
    count++;
    return {pois:[{...poi,business:count===1?{}:{rating:"3.9"}}]};
  },"好想来","武汉市","洪山区");
  assert.ok(count>1);
  assert.equal(result.stores[0].rating,3.9);
});
