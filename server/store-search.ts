import { classifyResolutionCandidates } from "./store-resolution.js";

export type SearchRow=Record<string,unknown>;
export type StorePhoto={title:string;url:string};
export type StoreCandidate={
  id:string;name:string;address:string;province:string;city:string;district:string;
  location:[number,number];type:string;typecode:string;score:number;status:string;
  reasons:string[];source:string;search_query:string;auto_confirm:boolean;photos:StorePhoto[];conflicts:string[];warnings:string[];
};
export type StoreSearchPlan={
  original:string;brand:string;core:string;province:string;city:string;district:string;
  region:string;queries:string[];brand_aliases:string[];location_hints:string[];address_hints:string[];
};
export type AmapSearch=(path:string,params:Record<string,string|number|boolean>)=>Promise<SearchRow>;
export type BrandStoreDiscoveryResult={
  stores:StoreCandidate[];brand:string;city:string;district:string;regions:string[];
  requests:number;page_size:number;truncated:boolean;complete:boolean;
};

const BRAND_GROUPS=[
  {canonical:"零食很忙",aliases:["零食很忙"]},
  {canonical:"赵一鸣零食",aliases:["赵一鸣零食","赵一鸣"]},
  {canonical:"来伊份",aliases:["来伊份"]},
  {canonical:"良品铺子",aliases:["良品铺子"]},
  {canonical:"好想来零食",aliases:["好想来零食乐园","好想来品牌零食","好想来零食","好想来"]},
];
const PROVINCES=["北京","天津","河北","山西","内蒙古","辽宁","吉林","黑龙江","上海","江苏","浙江","安徽","福建","江西","山东","河南","湖北","湖南","广东","广西","海南","重庆","四川","贵州","云南","西藏","陕西","甘肃","青海","宁夏","新疆","香港","澳门","台湾"];
const WUHAN_DISTRICTS=["江汉","江岸","硚口","汉阳","武昌","青山","洪山","东西湖","汉南","蔡甸","江夏","黄陂","新洲","东湖高新"];

const clean=(value:unknown)=>String(value??"").trim();
export const normalizeStoreName=(value:string)=>clean(value).toLowerCase().replace(/[\s（）()【】\[\]·,，.。/\\\-_]/g,"").replace(/分店|门店|店$/g,"");
const withoutSuffix=(value:string,suffixes:string[])=>{let result=clean(value);for(const suffix of suffixes)if(result.endsWith(suffix)){result=result.slice(0,-suffix.length);break}return result};
const unique=(values:string[])=>[...new Set(values.map(clean).filter(Boolean))];
const parseLocation=(value:unknown):[number,number]|null=>{const parts=clean(value).split(",").map(Number);return parts.length>=2&&parts.every(Number.isFinite)?[parts[0],parts[1]]:null};
export function normalizeStorePhotos(value:unknown):StorePhoto[]{
  const rows=Array.isArray(value)?value:value&&typeof value==="object"?[value]:[],photos:StorePhoto[]=[],seen=new Set<string>();
  for(const item of rows){
    if(!item||typeof item!=="object")continue;
    const row=item as SearchRow;let url=clean(row.url);if(!url)continue;
    if(url.startsWith("http://"))url=`https://${url.slice(7)}`;
    try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))continue}catch{continue}
    if(seen.has(url))continue;seen.add(url);
    photos.push({title:clean(row.title)||"门店现场照片",url});if(photos.length>=12)break;
  }
  return photos;
}
const includesRegion=(actual:string,expected:string,suffix:RegExp)=>{const token=clean(expected).replace(suffix,"");return Boolean(token)&&clean(actual).includes(token)};
function parseRegionPath(value:unknown){
  let rest=clean(value);let province="",city="",district="";
  const provinceMatch=rest.match(/^(.+?(?:特别行政区|自治区|省|市))/);
  if(provinceMatch){province=provinceMatch[1];rest=rest.slice(province.length)}
  const cityMatch=rest.match(/^(.+?(?:自治州|地区|盟|市))/);
  if(cityMatch){city=cityMatch[1];rest=rest.slice(city.length)}
  else if(["北京市","天津市","上海市","重庆市"].includes(province))city=province;
  const districtMatch=rest.match(/^(.+(?:自治县|林区|新区|区|县|旗|市))$/);
  if(districtMatch)district=districtMatch[1];
  return {province,city,district};
}

function findBrand(value:string){
  const normalized=normalizeStoreName(value);
  return BRAND_GROUPS.map(group=>({group,alias:[...group.aliases].sort((a,b)=>b.length-a.length).find(alias=>normalized.startsWith(normalizeStoreName(alias)))})).find(item=>item.alias);
}

export function deriveStoreSearchInput(input:string,address:string){
  const explicit=clean(input);if(explicit)return explicit;
  const lines=clean(address).split(/[\r\n]+/).map(clean).filter(Boolean),candidates=[...lines].reverse();
  for(const line of candidates){
    for(const group of BRAND_GROUPS){
      for(const alias of [...group.aliases].sort((a,b)=>b.length-a.length)){
        const index=line.indexOf(alias);if(index<0)continue;
        const before=line.slice(0,index).replace(/[（(]\s*$/,"").trim(),after=line.slice(index+alias.length).replace(/^\s*[）)]/,"").trim();
        if(after&&normalizeStoreName(after).length>=2)return `${group.canonical}${after}`;
        if(before){const localName=before.slice(-18);return `${group.canonical}${localName}${/店$/.test(localName)?"":"店"}`}
        return group.canonical;
      }
    }
  }
  return candidates[0]||clean(address);
}

function stripBrand(value:string,aliases:string[]){
  const normalized=normalizeStoreName(value);
  for(const alias of [...aliases].sort((a,b)=>b.length-a.length)){
    const token=normalizeStoreName(alias);
    if(normalized.startsWith(token))return normalized.slice(token.length);
  }
  return normalized;
}

function normalizeGeographicText(value:string){
  return normalizeStoreName(value)
    .replace(/(?:大道|大街|公路|街道|街|路)/g,"路")
    .replace(/(?:省|自治区|特别行政区|市|区|县|旗)/g,"")
    .replace(/\d+号?/g,"");
}

function extractLocationHints(value:string){
  const text=normalizeStoreName(value),hints:string[]=[];
  const suffixPattern=/(街道|大街|大道|公路|路|镇|乡|县|区|市)/g;
  let previousEnd=0,match:RegExpExecArray|null;
  while((match=suffixPattern.exec(text))){
    const segment=text.slice(previousEnd,match.index),base=segment.slice(-2);
    if(base.length===2)hints.push(normalizeGeographicText(`${base}${match[0]}`));
    previousEnd=match.index+match[0].length;
  }
  return unique(hints.filter(item=>item.length>=2));
}

function stripPrefix(value:string,aliases:string[]){
  let result=value;
  for(const alias of unique(aliases).sort((a,b)=>b.length-a.length)){
    if(result.startsWith(alias)){result=result.slice(alias.length);break}
  }
  return result;
}

export function buildStoreSearchPlan(input:string,city="",district=""):StoreSearchPlan{
  const original=clean(input),brandMatch=findBrand(original),brand=brandMatch?.group.canonical||"",brandAliases=brandMatch?.group.aliases||[];
  let remainder=brandMatch?.alias?original.slice(brandMatch.alias.length):original;
  const provinceToken=PROVINCES.find(item=>remainder.startsWith(item))||"";
  const province=provinceToken?`${provinceToken}${["北京","天津","上海","重庆","香港","澳门"].includes(provinceToken)?"市":"省"}`:"";
  remainder=stripPrefix(remainder,provinceToken?[provinceToken,`${provinceToken}省`,`${provinceToken}市`]:[]);

  const suppliedCity=withoutSuffix(city,["市","地区","自治州","盟"]),wuhanInName=remainder.startsWith("武汉市")||remainder.startsWith("武汉");
  const inferredCity=suppliedCity||(wuhanInName?"武汉":"");
  remainder=stripPrefix(remainder,[city,suppliedCity,inferredCity,`${inferredCity}市`]);

  const suppliedDistrict=withoutSuffix(district,["区","县","市"]);
  const wuhanDistrict=WUHAN_DISTRICTS.find(item=>remainder.startsWith(item))||"";
  const inferredDistrict=suppliedDistrict||wuhanDistrict;
  remainder=stripPrefix(remainder,[district,suppliedDistrict,inferredDistrict,`${inferredDistrict}区`,`${inferredDistrict}县`]);

  const core=clean(remainder).replace(/(?:分店|门店|店)$/g,"")||normalizeStoreName(original).replace(normalizeStoreName(brand),"");
  const resolvedCity=clean(city)||(inferredCity?`${inferredCity}市`:"");
  const resolvedDistrict=clean(district)||(inferredDistrict?`${inferredDistrict}区`:"");
  const compact=brand&&core?`${brand}${core}店`:core;
  const queries=unique([original,compact,brand&&core?`${brand} ${core}`:"",core,brand&&core?`${core} ${brand}`:""]);
  return {original,brand,core,province,city:resolvedCity,district:resolvedDistrict,region:resolvedCity,queries,brand_aliases:brandAliases,location_hints:extractLocationHints(`${resolvedCity}${resolvedDistrict}${core}`),address_hints:[]};
}

function bigrams(value:string){const text=normalizeStoreName(value);if(text.length<2)return new Set(text?[text]:[]);return new Set(Array.from({length:text.length-1},(_,index)=>text.slice(index,index+2)))}
function dice(a:string,b:string){const left=bigrams(a),right=bigrams(b);if(!left.size||!right.size)return 0;let common=0;for(const token of left)if(right.has(token))common++;return 2*common/(left.size+right.size)}
function coverage(a:string,b:string){const left=bigrams(a),right=bigrams(b);if(!left.size||!right.size)return 0;let common=0;for(const token of left)if(right.has(token))common++;return common/left.size}

export function scoreStoreCandidate(raw:SearchRow,plan:StoreSearchPlan,source="text",searchQuery=""):StoreCandidate|null{
  const location=parseLocation(raw.location);if(!location)return null;
  const name=clean(raw.name),address=clean(raw.address),regionPath=parseRegionPath(raw.district);
  const poiProvince=clean(raw.pname||raw.province)||regionPath.province||plan.province;
  const poiCity=clean(raw.cityname||raw.city)||regionPath.city||plan.city;
  const poiDistrict=clean(raw.adname)||regionPath.district||(regionPath.province||regionPath.city?"":clean(raw.district))||plan.district;
  const normalizedName=normalizeStoreName(name),brandToken=normalizeStoreName(plan.brand),coreToken=normalizeStoreName(plan.core),target=normalizeStoreName(`${plan.brand}${plan.core}`);
  const candidateBrand=findBrand(name),brandMatch=!brandToken||candidateBrand?.group.canonical===plan.brand;
  const candidateCore=stripBrand(name,candidateBrand?.group.aliases||plan.brand_aliases);
  const coreMatch=Boolean(coreToken)&&(candidateCore.includes(coreToken)||coreToken.includes(candidateCore));
  const similarity=dice(coreToken,candidateCore);
  const geographicTarget=normalizeGeographicText(`${plan.city}${plan.district}${plan.core}`),geographicEvidence=normalizeGeographicText(`${name}${poiCity}${poiDistrict}${address}`);
  const geographicCoverage=coverage(geographicTarget,geographicEvidence),matchedHints=plan.location_hints.filter(hint=>geographicEvidence.includes(hint)),matchedAddressHints=plan.address_hints.filter(hint=>geographicEvidence.includes(hint)),addressConflict=plan.address_hints.length>0&&matchedAddressHints.length===0;
  let score=10;
  if(normalizedName===target)score=88;
  else {if(brandMatch)score+=25;else if(plan.brand)score-=20;if(coreMatch)score+=30;score+=Math.round(similarity*18);score+=Math.round(geographicCoverage*38);score+=Math.min(16,matchedHints.length*8)}
  const cityMatch=includesRegion(poiCity,plan.city,/市$/),districtMatch=includesRegion(poiDistrict,plan.district,/[区县市]$/);
  if(cityMatch)score+=8;if(districtMatch)score+=6;if(source==="landmark_nearby")score+=4;
  score=Math.max(0,Math.min(100,score));
  if(plan.brand&&!brandMatch)score=Math.min(score,60);
  const strongGeographicMatch=(matchedHints.length>=2&&geographicCoverage>=0.45)||geographicCoverage>=0.72||(matchedHints.length>=1&&geographicCoverage>=0.58);
  if(addressConflict)score=Math.max(0,score-15);
  const autoConfirm=score>=85&&brandMatch&&!addressConflict&&(coreMatch||similarity>=0.72||strongGeographicMatch);
  const reasons=[
    normalizedName===target?"标准化后的门店名称完全一致":coreMatch?`核心店名“${plan.core}”一致`:"按名称与地址地理要素综合排序",
    brandMatch&&plan.brand?`品牌“${plan.brand}”一致`:"品牌信息不足",
    ...(matchedHints.length?[`地理关键词“${matchedHints.join("、")}”一致（道路名称已兼容路/街/大道等写法）`]:[]),
    ...(matchedAddressHints.length?[`详细地址关键词“${matchedAddressHints.join("、")}”一致`]:[]),
    ...(geographicCoverage>=0.55?[`城市、区县、乡镇或道路信息相似度较高`]:[]),
    ...(cityMatch?["城市一致"]:[]),...(districtMatch?["区县一致"]:[]),
    ...(source==="landmark_nearby"?[`以“${plan.core}”为地标完成周边品牌回退搜索`]:[]),
  ];
  const conflicts=[...(!brandMatch&&plan.brand?[`品牌冲突：期望“${plan.brand}”，候选为“${candidateBrand?.group.canonical||name}”`]:[]),...(plan.city&&poiCity&&!cityMatch?[`城市冲突：期望“${plan.city}”，候选为“${poiCity}”`]:[]),...(addressConflict?["详细地址关键词与候选名称及地址未对应"]:[])];
  return {id:clean(raw.id)||`${name}|${location.join(",")}`,name,address,province:poiProvince,city:poiCity,district:poiDistrict,location,type:clean(raw.type),typecode:clean(raw.typecode),score,status:autoConfirm?"高置信度":score>=55?"中置信度":"低置信度",reasons,source,search_query:searchQuery,auto_confirm:autoConfirm,photos:normalizeStorePhotos(raw.photos),conflicts,warnings:[]};
}

function mergeCandidate(target:Map<string,StoreCandidate>,candidate:StoreCandidate|null){
  if(!candidate)return;
  const key=candidate.id||`${candidate.name}|${candidate.location.join(",")}`,existing=target.get(key);
  if(!existing||candidate.score>existing.score)target.set(key,candidate);
  else {existing.reasons=unique([...existing.reasons,...candidate.reasons]);existing.photos=normalizeStorePhotos([...existing.photos,...candidate.photos])}
}

function brandMatches(name:string,terms:string[]){
  const normalized=normalizeStoreName(name);
  return terms.some(term=>normalized.includes(normalizeStoreName(term)));
}

function discoveryCandidate(raw:SearchRow,brand:string,terms:string[]):StoreCandidate|null{
  const location=parseLocation(raw.location),name=clean(raw.name);if(!location||!name||!brandMatches(name,terms))return null;
  const regionPath=parseRegionPath(raw.district),province=clean(raw.pname||raw.province)||regionPath.province,city=clean(raw.cityname||raw.city)||regionPath.city,district=clean(raw.adname)||regionPath.district;
  return {id:clean(raw.id)||`${name}|${location.join(",")}`,name,address:clean(raw.address),province,city,district,location,type:clean(raw.type),typecode:clean(raw.typecode),score:100,status:"品牌命中",reasons:[`门店名称包含品牌关键词“${brand}”`,`来自高德品牌门店分页查询`],source:"brand_discovery",search_query:brand,auto_confirm:true,photos:normalizeStorePhotos(raw.photos),conflicts:[],warnings:[]};
}

export async function discoverBrandStores(amap:AmapSearch,brandInput:string,cityInput:string,districtInput="",options:{maxPagesPerRegion?:number;maxRequests?:number;aliases?:string[]}={}):Promise<BrandStoreDiscoveryResult>{
  const brand=clean(brandInput),city=clean(cityInput),district=clean(districtInput);if(!brand)throw new Error("请输入品牌名称");if(!city)throw new Error("请输入城市");
  const plan=buildStoreSearchPlan(brand,city,district),terms=unique([plan.brand||brand,...plan.brand_aliases,...(options.aliases||[]),brand]),maxPages=Math.max(1,Math.min(100,Number(options.maxPagesPerRegion||20))),maxRequests=Math.max(1,Math.min(500,Number(options.maxRequests||160))),pageSize=25;
  let requests=0,truncated=false;const regions:Array<{label:string;value:string}>=[];
  if(district)regions.push({label:district,value:district});
  else{
    try{
      if(requests>=maxRequests)truncated=true;
      else{
        requests++;const data=await amap("/v3/config/district",{keywords:city,subdistrict:1,extensions:"base"}),roots=Array.isArray(data.districts)?data.districts as SearchRow[]:[],children=roots.length&&Array.isArray(roots[0].districts)?roots[0].districts as SearchRow[]:[];
        for(const child of children){const label=clean(child.name),value=clean(child.adcode)||label;if(label&&value)regions.push({label,value})}
      }
    }catch{/* 行政区接口不可用时退回城市级分页。 */}
  }
  if(!regions.length)regions.push({label:district||city,value:district||city});
  const found=new Map<string,StoreCandidate>();
  outer:for(const region of regions){
    for(const keyword of terms){
      for(let page=1;page<=maxPages;page++){
        if(requests>=maxRequests){truncated=true;break outer}
        requests++;const data=await amap("/v5/place/text",{keywords:keyword,region:region.value,city_limit:true,show_fields:"business,navi",page_size:pageSize,page_num:page}),rows=Array.isArray(data.pois)?data.pois as SearchRow[]:[];
        for(const row of rows)mergeCandidate(found,discoveryCandidate(row,plan.brand||brand,terms));
        if(rows.length<pageSize)break;
        if(page===maxPages)truncated=true;
      }
    }
  }
  const stores=[...found.values()].sort((a,b)=>a.district.localeCompare(b.district,"zh-CN")||a.name.localeCompare(b.name,"zh-CN"));
  return {stores,brand:plan.brand||brand,city,district,regions:regions.map(item=>item.label),requests,page_size:pageSize,truncated,complete:!truncated};
}

export async function searchStoreCandidates(amap:AmapSearch,input:string,city="",district="",address="",maxRequests=6){
  const searchInput=deriveStoreSearchInput(input,address);if(!searchInput)return [];
  const plan=buildStoreSearchPlan(searchInput,city,district),found=new Map<string,StoreCandidate>();
  const addressText=clean(address),addressDerived=addressText?deriveStoreSearchInput("",addressText):"";
  plan.address_hints=extractLocationHints(addressText);plan.location_hints=unique([...plan.location_hints,...plan.address_hints]);
  plan.queries=unique([plan.original,plan.queries[1],addressDerived!==searchInput?addressDerived:"",addressText,plan.core,...plan.queries.slice(2)]);
  let requestCount=0;const call:AmapSearch=(path,params)=>requestCount>=Math.max(1,maxRequests)?Promise.resolve({status:"1",pois:[],tips:[]}):(requestCount++,amap(path,params));
  let anchorRows:SearchRow[]=[];
  for(const query of plan.queries){
    if(requestCount>=Math.max(1,maxRequests-2))break;
    const params:Record<string,string|number|boolean>={keywords:query,show_fields:"business,navi,photos",page_size:20,page_num:1};
    if(plan.region){params.region=plan.region;params.city_limit=true}
    const data=await call("/v5/place/text",params),rows=Array.isArray(data.pois)?data.pois as SearchRow[]:[];
    if(query===plan.core)anchorRows=rows;
    for(const row of rows)mergeCandidate(found,scoreStoreCandidate(row,plan,"text",query));
    const best=[...found.values()].sort((a,b)=>b.score-a.score)[0];
    if(best?.auto_confirm&&best.score>=90)break;
  }
  let ranked=[...found.values()].sort((a,b)=>b.score-a.score);
  if(!ranked.some(item=>item.auto_confirm)){
    const params:Record<string,string|number|boolean>={keywords:plan.original};
    if(plan.region){params.city=plan.region;params.citylimit=true}
    const tipData=await call("/v3/assistant/inputtips",params),tips=Array.isArray(tipData.tips)?tipData.tips as SearchRow[]:[];
    for(const tip of tips)mergeCandidate(found,scoreStoreCandidate(tip,plan,"inputtips",plan.original));
    ranked=[...found.values()].sort((a,b)=>b.score-a.score);
  }
  if(!ranked.some(item=>item.auto_confirm)&&plan.brand&&plan.core){
    if(!anchorRows.length){
      const params:Record<string,string|number|boolean>={keywords:plan.core,show_fields:"business,navi,photos",page_size:10,page_num:1};
      if(plan.region){params.region=plan.region;params.city_limit=true}
      const anchorData=await call("/v5/place/text",params);anchorRows=Array.isArray(anchorData.pois)?anchorData.pois as SearchRow[]:[];
    }
    const anchor=anchorRows.map(row=>({row,location:parseLocation(row.location)})).find(item=>item.location);
    if(anchor?.location){
      const nearby=await call("/v5/place/around",{location:anchor.location.join(","),radius:3000,keywords:plan.brand,sortrule:"distance",show_fields:"business,navi,photos",page_size:25,page_num:1});
      for(const row of (Array.isArray(nearby.pois)?nearby.pois as SearchRow[]:[]))mergeCandidate(found,scoreStoreCandidate(row,plan,"landmark_nearby",plan.brand));
    }
    ranked=[...found.values()].sort((a,b)=>b.score-a.score);
  }
  if(address)ranked=ranked.map(item=>({...item,reasons:unique([...item.reasons,"已参考用户填写的详细地址"])}));
  return classifyResolutionCandidates(ranked.slice(0,20)).candidates;
}
