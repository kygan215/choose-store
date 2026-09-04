import assert from "node:assert/strict";
import test from "node:test";
import { createEnhancedAnalysis, inferSnackBrand, POI_CATEGORY_TYPES, recognizeBusinessDistrict, type Poi } from "../server/services.js";
import { scoreEnvironmentProxies } from "../app/scoring.js";

const poi=(id:string,category:string,distance:number):Poi=>({id,name:`${category}${id}`,category,type:category==="中学"?"科教文化服务;学校;中学":"",typecode:category==="中学"?"141202":"",address:"",distance,location:[114.3,30.5],distance_bucket:"≤500米"});

test("中学使用高德中学类型代码",()=>{
  assert.equal(POI_CATEGORY_TYPES["中学"],"141202");
});

test("商业与交通证据充足时识别500米商圈",()=>{
  const pois=[poi("1","购物中心",200),poi("2","超市",220),poi("3","便利店",250),poi("4","便利店",300),poi("5","竞品门店",350),poi("6","地铁站",420),poi("7","公交站",450)];
  const result=recognizeBusinessDistrict(pois,[500],["购物中心","超市","便利店","竞品门店","地铁站","公交站"]),primary=result.by_radius["500"];
  assert.equal(primary.is_business_district,true);
  assert.ok(primary.score>=50);
  assert.match(primary.evidence.join("；"),/购物中心 1 个/);
});

test("未分析主要证据分类时不把缺失数据当成零",()=>{
  const result=recognizeBusinessDistrict([poi("1","小学",300)],[500],["小学"]),primary=result.by_radius["500"];
  assert.equal(primary.is_business_district,null);
  assert.equal(primary.status,"证据不足");
  assert.ok(primary.missing_categories.includes("购物中心"));
});

test("增强分析按圈层统计中学并写入识别结果",()=>{
  const pois=[poi("1","中学",300),poi("2","购物中心",400),poi("3","超市",450),poi("4","公交站",480)];
  const analysis=createEnhancedAnalysis({id:1,city:"武汉市",district:"江汉区"},pois,[500,1000],["中学","购物中心","超市","公交站","便利店"]);
  assert.equal(analysis.analysis_version,"server-v4");
  assert.equal(analysis.feature_vector.layers["500"].counts["中学"],1);
  assert.ok(analysis.feature_vector.fit_components.middle_school>0);
  assert.ok(analysis.feature_vector.fit_components.middle_school<=100);
  assert.ok(analysis.business_district_recognition.by_radius["500"]);
});

test("住宅活跃度、消费环境和竞品压力按半径形成可比较分层",()=>{
  const proxyPois:Poi[]=[
    ...Array.from({length:8},(_,index)=>poi(`r${index}`,"住宅小区",120+index*35)),
    ...Array.from({length:5},(_,index)=>poi(`s${index}`,"便利店",150+index*55)),
    ...Array.from({length:4},(_,index)=>({...poi(`d${index}`,"餐饮服务",180+index*65),cost:35+index*10})),
    {...poi("c1","竞品门店",180),name:"零食很忙测试店",brand:"零食很忙",competitor_relation:"同品牌竞品"},
    {...poi("c2","竞品门店",460),name:"赵一鸣零食测试店",brand:"赵一鸣零食",competitor_relation:"异品牌竞品"},
  ];
  const result=scoreEnvironmentProxies(proxyPois,[500,1000],["住宅小区","便利店","餐饮服务","竞品门店"]);
  const residential=result.residential_activity.by_radius["500"] as {score:number;level:string},competition=result.competition_dashboard.by_radius["500"] as {score:number;total:number;same_brand:number;other_brand:number;nearest:{distance:number}};
  assert.ok(residential.score>=0&&residential.score<=100);
  assert.ok(["低","中","高","很高"].includes(residential.level));
  assert.equal(competition.total,2);assert.equal(competition.same_brand,1);assert.equal(competition.other_brand,1);assert.equal(competition.nearest.distance,180);assert.ok(competition.score<100);
});

test("常见折扣零食品牌可以标准化识别",()=>{
  assert.equal(inferSnackBrand("好像来零食盐城黄海大街店"),"好想来零食");
  assert.equal(inferSnackBrand("赵一鸣零食雅周镇店"),"赵一鸣零食");
});

test("常见高密度门店画像保持分层差异而不是批量满分",()=>{
  const pois:Poi[]=[];
  const add=(category:string,count:number)=>{
    for(let index=0;index<count;index++)pois.push(poi(`${category}-${index}`,category,100+index));
  };
  add("住宅小区",12);
  add("幼儿园",1);
  add("小学",1);
  add("中学",1);
  add("超市",15);
  add("便利店",15);
  add("地铁站",1);
  add("公交站",3);
  add("竞品门店",1);
  add("公园",10);

  const analysis=createEnhancedAnalysis(
    {id:1,city:"武汉市",district:"江汉区"},
    pois,
    [500],
    ["住宅小区","幼儿园","小学","中学","超市","便利店","地铁站","公交站","竞品门店","公园"],
  );
  const audienceScores=analysis.audience_profile.age_segments.map(segment=>segment.index);

  assert.ok(analysis.level.score<100,"商圈能级不应因普通高密度样本直接封顶");
  assert.ok(analysis.fit.score<100,"业务适配度不应因普通高密度样本直接封顶");
  assert.ok(new Set(audienceScores).size>=3,"潜在人群指数应至少形成三个可比较档次");
  assert.ok(audienceScores.filter(score=>score===100).length<=1,"潜在人群不应多项同时满分");
  assert.ok(Object.values(analysis.business_district_type.scores).every(score=>score>=0&&score<=100),"商圈类型得分必须在0到100之间");
});
