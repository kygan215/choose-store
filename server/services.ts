/* eslint-disable @typescript-eslint/no-explicit-any */
import { callDeepSeek, type AggregateStore } from "../app/api/deepseek.js";
import { scoreBand, scoreEnvironmentProxies, scorePoiEnvironment } from "../app/scoring.js";
import { discoverBrandStores as discoverBrandStoreRows, searchStoreCandidates } from "./store-search.js";
import { classifyResolutionCandidates, type StoreResolutionInput } from "./store-resolution.js";
import { query } from "./db.js";
import { activityCacheKey, forceRuleMetrics, normalizeActivityConfig, scoreParentChildActivity, type ActivityConfig } from "./activity-ai.js";

export type Row=Record<string,any>;
export type Poi={id:string;name:string;category:string;type:string;typecode:string;address:string;distance:number;location:[number,number];distance_bucket:string;brand?:string;competitor_relation?:"同品牌竞品"|"异品牌竞品";cost?:number;rating?:number};
export const POI_CATEGORY_TYPES:Record<string,string>={"住宅小区":"120302","幼儿园":"141204","小学":"141203","中学":"141202","购物中心":"060101","超市":"060400","便利店":"060200","餐饮服务":"050000","咖啡茶饮":"050500|050600","酒店":"100000","医院":"090100","药店":"090601","公园":"110101","地铁站":"150500","公交站":"150700"};
export const PROFILE_CATEGORIES=["住宅小区","幼儿园","小学","中学","购物中心","超市","便利店","餐饮服务","咖啡茶饮","酒店","药店","公园","地铁站","公交站","竞品门店"];
const SNACK_BRANDS=[
  ["零食很忙",/零食很忙/],["零食有鸣",/零食有鸣/],["赵一鸣零食",/赵一鸣/],["好想来零食",/好[想像]来/],
  ["爱零食",/爱零食/],["老婆大人",/老婆大人/],["来优品",/来优品/],["戴永红",/戴永红/],["糖巢",/糖巢/],["恰货铺子",/恰货铺子/],
] as const;
export function inferSnackBrand(value:unknown){const name=clean(value).replace(/\s+/g,"");return SNACK_BRANDS.find(([,pattern])=>pattern.test(name))?.[0]||"其他折扣零食"}
function looksLikeSnackCompetitor(value:unknown){const name=clean(value);return SNACK_BRANDS.some(([,pattern])=>pattern.test(name))||/(零食|量贩食品|食品折扣|折扣食品|休闲食品)/.test(name)}
let lastAmap=0;
const amapCache=new Map<string,{expires:number;data:Row}>();
export const clean=(value:unknown)=>String(value??"").trim();
const parseLocation=(value:unknown):[number,number]|null=>{const parts=clean(value).split(",").map(Number);return parts.length>=2&&parts.every(Number.isFinite)?[parts[0],parts[1]]:null};
const haversine=(a:[number,number],b:[number,number])=>{const r=6371000,toRad=(n:number)=>n*Math.PI/180,dLat=toRad(b[1]-a[1]),dLng=toRad(b[0]-a[0]),x=Math.sin(dLat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dLng/2)**2;return Math.round(2*r*Math.asin(Math.sqrt(x)))};
const distanceBucket=(distance:number,radii:number[])=>{const sorted=[...radii].sort((a,b)=>a-b),hit=sorted.find(radius=>distance<=radius);return hit?`≤${hit}米`:`>${sorted.at(-1)||500}米`};

async function amap(path:string,params:Record<string,unknown>){
  const key=process.env.AMAP_WEB_SERVICE_KEY;if(!key)throw new Error("高德 Web Service Key 尚未配置");const interval=Math.max(50,Number(process.env.AMAP_REQUEST_INTERVAL_MS||100));
  const cacheKey=`${path}?${Object.entries(params).sort(([left],[right])=>left.localeCompare(right)).map(([name,value])=>`${name}=${String(value)}`).join("&")}`,cached=amapCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.data;if(cached)amapCache.delete(cacheKey);
  for(let attempt=0;attempt<3;attempt++){const wait=interval-(Date.now()-lastAmap);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastAmap=Date.now();const url=new URL(`https://restapi.amap.com${path}`);Object.entries({...params,key}).forEach(([name,value])=>url.searchParams.set(name,String(value)));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(process.env.AMAP_REQUEST_TIMEOUT||15)*1000);try{const response=await fetch(url,{signal:controller.signal});const data=await response.json() as Row;if(String(data.status)==="1"){if(amapCache.size>=2000)amapCache.delete(amapCache.keys().next().value||"");amapCache.set(cacheKey,{expires:Date.now()+30*60*1000,data});return data}const code=clean(data.infocode);if(["10014","10015","10019","10020","10021","10022","10023"].includes(code)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1000));continue}throw new Error(code==="10003"?"高德地图当月调用额度已用完":`高德地图服务不可用：${clean(data.info)||code}`)}finally{clearTimeout(timer)}}throw new Error("高德地图请求失败");
}

export async function amapRequest(path:string,params:Record<string,unknown>){return amap(path,params)}

export async function searchCandidates(input:string,city="",district="",address=""){
  return searchStoreCandidates(amap,input,city,district,address);
}

export async function resolveStoreCandidates(input:Partial<StoreResolutionInput>&Row){
  const directPoiId=clean(input.poiId||input.poi_id),longitude=Number(input.longitude),latitude=Number(input.latitude),baseName=clean(input.searchName||input.name||input.originalName),address=clean(input.address);
  if(directPoiId){
    const data=await amap("/v5/place/detail",{id:directPoiId,show_fields:"business,navi,photos"}),rows=Array.isArray(data.pois)?data.pois as Row[]:[];
    const found=rows.length?await searchStoreCandidates(async()=>({status:"1",pois:rows}),baseName||clean(rows[0].name),clean(input.city),clean(input.district),address,1):[];
    if(found[0]){found[0].score=100;found[0].reasons.unshift("用户提供的高德 POI ID 完全一致");found[0].auto_confirm=true;found[0].status="高置信度";return found}
  }
  if(Number.isFinite(longitude)&&longitude>=73&&longitude<=136&&Number.isFinite(latitude)&&latitude>=3&&latitude<=54){
    const data=await amap("/v3/geocode/regeo",{location:`${longitude},${latitude}`,radius:1000,extensions:"base"}),component=(data.regeocode?.addressComponent||{}) as Row,actualCity=clean(component.city)||clean(component.province),actualDistrict=clean(component.district),expectedCity=clean(input.city).replace(/市$/,"");
    const cityConflict=Boolean(expectedCity&&actualCity&&!actualCity.includes(expectedCity)),score=cityConflict?70:95,conflicts=cityConflict?[`城市冲突：填写“${clean(input.city)}”，坐标位于“${actualCity}”`]:[];
    return [{id:`COORD-${longitude}-${latitude}`,name:baseName||address||"坐标定位门店",address:clean(data.regeocode?.formatted_address)||address,province:clean(component.province)||clean(input.province),city:actualCity||clean(input.city),district:actualDistrict||clean(input.district),location:[longitude,latitude] as [number,number],type:"用户坐标",typecode:"",score,status:cityConflict?"中置信度，待确认":"高置信度",reasons:["用户提供了有效经纬度","已通过高德逆地理编码核验行政区"],source:"input_coordinates",search_query:"",auto_confirm:!cityConflict,photos:[],conflicts,warnings:cityConflict?["坐标与填写城市不一致，禁止自动确认"]:[]}];
  }
  const poiCandidates=await searchStoreCandidates(amap,baseName,clean(input.city),clean(input.district),address,address?5:6);
  if(poiCandidates[0]?.auto_confirm||!address)return poiCandidates;
  const geoCandidates=await geocode({...input,name:baseName,address}),normalized=geoCandidates.map((candidate:any)=>({...candidate,id:String(candidate.id).toUpperCase(),score:Math.min(59,Number(candidate.score||58)),status:"地址定位结果，待确认",auto_confirm:false,photos:[],conflicts:[],warnings:["仅验证了地址位置，尚未验证门店身份"]}));
  return classifyResolutionCandidates([...poiCandidates,...normalized].sort((a,b)=>Number(b.score)-Number(a.score))).candidates;
}

export async function discoverBrandStores(brand:string,city:string,district="",request:typeof amap=amap,aliases:string[]=[]){
  return discoverBrandStoreRows(request,brand,city,district,{maxPagesPerRegion:Number(process.env.BRAND_DISCOVERY_MAX_PAGES_PER_REGION||20),maxRequests:Number(process.env.BRAND_DISCOVERY_MAX_REQUESTS||160),aliases});
}

export async function geocode(body:Row){const address=[body.province,body.city,body.district,body.address||body.name].map(clean).join(""),data=await amap("/v3/geocode/geo",{address,city:clean(body.city)}),rows=Array.isArray(data.geocodes)?data.geocodes as Row[]:[];return rows.map((item,index)=>{const location=parseLocation(item.location);return location?{id:`GEO-${index}`,name:clean(body.name)||clean(item.formatted_address),formatted_address:clean(item.formatted_address),address:clean(item.formatted_address),province:clean(item.province),city:clean(item.city)||clean(body.city),district:clean(item.district),adcode:clean(item.adcode),location,type:"地址定位",typecode:"",score:58,status:"地址定位结果，待确认",reasons:["根据详细地址完成地理编码"],source:"amap_geocode",auto_confirm:false,photos:[],conflicts:[],warnings:["仅验证了地址位置，尚未验证门店身份"]}:null}).filter(Boolean)};

export async function searchPois(store:Row,categories:string[],radii:number[],beforeRequest?:()=>Promise<void>){
  const maxRadius=Math.max(...radii),origin:[number,number]=[Number(store.longitude),Number(store.latitude)],items:Poi[]=[],maxPages=Math.max(1,Math.min(3,Number(process.env.AMAP_POI_MAX_PAGES||2))),targetBrand=inferSnackBrand(store.brand||store.input_name||store.standard_name),targetPoiId=clean(store.amap_poi_id);
  for(const category of [...new Set(categories)]){
    const types=POI_CATEGORY_TYPES[category]||"";
    for(let page=1;page<=maxPages;page++){
      const params:Row={location:origin.join(","),radius:maxRadius,sortrule:"distance",page_size:25,page_num:page,show_fields:"business,navi"};
      if(types)params.types=types;else params.keywords=category==="竞品门店"?"零食|量贩零食|折扣零食":category;
      if(beforeRequest)await beforeRequest();const data=await amap("/v5/place/around",params),rows=Array.isArray(data.pois)?data.pois as Row[]:[];
      for(const raw of rows){
        const location=parseLocation(raw.location),name=clean(raw.name),id=clean(raw.id);if(!location)continue;
        const distance=Number(raw.distance)||haversine(origin,location);if(category==="竞品门店"&&(!looksLikeSnackCompetitor(name)||id===targetPoiId||(distance<=20&&name===clean(store.standard_name))))continue;
        const business=(raw.business&&typeof raw.business==="object"?raw.business:{}) as Row,brand=category==="竞品门店"?inferSnackBrand(name):undefined;
        items.push({id,name,category,type:clean(raw.type),typecode:clean(raw.typecode),address:clean(raw.address),distance,location,distance_bucket:distanceBucket(distance,radii),brand,competitor_relation:category==="竞品门店"?(brand===targetBrand?"同品牌竞品":"异品牌竞品"):undefined,cost:Number(business.cost)>0?Number(business.cost):undefined,rating:Number(business.rating)>0?Number(business.rating):undefined});
      }
      if(rows.length<25)break;
    }
  }
  const unique=new Map<string,Poi>();for(const item of items){const key=item.id||`${item.name}|${item.location.join(",")}`;if(!unique.has(key))unique.set(key,item)}return [...unique.values()].sort((a,b)=>a.distance-b.distance)
}

export function createSummary(pois:Poi[]){const by_category:Record<string,number>={},by_distance:Record<string,number>={};for(const poi of pois){by_category[poi.category]=(by_category[poi.category]||0)+1;by_distance[poi.distance_bucket]=(by_distance[poi.distance_bucket]||0)+1}return {total:pois.length,by_category,by_distance}}

export type BusinessDistrictRadiusRecognition={radius:number;status:"已识别"|"证据不足";is_business_district:boolean|null;conclusion:string;strength:string;type:string;score:number;confidence:string;evidence:string[];missing_categories:string[];metrics:{commercial:number;shopping_centers:number;retail:number;competitors:number;transport:number;diversity:number;evidence_coverage:number}};
export type BusinessDistrictRecognition={method:string;primary_radius:number;by_radius:Record<string,BusinessDistrictRadiusRecognition>;limitations:string[]};

const BUSINESS_EVIDENCE_CATEGORIES=["购物中心","超市","便利店","地铁站","公交站","竞品门店"];
function categoryCounts(pois:Poi[]){const counts:Record<string,number>={};for(const poi of pois)counts[poi.category]=(counts[poi.category]||0)+1;return counts}

export function recognizeBusinessDistrict(pois:Poi[],radii:number[],analyzedCategories:string[]):BusinessDistrictRecognition{
  const normalizedRadii=[...new Set(radii.map(Number).filter(radius=>Number.isFinite(radius)&&radius>0))].sort((a,b)=>a-b),available=new Set(analyzedCategories),coverage=BUSINESS_EVIDENCE_CATEGORIES.filter(category=>available.has(category)).length/BUSINESS_EVIDENCE_CATEGORIES.length,missing=BUSINESS_EVIDENCE_CATEGORIES.filter(category=>!available.has(category));
  const byRadius:Record<string,BusinessDistrictRadiusRecognition>={};
  for(const radius of normalizedRadii){
    const inside=pois.filter(poi=>Number(poi.distance)<=radius),counts=categoryCounts(inside),shoppingCenters=counts["购物中心"]||0,retail=(counts["超市"]||0)+(counts["便利店"]||0),competitors=counts["竞品门店"]||0,transport=(counts["地铁站"]||0)+(counts["公交站"]||0),commercial=shoppingCenters+retail+competitors,diversity=["购物中心","超市","便利店","竞品门店"].filter(category=>(counts[category]||0)>0).length,areaScale=Math.min(1,(500/radius)**2),normalizedRetail=retail*areaScale,normalizedCompetitors=competitors*areaScale,normalizedTransport=transport*areaScale;
    const score=Math.min(100,Math.round((shoppingCenters>0?32:0)+Math.min(25,normalizedRetail*5)+Math.min(12,normalizedCompetitors*4)+Math.min(16,(counts["地铁站"]||0)*12+normalizedTransport*1.5)+Math.min(15,diversity*4)));
    const enoughEvidence=coverage>=0.5&&(commercial+transport)>=2,isBusiness=enoughEvidence?score>=50:null,strength=!enoughEvidence?"证据不足":score>=75?"成熟商圈":score>=60?"成形商圈":score>=50?"初步商圈":"未形成明显商圈",type=shoppingCenters>0||commercial>=6?"商业消费型":transport>commercial?"交通带动型":competitors>=3?"零售聚集型":"社区商业型",confidence=!enoughEvidence?"低":coverage>=0.8&&(commercial+transport)>=8?"较高":coverage>=0.65&&(commercial+transport)>=4?"中":"较低";
    const evidence=[`半径内商业相关 POI ${commercial} 个，其中购物中心 ${shoppingCenters} 个、超市及便利店 ${retail} 个、竞品门店 ${competitors} 个`,`交通 POI ${transport} 个，商业类别覆盖 ${diversity} 类`,`商圈证据分类覆盖率 ${Math.round(coverage*100)}%`];
    byRadius[String(radius)]={radius,status:enoughEvidence?"已识别":"证据不足",is_business_district:isBusiness,conclusion:isBusiness===null?"暂无法判断":isBusiness?"是，周边已呈现商圈特征":"否，暂未识别到明显商圈",strength,type,score,confidence,evidence,missing_categories:missing,metrics:{commercial,shopping_centers:shoppingCenters,retail,competitors,transport,diversity,evidence_coverage:Math.round(coverage*100)}};
  }
  const primaryRadius=normalizedRadii.includes(500)?500:(normalizedRadii[0]||500);
  return {method:"基于高德 POI 的规则识别",primary_radius:primaryRadius,by_radius:byRadius,limitations:["结论不等同于高德或政府发布的官方商圈边界。","未使用真实客流、订单、会员、租金或交易数据。","未勾选的证据分类不会被推定为 0；分类覆盖不足时返回证据不足。"]};
}

export function createAnalysis(store:Row,pois:Poi[],radii:number[],analyzedCategories:string[]=[]){
  const primaryRadius=radii.includes(500)?500:Math.min(...radii),scoringPois=pois.filter(poi=>poi.distance<=primaryRadius),counts=createSummary(scoringPois).by_category,total=scoringPois.length;
  const scored=scorePoiEnvironment(counts,total,primaryRadius),raw=scored.raw,created=new Date().toISOString(),proxies=scoreEnvironmentProxies(pois,radii,analyzedCategories.length?analyzedCategories:[...new Set(pois.map(poi=>poi.category))]),residential=((proxies.residential_activity.by_radius as Record<string,Row>)[String(primaryRadius)]||{}),consumption=((proxies.consumption_environment.by_radius as Record<string,Row>)[String(primaryRadius)]||{}),competition=((proxies.competition_dashboard.by_radius as Record<string,Row>)[String(primaryRadius)]||{});
  const type=scored.typeScores.教育>=Math.max(scored.typeScores.商业,scored.typeScores.交通)?"社区家庭型":scored.typeScores.商业>=scored.typeScores.社区?"商业消费型":scored.typeScores.交通>=60?"交通通勤型":"综合生活型";
  const levelName=scored.levelScore>=80?"高成熟":scored.levelScore>=60?"成熟":scored.levelScore>=40?"成长":"基础";
  return {id:Number(store.id),analysis_version:"server-v4",scoring_version:"environment-proxy-v1",radius_config:radii,confidence_level:total>=15?"中":total>=5?"较低":"低",business_area:{name:clean(store.district)||clean(store.city)||"门店周边",source:"高德POI代理判断",confidence:total>=15?"中":"低"},business_district_type:{type,scores:scored.typeScores,confidence:total>=15?"中":"低"},level:{level:levelName,score:scored.levelScore,mode:`${primaryRadius}米固定基准分层`},fit:{score:scored.fitScore,level:scoreBand(scored.fitScore)},competition:{score:Number(competition.score??scored.competitionPressure),level:clean(competition.level)||scoreBand(scored.competitionPressure)},environment_proxies:proxies,feature_vector:{layers:{[String(primaryRadius)]:{total,density:total,counts,nearest:{}}},level_indicators:scored.levelIndicators,fit_components:{...scored.fitComponents,residential_activity:Number(residential.score||0),consumption_environment:Number(consumption.score||0)}},audience_profile:{method:"基于周边设施结构的固定基准代理推断",confidence:total>=15?"中":"低",primary_groups:scored.audience.slice(0,2),age_segments:scored.audience,consumption_power:{level:clean(consumption.level)||"偏低",index:Number(consumption.score||0),confidence:clean(consumption.confidence)||"低",basis:Array.isArray(consumption.evidence)?consumption.evidence.join("；"):`商业 ${raw.commercial} 个、交通 ${raw.traffic} 个；不等同于真实收入统计`},residential_activity:{level:clean(residential.level)||"低",index:Number(residential.score||0),confidence:clean(residential.confidence)||"低",basis:Array.isArray(residential.evidence)?residential.evidence.join("；"):"高德POI设施代理判断"},mall_profile:{level:(counts["购物中心"]||0)>=2?"区域商业较集中":(counts["购物中心"]||0)?"存在商场辐射":"社区商业为主",confidence:"低",sample_count:counts["购物中心"]||0,sample_names:[],basis:"依据购物中心POI数量推断"},summary:[`周边更可能以${scored.audience[0].label}和${scored.audience[1].label}为主要潜在人群。`,`住宅活跃度${clean(residential.level)||"低"}，消费环境${clean(consumption.level)||"偏低"}。`],evidence:[`评分基于${primaryRadius}米内 ${total} 个有效 POI`,`各指标采用固定基准点与边际递减曲线，可跨门店横向比较`],limitations:["结果是POI环境代理推断，不是人口普查、客流或收入数据。","住宅活跃度不等同于真实入住率；消费环境不等同于房价、租金或客单价。"]},strengths:[total>=15?"周边设施样本较充足":"已形成基础设施样本"],weaknesses:[total<15?"POI样本较少":"缺少真实订单和会员数据"],warning_messages:["评分用于同口径门店比较，请勿解释为实际人口比例、入住率或消费收入"],disclaimer:"本分析仅反映高德POI设施分布及其固定基准代理推断。",created_at:created,poi_summary:createSummary(pois)}
}

export function createEnhancedAnalysis(store:Row,pois:Poi[],radii:number[],analyzedCategories:string[]=[]){
  const inferredCategories=[...new Set(pois.map(poi=>poi.category))],categories=analyzedCategories.length?analyzedCategories:inferredCategories,base=createAnalysis(store,pois,radii,categories),counts=createSummary(pois).by_category,middleSchools=counts["中学"]||0,education=(counts["幼儿园"]||0)+(counts["小学"]||0)+middleSchools,recognition=recognizeBusinessDistrict(pois,radii,categories),primary=recognition.by_radius[String(recognition.primary_radius)],layers:Record<string,Row>={};
  for(const radius of [...new Set(radii)].sort((a,b)=>a-b)){const inside=pois.filter(poi=>poi.distance<=radius);layers[String(radius)]={total:inside.length,density:inside.length,counts:categoryCounts(inside),nearest:{}}}
  const ageSegments=base.audience_profile.age_segments;
  return {...base,analysis_version:"server-v4",business_area:{name:`门店周边${recognition.primary_radius}米`,source:recognition.method,confidence:primary?.confidence||"低"},business_district_type:{type:primary?.is_business_district?primary.type:base.business_district_type.type,scores:base.business_district_type.scores,confidence:primary?.confidence||base.business_district_type.confidence},business_district_recognition:recognition,feature_vector:{...base.feature_vector,layers},audience_profile:{...base.audience_profile,age_segments:ageSegments,primary_groups:ageSegments.slice(0,2),evidence:[...base.audience_profile.evidence,`教育设施 ${education} 个，其中中学 ${middleSchools} 个`],limitations:[...base.audience_profile.limitations,...recognition.limitations]},disclaimer:"本分析基于高德 POI 的设施分布和固定基准规则识别，不等同于官方商圈边界、真实入住率、客流、人口、房价、租金或消费交易数据。"};
}

export function aggregateStore(label:string,pois:Poi[],radii:number[]):AggregateStore{return {label,circles:[...new Set(radii)].sort((a,b)=>a-b).map(radius=>{const inside=pois.filter(poi=>poi.distance<=radius),counts:Record<string,number>={};for(const poi of inside)counts[poi.category]=(counts[poi.category]||0)+1;return {radius,total:inside.length,counts}}),environment_proxies:scoreEnvironmentProxies(pois,radii,[...new Set(pois.map(poi=>poi.category))]) as unknown as Record<string,unknown>}}

export async function generateAi(tenantId:number,createdBy:number,scope:"single"|"comparison",stores:AggregateStore[],jobId:number|null,storeId:number|null,storeIds:number[],options:{activityConfig?:ActivityConfig;cacheKey?:string}={}){const apiKey=process.env.DEEPSEEK_API_KEY||"";if(!apiKey)throw new Error("DeepSeek API Key 尚未配置");const model=process.env.DEEPSEEK_MODEL||"deepseek-v4-flash",activityConfig=scope==="single"?normalizeActivityConfig(options.activityConfig):undefined,metrics=scope==="single"&&stores[0]?scoreParentChildActivity(stores[0]):undefined,cacheKey=scope==="single"&&stores[0]&&activityConfig?(options.cacheKey||activityCacheKey(stores[0],activityConfig)):null,generated=await callDeepSeek({apiKey,apiBaseUrl:process.env.DEEPSEEK_API_BASE_URL||"https://api.deepseek.com",model,scope,stores,activityConfig:activityConfig as unknown as Record<string,string>,ruleMetrics:metrics as unknown as Record<string,unknown>}),usage=generated.usage,finalResult=metrics?forceRuleMetrics(generated.result,metrics):generated.result,result=await query<{id:number;created_at:string}>("INSERT INTO ai_analyses(tenant_id,created_by,scope,job_id,store_id,store_ids_json,input_json,result_json,model,prompt_version,input_tokens,output_tokens,total_tokens,cache_key,activity_config_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,created_at",[tenantId,createdBy,scope,jobId,storeId,JSON.stringify(storeIds),JSON.stringify({scope,stores,activity_config:activityConfig,cache_key:cacheKey}),JSON.stringify(finalResult),model,generated.promptVersion,Number(usage.prompt_tokens||0),Number(usage.completion_tokens||0),Number(usage.total_tokens||0),cacheKey,JSON.stringify(activityConfig||{})]),saved=result.rows[0];return {id:Number(saved.id),scope,job_id:jobId,store_id:storeId,store_ids:storeIds,result:finalResult,model,prompt_version:generated.promptVersion,cache_key:cacheKey,usage:{input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),total_tokens:Number(usage.total_tokens||0)},created_at:saved.created_at}}
