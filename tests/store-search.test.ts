import assert from "node:assert/strict";
import test from "node:test";
import { buildStoreSearchPlan, scoreStoreCandidate, searchStoreCandidates, type AmapSearch } from "../server/store-search.js";

const target="零食很忙湖北武汉江汉远洋万和四季店";
const storePoi={id:"B001",name:"零食很忙(远洋万和四季店)",address:"常青街道远洋万和四季三栋底商7号",pname:"湖北省",cityname:"武汉市",adname:"江汉区",location:"114.250000,30.620000",type:"购物服务",typecode:"060200"};

test("从完整内部名称识别武汉行政区和核心店名",()=>{
  const plan=buildStoreSearchPlan(target);
  assert.equal(plan.brand,"零食很忙");
  assert.equal(plan.city,"武汉市");
  assert.equal(plan.district,"江汉区");
  assert.equal(plan.core,"远洋万和四季");
  assert.ok(plan.queries.includes("零食很忙远洋万和四季店"));
});

test("高德括号门店名与内部完整名称得到高置信度",()=>{
  const plan=buildStoreSearchPlan(target),candidate=scoreStoreCandidate(storePoi,plan);
  assert.ok(candidate);
  assert.ok(candidate.score>=90);
  assert.equal(candidate.auto_confirm,true);
  assert.match(candidate.reasons.join("；"),/核心店名|完全一致/);
});

test("原始名称无结果时自动尝试标准化名称",async()=>{
  const calls:string[]=[];
  const amap:AmapSearch=async(path,params)=>{
    calls.push(`${path}|${params.keywords}`);
    if(path==="/v5/place/text"&&params.keywords==="零食很忙远洋万和四季店")return {status:"1",pois:[storePoi]};
    return {status:"1",pois:[]};
  };
  const candidates=await searchStoreCandidates(amap,target);
  assert.equal(candidates[0]?.id,"B001");
  assert.equal(candidates[0]?.auto_confirm,true);
  assert.ok(calls.some(call=>call.endsWith("|零食很忙远洋万和四季店")));
});

test("名称变体仍无门店时使用地标周边品牌回退",async()=>{
  const calls:string[]=[];
  const landmark={id:"L001",name:"远洋万和四季",address:"常青街道",cityname:"武汉市",adname:"江汉区",location:"114.251000,30.621000",type:"商务住宅"};
  const amap:AmapSearch=async(path,params)=>{
    calls.push(`${path}|${params.keywords}`);
    if(path==="/v5/place/text"&&params.keywords==="远洋万和四季")return {status:"1",pois:[landmark]};
    if(path==="/v5/place/around"&&params.keywords==="零食很忙")return {status:"1",pois:[storePoi]};
    return {status:"1",pois:[]};
  };
  const candidates=await searchStoreCandidates(amap,target);
  assert.equal(candidates[0]?.id,"B001");
  assert.equal(candidates[0]?.source,"landmark_nearby");
  assert.equal(candidates[0]?.auto_confirm,true);
  assert.ok(calls.some(call=>call.startsWith("/v5/place/around|零食很忙")));
});

test("好想来品牌变体和道路同义词可以形成高置信度匹配",()=>{
  const plan=buildStoreSearchPlan("好想来零食盐城响水县黄海路店");
  const candidate=scoreStoreCandidate({
    id:"YC001",name:"好想来零食乐园(盐城响水县陈家港镇店)",
    address:"陈家港镇黄海大街46号",cityname:"盐城市",adname:"响水县",
    location:"119.81429,34.37576",type:"购物服务",typecode:"060200",
  },plan);
  assert.equal(plan.brand,"好想来零食");
  assert.ok(candidate);
  assert.equal(candidate.auto_confirm,true);
  assert.ok(candidate.score>=75);
  assert.match(candidate.reasons.join("；"),/黄海|道路|地理/);
});

test("乡镇名称一致时优先于仅品牌和区县相同的候选",()=>{
  const plan=buildStoreSearchPlan("好想来零食南通海安市雅周镇店");
  const exactTown=scoreStoreCandidate({
    id:"NT001",name:"好想来零食乐园(人民路店)",
    address:"雅周镇周村一组好想来品牌零食",cityname:"南通市",adname:"海安市",
    location:"120.332715,32.39518",type:"购物服务",typecode:"060200",
  },plan);
  const otherTown=scoreStoreCandidate({
    id:"NT002",name:"好想来零食乐园(曲塘店)",
    address:"曲塘镇中心街",cityname:"南通市",adname:"海安市",
    location:"120.400000,32.500000",type:"购物服务",typecode:"060200",
  },plan);
  assert.ok(exactTown&&otherTown);
  assert.equal(exactTown.auto_confirm,true);
  assert.ok(exactTown.score>otherTown.score);
  assert.match(exactTown.reasons.join("；"),/雅周镇|地理/);
});
