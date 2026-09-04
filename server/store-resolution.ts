import type { ImportRow } from "./import-reader.js";

export type StoreResolutionInput={
  originalName:string;searchName:string;brand:string;province:string;city:string;district:string;
  address:string;remark:string;poiId:string;longitude:number|null;latitude:number|null;
  sourceFields:Record<string,string>;originalRow:ImportRow;hasLocator:boolean;
};

export type ResolutionCandidate={
  id:string;name:string;address:string;location:[number,number];score:number;status:string;
  reasons:string[];conflicts?:string[];warnings?:string[];auto_confirm:boolean;
};

const clean=(value:unknown)=>String(value??"").trim();
const unique=(values:string[])=>[...new Set(values.map(clean).filter(Boolean))];
const knownBrand=/(零食很忙|零食有鸣|赵一鸣(?:零食)?|好[想像]来(?:零食(?:乐园)?)?|来伊份|良品铺子|爱零食|老婆大人|来优品|戴永红|糖巢|恰货铺子)/;
const storeFragment=/(?:零食很忙|零食有鸣|赵一鸣(?:零食)?|好[想像]来(?:零食(?:乐园)?)?|来伊份|良品铺子|爱零食|老婆大人|来优品|戴永红|糖巢|恰货铺子)?[^，,；;\n]{1,30}(?:门店|分店|店)(?=$|[（(，,；;\s])/;
const addressPattern=/(?:省|市|区|县|镇|乡|街道|大道|大街|公路|路|街|巷|号|小区|广场|商场|附近|东门|西门|南门|北门)/;
const detailedAddressPattern=/(?:镇|乡|街道|大道|大街|公路|路|街|巷|号|小区|广场|商场|附近|东门|西门|南门|北门)/;
const value=(row:ImportRow,mapping:Record<string,string>,field:string)=>clean(mapping[field]?row[mapping[field]]:"");
const numberOrNull=(input:string,min:number,max:number)=>{const number=Number(input);return Number.isFinite(number)&&number>=min&&number<=max?number:null};

export function extractStoreName(text:unknown){
  const source=clean(text).replace(/[\r\n]+/g," "),brand=source.match(knownBrand)?.[0];
  if(brand){const tail=source.slice(source.indexOf(brand)),branded=tail.match(new RegExp(`^.{0,35}?(?:门店|分店|店)(?=$|[（(，,；;\\s])`))?.[0]?.trim();if(branded)return branded}
  const matched=source.match(storeFragment)?.[0]?.trim();
  if(matched)return matched;
  if(!brand)return "";
  const index=source.indexOf(brand),tail=source.slice(index,index+40).split(/[，,；;\n]/)[0];
  return tail.length<=40?tail:"";
}

export function combineStoreAddress(parts:unknown[]){
  const result:string[]=[];
  for(const part of unique(parts.map(clean))){if(result.some(existing=>existing.includes(part)))continue;for(let index=result.length-1;index>=0;index--)if(part.includes(result[index]))result.splice(index,1);result.push(part)}
  return result.join("");
}

export function prepareStoreResolutionInput(row:ImportRow,mapping:Record<string,string>):StoreResolutionInput{
  const allValues=Object.values(row).map(clean).filter(Boolean),mappedName=value(row,mapping,"name"),mappedAddress=value(row,mapping,"address"),remark=value(row,mapping,"remark");
  const fallbackName=allValues.map(extractStoreName).find(Boolean)||"",fallbackAddress=[...allValues].filter(item=>addressPattern.test(item)&&detailedAddressPattern.test(item)).sort((a,b)=>b.length-a.length)[0]||"";
  const searchName=mappedName||extractStoreName(`${mappedAddress} ${remark}`)||fallbackName,brand=value(row,mapping,"brand")||searchName.match(knownBrand)?.[0]||"";
  const province=value(row,mapping,"province"),city=value(row,mapping,"city"),district=value(row,mapping,"district"),address=combineStoreAddress([province,city,district,mappedAddress||fallbackAddress]);
  const poiId=value(row,mapping,"poi_id"),longitude=numberOrNull(value(row,mapping,"longitude"),73,136),latitude=numberOrNull(value(row,mapping,"latitude"),3,54);
  const originalName=mappedName||searchName||mappedAddress||fallbackAddress;
  return {originalName,searchName,brand,province,city,district,address,remark,poiId,longitude,latitude,sourceFields:{...mapping},originalRow:{...row},hasLocator:Boolean(poiId||(longitude!=null&&latitude!=null)||searchName||mappedAddress||fallbackAddress)};
}

export function classifyResolutionCandidates<T extends ResolutionCandidate>(input:T[]){
  const candidates=input.map(candidate=>({...candidate,auto_confirm:false,warnings:[...(candidate.warnings||[])]})),first=candidates[0],second=candidates[1];
  if(!first)return {status:"没有候选",autoConfirm:false,ambiguous:false,candidates};
  const hardConflict=Boolean(first.conflicts?.some(item=>/品牌|城市|详细地址/.test(item))),ambiguous=Boolean(second&&first.score-second.score<8&&first.id!==second.id);
  const autoConfirm=first.score>=85&&!hardConflict&&!ambiguous;
  first.auto_confirm=autoConfirm;
  first.status=autoConfirm?"高置信度":first.score>=60?(ambiguous?"候选相近，需要确认":"中置信度，待确认"):"低置信度，待确认";
  if(ambiguous)first.warnings?.push(`前两名仅相差 ${Math.max(0,first.score-second!.score)} 分，需要人工确认`);
  if(hardConflict)first.warnings?.push("存在品牌、城市或详细地址冲突，禁止自动确认");
  return {status:first.status,autoConfirm,ambiguous,candidates};
}

export function persistentAmapPoiId(candidate:{id?:unknown;source?:unknown}){
  const id=String(candidate.id||"").trim(),source=String(candidate.source||"");
  return !id||id.startsWith("GEO-")||id.startsWith("COORD-")||source==="amap_geocode"||source==="input_coordinates"?null:id;
}
