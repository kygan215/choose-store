export type PoiCountMap=Record<string,number>;
export type ProxyPoi={name:string;category:string;distance:number;address?:string;brand?:string;competitor_relation?:string;cost?:number};

export const SCORE_BANDS=[
  {min:80,label:"突出"},
  {min:60,label:"较高"},
  {min:40,label:"一般"},
  {min:0,label:"偏低"},
] as const;

export const METRIC_LABELS:Record<string,string>={
  poi_total:"POI 总量",
  category_diversity:"设施丰富度",
  commercial:"商业设施",
  traffic:"交通设施",
  residential:"住宅小区",
  education:"教育设施",
  middle_school:"中学",
  healthcare:"医疗与药店",
  park:"公园",
  competition_balance:"竞争平衡度",
};

const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
const mix=(parts:Array<[number,number]>)=>clamp(parts.reduce((sum,[score,weight])=>sum+score*weight,0));

/**
 * 固定基准点评分：四个数量锚点分别映射到 25/50/70/85 分，超过最高锚点后
 * 使用边际递减曲线，理论上接近但不会轻易达到 100。固定基准使不同任务可横向比较。
 */
export function benchmarkScore(rawValue:number,anchors:[number,number,number,number]){
  const value=Math.max(0,Number(rawValue)||0),points=[0,25,50,70,85],xs=[0,...anchors];
  for(let index=1;index<xs.length;index++){
    if(value<=xs[index]){
      const ratio=(value-xs[index-1])/Math.max(1,xs[index]-xs[index-1]);
      return clamp(points[index-1]+ratio*(points[index]-points[index-1]));
    }
  }
  const excess=value-anchors[3];
  return clamp(85+13*(excess/(excess+Math.max(1,anchors[3]))));
}

export function scoreBand(score:number){return SCORE_BANDS.find(band=>score>=band.min)?.label||"偏低"}
export function fourLevel(score:number,labels=["低","中","高","很高"]){return score>=80?labels[3]:score>=60?labels[2]:score>=40?labels[1]:labels[0]}

const normalizedCount=(count:number,radius:number)=>count*Math.min(4,(500/Math.max(100,radius))**2);
const confidence=(coverage:number,samples:number)=>coverage>=.8&&samples>=12?"较高":coverage>=.6&&samples>=6?"中":coverage>=.4&&samples>=3?"较低":"低";

export function scoreEnvironmentProxies(pois:ProxyPoi[],radii:number[],analyzedCategories:string[]=[]){
  const categories=new Set(analyzedCategories.length?analyzedCategories:pois.map(poi=>poi.category));
  const normalizedRadii=[...new Set(radii.map(Number).filter(value=>Number.isFinite(value)&&value>0))].sort((a,b)=>a-b);
  const residentialRequired=["住宅小区","超市","便利店","药店","幼儿园","小学","中学","公园"];
  const consumptionRequired=["购物中心","餐饮服务","咖啡茶饮","酒店","超市","便利店"];
  const residentialByRadius:Record<string,unknown>={},consumptionByRadius:Record<string,unknown>={},competitionByRadius:Record<string,unknown>={};
  for(const radius of normalizedRadii){
    const inside=pois.filter(poi=>Number(poi.distance)<=radius),count=(category:string)=>inside.filter(poi=>poi.category===category).length;
    const residential=count("住宅小区"),living=count("超市")+count("便利店")+count("药店"),education=count("幼儿园")+count("小学")+count("中学"),parks=count("公园");
    const residentialCoverage=residentialRequired.filter(category=>categories.has(category)).length/residentialRequired.length;
    const residentialScore=mix([
      [benchmarkScore(normalizedCount(residential,radius),[2,6,12,20]),.45],
      [benchmarkScore(normalizedCount(living,radius),[3,8,16,28]),.25],
      [benchmarkScore(normalizedCount(education,radius),[1,3,6,10]),.2],
      [benchmarkScore(normalizedCount(parks,radius),[1,2,4,7]),.1],
    ]);
    residentialByRadius[String(radius)]={radius,score:residentialScore,level:fourLevel(residentialScore),confidence:confidence(residentialCoverage,residential+living+education+parks),counts:{residential,living_services:living,education,parks},evidence:[`住宅小区 ${residential} 个`,`生活配套 ${living} 个、教育设施 ${education} 个、公园 ${parks} 个`,`证据分类覆盖率 ${Math.round(residentialCoverage*100)}%`],limitations:["住宅活跃度是高德POI设施代理指标，不是实际入住率。"]};

    const shopping=count("购物中心"),dining=count("餐饮服务"),cafes=count("咖啡茶饮"),hotels=count("酒店"),retail=count("超市")+count("便利店"),costSamples=inside.filter(poi=>poi.category==="餐饮服务"&&Number(poi.cost)>0).map(poi=>Number(poi.cost)),averageDiningCost=costSamples.length?Math.round(costSamples.reduce((sum,value)=>sum+value,0)/costSamples.length):null;
    const consumptionCoverage=consumptionRequired.filter(category=>categories.has(category)).length/consumptionRequired.length;
    const commercialScore=mix([[benchmarkScore(normalizedCount(shopping,radius),[1,2,4,7]),.3],[benchmarkScore(normalizedCount(dining,radius),[4,12,28,50]),.2],[benchmarkScore(normalizedCount(cafes+hotels,radius),[2,6,14,25]),.2],[benchmarkScore(normalizedCount(retail,radius),[3,8,18,32]),.2],[averageDiningCost==null?40:benchmarkScore(averageDiningCost,[25,45,75,120]),.1]]);
    const consumptionLevel=fourLevel(commercialScore,["偏低","中等","中高","较高"]);
    consumptionByRadius[String(radius)]={radius,score:commercialScore,level:consumptionLevel,confidence:confidence(consumptionCoverage,shopping+dining+cafes+hotels+retail),average_dining_cost:averageDiningCost,cost_sample_count:costSamples.length,counts:{shopping_centers:shopping,dining,cafes,hotels,retail},evidence:[`购物中心 ${shopping} 个、餐饮 ${dining} 个`,`咖啡茶饮 ${cafes} 个、酒店 ${hotels} 个、超市便利店 ${retail} 个`,costSamples.length?`餐饮人均消费有效样本 ${costSamples.length} 个，均值约 ${averageDiningCost} 元（仅作环境代理）`:`高德未返回足够的餐饮人均消费样本`,`证据分类覆盖率 ${Math.round(consumptionCoverage*100)}%`],limitations:["消费环境等级不等同于居民收入、房价、租金或真实客单价。"]};

    const competitors=inside.filter(poi=>poi.category==="竞品门店").sort((a,b)=>a.distance-b.distance),same=competitors.filter(poi=>poi.competitor_relation==="同品牌竞品").length,other=competitors.length-same;
    const weighted=competitors.reduce((sum,poi)=>sum+(poi.distance<=300?30:poi.distance<=500?20:poi.distance<=800?12:poi.distance<=1000?8:4),0),competitionScore=benchmarkScore(weighted,[15,35,65,110]),nearest=competitors[0]||null;
    competitionByRadius[String(radius)]={radius,total:competitors.length,same_brand:same,other_brand:other,score:competitionScore,level:fourLevel(competitionScore),nearest:nearest?{name:nearest.name,brand:nearest.brand||"其他折扣零食",distance:nearest.distance,address:nearest.address||"",relation:nearest.competitor_relation||"异品牌竞品"}:null,evidence:[`范围内渠道竞品 ${competitors.length} 家，其中同品牌 ${same} 家、异品牌 ${other} 家`,nearest?`最近渠道竞品为${nearest.name}，直线距离 ${nearest.distance} 米`:"范围内未检索到折扣零食渠道竞品","渠道竞争分同时考虑数量和距离，300米内权重最高"]};
  }
  const primaryRadius=normalizedRadii.includes(500)?500:(normalizedRadii[0]||500);
  return {method:"基于高德POI的固定基准代理评分",scoring_version:"environment-proxy-v1",primary_radius:primaryRadius,residential_activity:{by_radius:residentialByRadius,limitations:["不代表住宅真实入住率。"]},consumption_environment:{by_radius:consumptionByRadius,limitations:["不代表真实收入、房价、租金或客单价。"]},competition_dashboard:{by_radius:competitionByRadius,limitations:["竞品以高德可检索到的折扣零食POI为准，可能存在新增、迁址或遗漏。"]}};
}

export function scorePoiEnvironment(counts:PoiCountMap,total:number,radius=500){
  const areaFactor=Math.min(4,(500/Math.max(100,radius))**2),normalized=(value:number)=>value*areaFactor;
  const residentialCount=counts["住宅小区"]||0;
  const educationCount=(counts["幼儿园"]||0)+(counts["小学"]||0)+(counts["中学"]||0);
  const commercialCount=(counts["购物中心"]||0)+(counts["超市"]||0)+(counts["便利店"]||0);
  const trafficCount=(counts["地铁站"]||0)+(counts["公交站"]||0);
  const healthcareCount=(counts["医院"]||0)+(counts["药店"]||0);
  const parkCount=counts["公园"]||0,competitorCount=counts["竞品门店"]||0;
  const diversityCount=Object.values(counts).filter(value=>value>0).length;
  const totalScore=benchmarkScore(normalized(total),[15,35,70,120]);
  const residential=benchmarkScore(normalized(residentialCount),[2,6,12,20]);
  const education=benchmarkScore(normalized(educationCount),[1,3,6,10]);
  const middleSchool=benchmarkScore(normalized(counts["中学"]||0),[1,2,4,7]);
  const commercial=benchmarkScore(normalized(commercialCount),[4,12,25,45]);
  const traffic=benchmarkScore(normalized(trafficCount),[1,3,6,12]);
  const healthcare=benchmarkScore(normalized(healthcareCount),[1,3,6,10]);
  const park=benchmarkScore(normalized(parkCount),[1,2,5,9]);
  const diversity=benchmarkScore(diversityCount,[2,4,7,10]);
  const competitionPressure=benchmarkScore(normalized(competitorCount),[1,2,4,7]);
  const competitionBalance=clamp(100-competitionPressure*.72);
  const shopping=benchmarkScore(normalized(counts["购物中心"]||0),[1,2,4,7]);
  const convenience=benchmarkScore(normalized((counts["超市"]||0)+(counts["便利店"]||0)),[3,8,18,32]);

  const levelScore=mix([[totalScore,.3],[diversity,.2],[commercial,.2],[traffic,.15],[residential,.15]]);
  const fitScore=mix([[residential,.25],[education,.2],[commercial,.25],[traffic,.15],[competitionBalance,.15]]);
  const audience=[
    {label:"学生与青少年",age_range:"6–18岁",index:mix([[education,.7],[traffic,.2],[commercial,.1]]),basis:`教育设施 ${educationCount} 个、交通设施 ${trafficCount} 个`},
    {label:"青年与年轻家庭",age_range:"19–35岁",index:mix([[commercial,.4],[traffic,.25],[residential,.2],[education,.15]]),basis:`商业设施 ${commercialCount} 个、交通设施 ${trafficCount} 个、住宅小区 ${residentialCount} 个`},
    {label:"家庭消费人群",age_range:"30–45岁",index:mix([[residential,.4],[education,.3],[commercial,.2],[traffic,.1]]),basis:`住宅小区 ${residentialCount} 个、教育设施 ${educationCount} 个`},
    {label:"中老年常住人群",age_range:"46岁以上",index:mix([[residential,.55],[healthcare,.3],[park,.15]]),basis:`住宅小区 ${residentialCount} 个、医疗药店 ${healthcareCount} 个、公园 ${parkCount} 个`},
  ].sort((a,b)=>b.index-a.index);
  const consumptionIndex=mix([[commercial,.45],[shopping,.2],[traffic,.15],[convenience,.2]]);

  return {
    levelScore,fitScore,competitionPressure,competitionBalance,consumptionIndex,audience,
    typeScores:{
      社区:mix([[residential,.5],[education,.3],[healthcare,.1],[park,.1]]),
      商业:mix([[commercial,.65],[shopping,.2],[traffic,.15]]),
      交通:mix([[traffic,.75],[commercial,.25]]),
      教育:mix([[education,.8],[residential,.2]]),
    },
    levelIndicators:{poi_total:totalScore,category_diversity:diversity,commercial,traffic},
    fitComponents:{residential,education,middle_school:middleSchool,commercial,traffic,competition_balance:competitionBalance},
    raw:{residential:residentialCount,education:educationCount,commercial:commercialCount,traffic:trafficCount,healthcare:healthcareCount,park:parkCount,competitors:competitorCount,total},
  };
}
