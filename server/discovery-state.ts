import {createHash} from "node:crypto";
export type DiscoveryRow=Record<string,unknown>;
export type DiscoveryQuery=(sql:string,values?:unknown[])=>Promise<{rows:DiscoveryRow[];rowCount?:number|null}>;
export class DiscoveryPaused extends Error{constructor(){super("查询已暂停，已保存分页断点")}}
export function discoveryRequestKey(path:string,params:Record<string,unknown>){return createHash("sha256").update(JSON.stringify([path,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))])).digest("hex")}
export const doneUnit=(status:unknown)=>status==="complete"||status==="cached";
export function discoveryScopesOverlap(a:DiscoveryRow,b:DiscoveryRow){
 const brands=(row:DiscoveryRow)=>(Array.isArray(row.brands_json)?row.brands_json:Array.isArray(row.brands)?row.brands:[]) as string[];
 if(!brands(a).some(name=>brands(b).includes(name)))return false;
 if(a.province==="全国"||b.province==="全国")return true;
 if(a.province!==b.province)return false;
 const cities=(row:DiscoveryRow)=>(Array.isArray(row.cities_json)?row.cities_json:Array.isArray(row.cities)?row.cities:[]) as string[];
 return !cities(a).length||!cities(b).length||cities(a).some(city=>cities(b).includes(city));
}
export async function setDiscoveryUnit(q:DiscoveryQuery,jobId:number,tenantId:number,province:string,city:string,brand:string,status:string,error:string|null=null,saved=0){
 await q("UPDATE brand_discovery_units SET status=$6,error_message=$7,saved_stores=$8,started_at=CASE WHEN $6='running' THEN now() ELSE started_at END,completed_at=CASE WHEN $6 IN ('complete','cached','partial','failed') THEN now() ELSE NULL END,updated_at=now() WHERE job_id=$1 AND tenant_id=$2 AND province=$3 AND city=$4 AND brand=$5",[jobId,tenantId,province,city,brand,status,error,saved]);
}
export async function syncDiscoverySummary(q:DiscoveryQuery,jobId:number){
 await q(`UPDATE brand_discovery_jobs j SET unit_summary_json=(SELECT COALESCE(jsonb_object_agg(status,n),'{}'::jsonb) FROM (SELECT status,COUNT(*)::int n FROM brand_discovery_units WHERE job_id=$1 GROUP BY status)s) WHERE j.id=$1`,[jobId]);
}
