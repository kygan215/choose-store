import { query } from "./db.js";
import { canonicalSnackBrand } from "./snack-brands.js";
import type { Row } from "./services.js";

type BrandStoreIdentity={id:number;amap_poi_id:string|null;brand_name:string;province:string;city:string};
type QueryBrandStores=(tenantId:number,ids:number[],poiIds:string[])=>Promise<BrandStoreIdentity[]>;

function comparable(value:unknown){return String(value??"").trim().replace(/\s+/g,"").toLowerCase()}
function area(value:unknown){return comparable(value).replace(/(省|市|自治区|特别行政区)$/u,"")}
function noConflict(left:unknown,right:unknown,normalize=comparable){return !left||!right||normalize(left)===normalize(right)}

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
    if(linked){resolved.set(rowId,Number(linked.id));continue}
    const poi=String(row.amap_poi_id??"").trim(),matches=byPoi.get(poi)||[];
    if(!poi||matches.length!==1)continue;
    const item=matches[0];
    if(!noConflict(row.brand,item.brand_name,value=>comparable(canonicalSnackBrand(String(value)))))continue;
    if(!noConflict(row.province,item.province,area)||!noConflict(row.city,item.city,area))continue;
    resolved.set(rowId,Number(item.id));
  }
  return resolved;
}
