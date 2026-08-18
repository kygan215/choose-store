import assert from "node:assert/strict";
import test from "node:test";
import { createEnhancedAnalysis, POI_CATEGORY_TYPES, recognizeBusinessDistrict, type Poi } from "../server/services.js";

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
  assert.equal(analysis.analysis_version,"server-v2");
  assert.equal(analysis.feature_vector.layers["500"].counts["中学"],1);
  assert.equal(analysis.feature_vector.fit_components.middle_school,1);
  assert.ok(analysis.business_district_recognition.by_radius["500"]);
});
