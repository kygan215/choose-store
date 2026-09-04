import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildStoreSearchPlan, deriveStoreSearchInput, discoverBrandStores, scoreStoreCandidate, searchStoreCandidates, type AmapSearch } from "../server/store-search.js";

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

test("门店搜索请求并保留高德现场照片",async()=>{
  const calls:Array<Record<string,string|number|boolean>>=[];
  const amap:AmapSearch=async(path,params)=>{calls.push(params);return path==="/v5/place/text"?{status:"1",pois:[{...storePoi,photos:[{title:"门头",url:"http://example.com/store.jpg"}]}]}:{status:"1",tips:[]}};
  const candidates=await searchStoreCandidates(amap,target);
  assert.equal(candidates[0]?.photos?.[0]?.title,"门头");
  assert.equal(candidates[0]?.photos?.[0]?.url,"https://example.com/store.jpg");
  assert.ok(calls.some(params=>String(params.show_fields).includes("photos")));
});

test("单店结果页提供地图标签全选、取消全选和现场照片页签",()=>{
  const source=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  for(const text of ["全选","取消全选","现场照片","高德暂无该门店的现场照片"])assert.match(source,new RegExp(text));
});

test("单店智能搜索允许只填写详细地址",()=>{
  const source=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(source,/!query\.name\.trim\(\)&&!query\.address\.trim\(\)/);
  assert.match(source,/门店名称或详细地址填写任意一项即可/);
  assert.doesNotMatch(source,/searchMode === "address"/);
});

test("文本搜索无结果时使用高德输入提示召回精确门店",async()=>{
  const calls:string[]=[];
  const amap:AmapSearch=async(path,params)=>{
    calls.push(`${path}|${params.keywords}`);
    if(path==="/v3/assistant/inputtips")return {status:"1",tips:[{
      id:"B0MRFUTGKW",name:"零食很忙(湖北荆州张沟社区店)",address:"张沟悦府",
      district:"湖北省荆州市沙市区",adcode:"421002",location:"112.276715,30.321274",
    }]};
    return {status:"1",pois:[]};
  };
  const candidates=await searchStoreCandidates(amap,"零食很忙(湖北荆州张沟社区店)");
  assert.equal(candidates[0]?.id,"B0MRFUTGKW");
  assert.equal(candidates[0]?.auto_confirm,true);
  assert.equal(candidates[0]?.province,"湖北省");
  assert.equal(candidates[0]?.city,"荆州市");
  assert.equal(candidates[0]?.district,"沙市区");
  assert.ok(calls.some(call=>call.startsWith("/v3/assistant/inputtips|")));
});

test("输入提示返回的门店名增加道路信息时仍可自动确认",async()=>{
  const amap:AmapSearch=async(path)=>path==="/v3/assistant/inputtips"?{status:"1",tips:[{
    id:"B0MRG7N1NH",name:"零食很忙(湖北仙桃汉江路白露苑店)",address:"白露苑东门南160米",
    district:"湖北省仙桃市",adcode:"429004",location:"113.432514,30.357683",
  }]}:{status:"1",pois:[]};
  const candidates=await searchStoreCandidates(amap,"零食很忙（湖北仙桃白露苑店）");
  assert.equal(candidates[0]?.id,"B0MRG7N1NH");
  assert.equal(candidates[0]?.auto_confirm,true);
});

test("任务38的四个历史失败门店均能跳过无坐标提示并匹配真实POI",async()=>{
  const fixtures=[
    {input:"零食很忙(湖北荆州张沟社区店)",id:"B0MRFUTGKW",name:"零食很忙(湖北荆州张沟社区店)",address:"张沟悦府",district:"湖北省荆州市沙市区",location:"112.276715,30.321274"},
    {input:"零食很忙（湖北仙桃白露苑店）",id:"B0MRG7N1NH",name:"零食很忙(湖北仙桃汉江路白露苑店)",address:"白露苑东门南160米",district:"湖北省仙桃市",location:"113.432514,30.357683"},
    {input:"零食很忙(湖北天门名门小区店)",id:"B0M1CLDC04",name:"零食很忙(湖北天门名门小区店)",address:"钟惺大道46号名门小区1-101/102/103",district:"湖北省天门市",location:"113.154525,30.641825"},
    {input:"零食很忙(湖北天门天华金瑞府店)",id:"B0M1BYWJL5",name:"零食很忙(湖北天门天华金瑞府店)",address:"天华·金瑞府",district:"湖北省天门市",location:"113.183884,30.660186"},
  ];
  for(const fixture of fixtures){
    const amap:AmapSearch=async(path)=>path==="/v3/assistant/inputtips"?{status:"1",tips:[
      {id:[],name:fixture.input,address:[],district:[],location:[]},fixture,
    ]}:{status:"1",pois:[]};
    const candidates=await searchStoreCandidates(amap,fixture.input);
    assert.equal(candidates[0]?.id,fixture.id,fixture.input);
    assert.equal(candidates[0]?.auto_confirm,true,fixture.input);
  }
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

test("门店名称缺失时会使用详细地址搜索而不是发送空关键词",async()=>{
  const calls:string[]=[];
  const address="湖北省黄冈市蕲春县管窑镇 寒婆岭村南征街道131号零食很忙管窑镇店";
  const amap:AmapSearch=async(path,params)=>{
    calls.push(`${path}|${String(params.keywords||"")}`);
    return path==="/v5/place/text"?{status:"1",pois:[{id:"HG001",name:"零食很忙(管窑镇店)",address:"南征街道131号",pname:"湖北省",cityname:"黄冈市",adname:"蕲春县",location:"115.200000,30.200000"}]}:{status:"1",tips:[]};
  };
  const candidates=await searchStoreCandidates(amap,"","黄冈","",address);
  assert.equal(candidates[0]?.id,"HG001");
  assert.ok(calls.every(call=>!call.endsWith("|")));
});

test("名称存在时仍会把详细地址作为独立召回路径且单行不超过六次请求",async()=>{
  const calls:string[]=[],address="湖北省武汉市洪山区珞喻路88号";
  const amap:AmapSearch=async(path,params)=>{calls.push(`${path}|${String(params.keywords||"")}`);return path==="/v5/place/text"&&params.keywords===address?{status:"1",pois:[{id:"ADDR1",name:"零食很忙(光谷店)",address:"珞喻路88号",cityname:"武汉市",adname:"洪山区",location:"114.4,30.5"}]}:{status:"1",pois:[],tips:[]}};
  const candidates=await searchStoreCandidates(amap,"零食很忙光谷店","武汉市","洪山区",address);
  assert.equal(candidates[0]?.id,"ADDR1");
  assert.ok(calls.some(call=>call.endsWith(`|${address}`)));
  assert.ok(calls.length<=6);
});

test("仅有详细地址时会优先提取地址中的品牌和店名",()=>{
  assert.equal(deriveStoreSearchInput("","湖北省黄冈市蕲春县管窑镇\n蕲春县管窑镇寒婆岭村南征街道131号零食很忙管窑镇店"),"零食很忙管窑镇店");
  assert.equal(deriveStoreSearchInput("","湖北省黄冈市黄梅县黄梅镇\n古塔西路店（赵一鸣）"),"赵一鸣零食古塔西路店");
  assert.equal(deriveStoreSearchInput("","湖北省黄冈市黄梅县黄梅镇\n誉天下小区赵一鸣"),"赵一鸣零食誉天下小区店");
});

test("全量品牌查询会按行政区分页并跨页去重",async()=>{
  const calls:Array<{path:string;params:Record<string,string|number|boolean>}>=[];
  const makePoi=(index:number)=>({
    id:`WH${String(index).padStart(3,"0")}`,name:`零食很忙(测试${index}店)`,address:`测试路${index}号`,
    pname:"湖北省",cityname:"武汉市",adname:"洪山区",location:`114.${300000+index},30.${500000+index}`,
    type:"购物服务",typecode:"060200",
  });
  const firstPage=Array.from({length:25},(_,index)=>makePoi(index+1));
  const amap:AmapSearch=async(path,params)=>{
    calls.push({path,params});
    if(path==="/v3/config/district")return {status:"1",districts:[{name:"武汉市",districts:[{name:"洪山区",adcode:"420111"}]}]};
    if(path==="/v5/place/text"&&params.page_num===1)return {status:"1",pois:firstPage};
    if(path==="/v5/place/text"&&params.page_num===2)return {status:"1",pois:[firstPage[0],makePoi(26),{...makePoi(27),id:"OTHER",name:"普通便利店"}]};
    return {status:"1",pois:[]};
  };
  const result=await discoverBrandStores(amap,"零食很忙","武汉市","",{maxPagesPerRegion:5,maxRequests:20});
  assert.equal(result.stores.length,26);
  assert.deepEqual(result.regions,["洪山区"]);
  assert.equal(result.complete,true);
  assert.equal(result.truncated,false);
  assert.ok(calls.some(call=>call.path==="/v5/place/text"&&call.params.page_num===2));
  assert.ok(result.stores.every(store=>store.name.includes("零食很忙")));
});

test("全量品牌查询达到请求保护上限时明确标记结果可能不完整",async()=>{
  const amap:AmapSearch=async(path)=>path==="/v3/config/district"
    ?{status:"1",districts:[{name:"武汉市",districts:[{name:"洪山区",adcode:"420111"},{name:"江汉区",adcode:"420103"}]}]}
    :{status:"1",pois:Array.from({length:25},(_,index)=>({
      id:`LIMIT${index}`,name:`零食很忙(限额测试${index}店)`,address:"测试路",
      cityname:"武汉市",adname:"洪山区",location:`114.${index+100000},30.${index+100000}`,
    }))};
  const result=await discoverBrandStores(amap,"零食很忙","武汉市","",{maxPagesPerRegion:10,maxRequests:2});
  assert.equal(result.requests,2);
  assert.equal(result.truncated,true);
  assert.equal(result.complete,false);
  assert.equal(result.stores.length,25);
});

test("品牌门店库维护的别名会参与查询并归入标准品牌",async()=>{
  const calls:string[]=[];
  const amap:AmapSearch=async(path,params)=>{calls.push(String(params.keywords||""));return path==="/v5/place/text"&&params.keywords==="测试零食别名"?{status:"1",pois:[{id:"ALIAS1",name:"测试零食别名(中心店)",address:"测试路1号",cityname:"武汉市",adname:"洪山区",location:"114.3,30.5"}]}:{status:"1",districts:[],pois:[]}};
  const result=await discoverBrandStores(amap,"测试零食标准名","武汉市","洪山区",{aliases:["测试零食别名"],maxPagesPerRegion:2,maxRequests:10});
  assert.ok(calls.includes("测试零食别名"));
  assert.equal(result.stores.length,1);
  assert.match(result.stores[0].reasons.join("；"),/测试零食标准名/);
});
