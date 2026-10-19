import {createHash} from "node:crypto";
import {isPolicyBrand} from "../shared/brand-store-policy.js";
import {isRetiredSnackBrand} from "./snack-brands.js";
import {canRetainSnackStore} from "./snack-retail.js";
type Row=Record<string,unknown>;
const clean=(value:unknown)=>String(value??"").trim();
export function discoveryRows(brand:string,province:string,city:string,stores:Row[]){
 if(isRetiredSnackBrand(brand))throw new Error(`品牌“${brand}”已移除，不能重新入库`);
 const rows=new Map<string,Row>();
 for(const s of stores){if(!isPolicyBrand(brand)&&!canRetainSnackStore(s,brand))continue;
  const location=Array.isArray(s.location)?s.location:[null,null],id=clean(s.id),uid=id||(isPolicyBrand(brand)?`brand-missing:${createHash("sha256").update(JSON.stringify([s.name,s.address,s.location])).digest("hex")}|${brand}`:`${brand}|${clean(s.name)}|${location.join(",")}`);
  if(!isPolicyBrand(brand)&&(location[0]==null||location[1]==null))continue;
  rows.set(uid,{source_uid:uid,brand_name:brand,amap_poi_id:id,amap_name:String(s.name??""),province:clean(s.province)||province,city:clean(s.city)||city,district:clean(s.district),address:clean(s.address),longitude:location[0]==null?null:Number(location[0]),latitude:location[1]==null?null:Number(location[1]),poi_type:clean(s.type),typecode:clean(s.typecode),raw_json:s});
 }return [...rows.values()].sort((a,b)=>Number(Boolean(b.amap_poi_id))-Number(Boolean(a.amap_poi_id)));
}
const equal=`ROW(b.brand_name,b.amap_poi_id,b.amap_name,b.province,b.city,b.district,b.address,b.longitude,b.latitude,b.poi_type,b.typecode,b.raw_json)
 IS NOT DISTINCT FROM ROW(i.brand_name,i.amap_poi_id,i.amap_name,i.province,i.city,i.district,i.address,i.longitude,i.latitude,i.poi_type,i.typecode,i.raw_json)`;
export const saveDiscoveryBatchSql=`WITH incoming AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset($3::jsonb) AS i(source_uid text,brand_name text,amap_poi_id text,amap_name text,province text,city text,district text,address text,longitude double precision,latitude double precision,poi_type text,typecode text,raw_json jsonb)
), touched AS (
 UPDATE brand_stores b SET last_job_id=$2,last_seen_at=now(),updated_at=now(),data_status='正常'
 FROM incoming i WHERE b.tenant_id=$1 AND b.source_uid=i.source_uid AND b.deleted_at IS NULL AND ${equal}
 RETURNING b.id,b.source_uid
), changed AS (
 INSERT INTO brand_stores(tenant_id,source_uid,brand_name,amap_poi_id,amap_name,province,city,district,address,longitude,latitude,poi_type,typecode,raw_json,last_job_id,data_status)
 SELECT $1,i.source_uid,i.brand_name,i.amap_poi_id,i.amap_name,i.province,i.city,i.district,i.address,i.longitude,i.latitude,i.poi_type,i.typecode,i.raw_json,$2,'新增'
 FROM incoming i LEFT JOIN brand_stores b ON b.tenant_id=$1 AND b.source_uid=i.source_uid
 WHERE b.id IS NULL OR (b.deleted_at IS NULL AND NOT (${equal}))
 ON CONFLICT(tenant_id,source_uid) DO UPDATE SET brand_name=EXCLUDED.brand_name,amap_poi_id=EXCLUDED.amap_poi_id,amap_name=EXCLUDED.amap_name,province=EXCLUDED.province,city=EXCLUDED.city,district=EXCLUDED.district,address=EXCLUDED.address,longitude=EXCLUDED.longitude,latitude=EXCLUDED.latitude,poi_type=EXCLUDED.poi_type,typecode=EXCLUDED.typecode,raw_json=EXCLUDED.raw_json,last_job_id=EXCLUDED.last_job_id,last_seen_at=now(),updated_at=now(),data_status=CASE WHEN ROW(brand_stores.amap_name,brand_stores.address,brand_stores.longitude,brand_stores.latitude) IS DISTINCT FROM ROW(EXCLUDED.amap_name,EXCLUDED.address,EXCLUDED.longitude,EXCLUDED.latitude) THEN '更新' ELSE '正常' END
 WHERE brand_stores.deleted_at IS NULL AND NOT (brand_stores.brand_name<>EXCLUDED.brand_name AND ((brand_stores.library_visible AND NOT EXCLUDED.library_visible) OR brand_stores.ailingshi_override='accept'))
 RETURNING id,source_uid
) SELECT id,source_uid FROM touched UNION ALL SELECT id,source_uid FROM changed`;
