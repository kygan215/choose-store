export type SearchRow=Record<string,unknown>;
export type StoreCandidate={
  id:string;name:string;address:string;province:string;city:string;district:string;
  location:[number,number];type:string;typecode:string;score:number;status:string;
  reasons:string[];source:string;search_query:string;auto_confirm:boolean;
};
export type StoreSearchPlan={
  original:string;brand:string;core:string;province:string;city:string;district:string;
  region:string;queries:string[];brand_aliases:string[];location_hints:string[];
};
export type AmapSearch=(path:string,params:Record<string,string|number|boolean>)=>Promise<SearchRow>;

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
const includesRegion=(actual:string,expected:string,suffix:RegExp)=>{const token=clean(expected).replace(suffix,"");return Boolean(token)&&clean(actual).includes(token)};

function findBrand(value:string){
  const normalized=normalizeStoreName(value);
  return BRAND_GROUPS.map(group=>({group,alias:[...group.aliases].sort((a,b)=>b.length-a.length).find(alias=>normalized.startsWith(normalizeStoreName(alias)))})).find(item=>item.alias);
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
  const queries=unique([original,compact,brand&&core?`${brand} ${core}`:"",brand&&core?`${core} ${brand}`:"",core]);
  return {original,brand,core,province,city:resolvedCity,district:resolvedDistrict,region:resolvedCity,queries,brand_aliases:brandAliases,location_hints:extractLocationHints(`${resolvedCity}${resolvedDistrict}${core}`)};
}

function bigrams(value:string){const text=normalizeStoreName(value);if(text.length<2)return new Set(text?[text]:[]);return new Set(Array.from({length:text.length-1},(_,index)=>text.slice(index,index+2)))}
function dice(a:string,b:string){const left=bigrams(a),right=bigrams(b);if(!left.size||!right.size)return 0;let common=0;for(const token of left)if(right.has(token))common++;return 2*common/(left.size+right.size)}
function coverage(a:string,b:string){const left=bigrams(a),right=bigrams(b);if(!left.size||!right.size)return 0;let common=0;for(const token of left)if(right.has(token))common++;return common/left.size}

export function scoreStoreCandidate(raw:SearchRow,plan:StoreSearchPlan,source="text",searchQuery=""):StoreCandidate|null{
  const location=parseLocation(raw.location);if(!location)return null;
  const name=clean(raw.name),address=clean(raw.address),poiCity=clean(raw.cityname||raw.city),poiDistrict=clean(raw.adname||raw.district);
  const normalizedName=normalizeStoreName(name),brandToken=normalizeStoreName(plan.brand),coreToken=normalizeStoreName(plan.core),target=normalizeStoreName(`${plan.brand}${plan.core}`);
  const candidateBrand=findBrand(name),brandMatch=!brandToken||candidateBrand?.group.canonical===plan.brand;
  const candidateCore=stripBrand(name,candidateBrand?.group.aliases||plan.brand_aliases);
  const coreMatch=Boolean(coreToken)&&(candidateCore.includes(coreToken)||coreToken.includes(candidateCore));
  const similarity=dice(coreToken,candidateCore);
  const geographicTarget=normalizeGeographicText(`${plan.city}${plan.district}${plan.core}`),geographicEvidence=normalizeGeographicText(`${name}${poiCity}${poiDistrict}${address}`);
  const geographicCoverage=coverage(geographicTarget,geographicEvidence),matchedHints=plan.location_hints.filter(hint=>geographicEvidence.includes(hint));
  let score=10;
  if(normalizedName===target)score=88;
  else {if(brandMatch)score+=25;else if(plan.brand)score-=20;if(coreMatch)score+=30;score+=Math.round(similarity*18);score+=Math.round(geographicCoverage*38);score+=Math.min(16,matchedHints.length*8)}
  const cityMatch=includesRegion(poiCity,plan.city,/市$/),districtMatch=includesRegion(poiDistrict,plan.district,/[区县市]$/);
  if(cityMatch)score+=8;if(districtMatch)score+=6;if(source==="landmark_nearby")score+=4;
  score=Math.max(0,Math.min(100,score));
  if(plan.brand&&!brandMatch)score=Math.min(score,60);
  const strongGeographicMatch=(matchedHints.length>=2&&geographicCoverage>=0.45)||geographicCoverage>=0.72||(matchedHints.length>=1&&geographicCoverage>=0.58);
  const autoConfirm=score>=72&&brandMatch&&(coreMatch||similarity>=0.72||strongGeographicMatch);
  const reasons=[
    normalizedName===target?"标准化后的门店名称完全一致":coreMatch?`核心店名“${plan.core}”一致`:"按名称与地址地理要素综合排序",
    brandMatch&&plan.brand?`品牌“${plan.brand}”一致`:"品牌信息不足",
    ...(matchedHints.length?[`地理关键词“${matchedHints.join("、")}”一致（道路名称已兼容路/街/大道等写法）`]:[]),
    ...(geographicCoverage>=0.55?[`城市、区县、乡镇或道路信息相似度较高`]:[]),
    ...(cityMatch?["城市一致"]:[]),...(districtMatch?["区县一致"]:[]),
    ...(source==="landmark_nearby"?[`以“${plan.core}”为地标完成周边品牌回退搜索`]:[]),
  ];
  return {id:clean(raw.id)||`${name}|${location.join(",")}`,name,address,province:clean(raw.pname||raw.province)||plan.province,city:poiCity||plan.city,district:poiDistrict||plan.district,location,type:clean(raw.type),typecode:clean(raw.typecode),score,status:autoConfirm?"高置信度":score>=55?"中置信度":"低置信度",reasons,source,search_query:searchQuery,auto_confirm:autoConfirm};
}

function mergeCandidate(target:Map<string,StoreCandidate>,candidate:StoreCandidate|null){
  if(!candidate)return;
  const key=candidate.id||`${candidate.name}|${candidate.location.join(",")}`,existing=target.get(key);
  if(!existing||candidate.score>existing.score)target.set(key,candidate);
  else existing.reasons=unique([...existing.reasons,...candidate.reasons]);
}

export async function searchStoreCandidates(amap:AmapSearch,input:string,city="",district="",address=""){
  const plan=buildStoreSearchPlan(input,city,district),found=new Map<string,StoreCandidate>();
  let anchorRows:SearchRow[]=[];
  for(const query of plan.queries){
    const params:Record<string,string|number|boolean>={keywords:query,show_fields:"business,navi",page_size:20,page_num:1};
    if(plan.region){params.region=plan.region;params.city_limit=true}
    const data=await amap("/v5/place/text",params),rows=Array.isArray(data.pois)?data.pois as SearchRow[]:[];
    if(query===plan.core)anchorRows=rows;
    for(const row of rows)mergeCandidate(found,scoreStoreCandidate(row,plan,"text",query));
    const best=[...found.values()].sort((a,b)=>b.score-a.score)[0];
    if(best?.auto_confirm&&best.score>=90)break;
  }
  let ranked=[...found.values()].sort((a,b)=>b.score-a.score);
  if(!ranked.some(item=>item.auto_confirm)&&plan.brand&&plan.core){
    if(!anchorRows.length){
      const params:Record<string,string|number|boolean>={keywords:plan.core,show_fields:"business,navi",page_size:10,page_num:1};
      if(plan.region){params.region=plan.region;params.city_limit=true}
      const anchorData=await amap("/v5/place/text",params);anchorRows=Array.isArray(anchorData.pois)?anchorData.pois as SearchRow[]:[];
    }
    const anchor=anchorRows.map(row=>({row,location:parseLocation(row.location)})).find(item=>item.location);
    if(anchor?.location){
      const nearby=await amap("/v5/place/around",{location:anchor.location.join(","),radius:3000,keywords:plan.brand,sortrule:"distance",show_fields:"business,navi",page_size:25,page_num:1});
      for(const row of (Array.isArray(nearby.pois)?nearby.pois as SearchRow[]:[]))mergeCandidate(found,scoreStoreCandidate(row,plan,"landmark_nearby",plan.brand));
    }
    ranked=[...found.values()].sort((a,b)=>b.score-a.score);
  }
  if(address)ranked=ranked.map(item=>({...item,reasons:unique([...item.reasons,"已参考用户填写的详细地址"])}));
  return ranked.slice(0,20);
}
