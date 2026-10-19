import { query } from "./db.js";
import { canonicalSnackBrand } from "./snack-brands.js";
import type { Row } from "./services.js";

type BrandStoreIdentity={id:number;amap_poi_id:string|null;brand_name:string;province:string;city:string};
type QueryBrandStores=(tenantId:number,ids:number[],poiIds:string[])=>Promise<BrandStoreIdentity[]>;

function comparable(value:unknown){return String(value??"").trim().replace(/\s+/g,"").toLowerCase()}
function area(value:unknown){return comparable(value).replace(/(省|市|自治区|特别行政区)$/u,"")}
function noConflict(left:unknown,right:unknown,normalize=comparable){return !left||!right||normalize(left)===normalize(right)}
const actualPoi=(value:unknown)=>/^B[A-Z0-9]{9}$/i.test(String(value||"").trim())?String(value).trim().toUpperCase():"";
function compatibleStore(row:Row,item:BrandStoreIdentity){
 return noConflict(row.brand,item.brand_name,value=>comparable(canonicalSnackBrand(String(value))))&&noConflict(row.province,item.province,area)&&noConflict(row.city,item.city,area)&&noConflict(actualPoi(row.amap_poi_id),actualPoi(item.amap_poi_id));
}

async function loadBrandStores(tenantId:number,ids:number[],poiIds:string[]){
  if(!ids.length&&!poiIds.length)return [];
  const result=await query<BrandStoreIdentity>("SELECT id,amap_poi_id,brand_name,province,city FROM brand_stores WHERE tenant_id=$1 AND (id=ANY($2::bigint[]) OR amap_poi_id=ANY($3::text[]))",[tenantId,ids,poiIds]);
  return result.rows;
}

/** Only a verified direct link or unique POI with non-conflicting brand/location may expose history. */
export async function resolveTaskBrandStoreIds(tenantId:number,rows:Row[],lookup:QueryBrandStores=loadBrandStores){
  const ids=[...new Set(rows.map(row=>Number(row.brand_store_id)).filter(value=>Number.isSafeInteger(value)&&value>0))];
  const poiIds=[...new Set(rows.map(row=>String(row.amap_poi_id??"").trim()).filter(Boolean))];
  const candidates=await lookup(tenantId,ids,poiIds),byId=new Map(candidates.map(item=>[Number(item.id),item])),byPoi=new Map<string,BrandStoreIdentity[]>();
  for(const item of candidates){const poi=String(item.amap_poi_id??"").trim();if(poi)byPoi.set(poi,[...(byPoi.get(poi)||[]),item])}
  const resolved=new Map<number,number>();
  for(const row of rows){
    const rowId=Number(row.id),linked=byId.get(Number(row.brand_store_id));
    if(linked){if(compatibleStore(row,linked))resolved.set(rowId,Number(linked.id));continue}
    if(Number(row.brand_store_id)>0)continue;
    const poi=String(row.amap_poi_id??"").trim(),matches=byPoi.get(poi)||[];
    if(!poi||matches.length!==1)continue;
    const item=matches[0];
    if(!noConflict(row.brand,item.brand_name,value=>comparable(canonicalSnackBrand(String(value)))))continue;
    if(!noConflict(row.province,item.province,area)||!noConflict(row.city,item.city,area))continue;
    resolved.set(rowId,Number(item.id));
  }
  return resolved;
}

type HistoryStoreIdentity={id:number;brand_store_id:number|null;brand_name:string;province:string;city:string;poi_id:string|null;library_poi_id?:string|null;library_brand?:string|null;library_province?:string|null;library_city?:string|null};
type QueryHistoryStores=(tenantId:number,ids:number[])=>Promise<HistoryStoreIdentity[]>;
async function loadHistoryStores(tenantId:number,ids:number[]){return (await query<HistoryStoreIdentity>("SELECT h.id,h.brand_store_id,h.brand_name,h.province,h.city,h.poi_id,b.amap_poi_id library_poi_id,b.brand_name library_brand,b.province library_province,b.city library_city FROM history_stores h LEFT JOIN brand_stores b ON b.id=h.brand_store_id AND b.tenant_id=h.tenant_id WHERE h.tenant_id=$1 AND h.id=ANY($2::bigint[])",[tenantId,ids])).rows}

/** Explicit administrator-confirmed internal links can carry history without a public POI ID. */
export async function resolveTaskHistoryStoreIds(tenantId:number,rows:Row[],lookup:QueryHistoryStores=loadHistoryStores){
 const ids=[...new Set(rows.map(row=>Number(row.history_store_id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
 if(!ids.length)return new Map<number,number>();
 const histories=await lookup(tenantId,ids),byId=new Map(histories.map(row=>[Number(row.id),row])),resolved=new Map<number,number>();
 for(const row of rows){const history=byId.get(Number(row.history_store_id));if(!history)continue;
  if(!noConflict(row.brand,history.brand_name,value=>comparable(canonicalSnackBrand(String(value)))))continue;
  if(!noConflict(row.province,history.province,area)||!noConflict(row.city,history.city,area))continue;
  if(!noConflict(history.brand_name,history.library_brand,value=>comparable(canonicalSnackBrand(String(value))))||!noConflict(history.province,history.library_province,area)||!noConflict(history.city,history.library_city,area))continue;
  if(history.library_brand&&!compatibleStore(row,{id:Number(history.brand_store_id),amap_poi_id:history.library_poi_id||null,brand_name:history.library_brand,province:history.library_province||"",city:history.library_city||""}))continue;
  if(!noConflict(actualPoi(history.poi_id),actualPoi(history.library_poi_id)))continue;
  if(row.brand_store_id&&history.brand_store_id&&Number(row.brand_store_id)!==Number(history.brand_store_id))continue;
  if(!noConflict(actualPoi(row.amap_poi_id),actualPoi(history.poi_id)||actualPoi(history.library_poi_id)))continue;
  resolved.set(Number(row.id),Number(history.id));
 }
 return resolved;
}
