import { pathToFileURL } from "node:url";
import { pool, query } from "../server/db.js";
import { consumeBackgroundQuota } from "../server/amap-usage.js";
import { hasClearlyNonSnackEvidence, isSnackRetailStore, snackTags } from "../server/snack-retail.js";

type Row = Record<string, any>;
export function verifiedSnackDecision(_brand: string, poi: Row | null) {
  if (!poi) return {keep:true,reason:"高德未返回详情，保留待核验"};
  if (hasClearlyNonSnackEvidence(poi)) return {keep:false,reason:"名称明确指向非目标门店"};
  if (isSnackRetailStore(poi)) return {keep:true,reason:/零食/.test(`${poi.type || ""};${snackTags(poi)}`)?"高德零食标签核验通过":"目标品牌使用日杂店或综合超市标签，保留"};
  return {keep:true,reason:"标签不足以判定，保留待核验"};
}

const runId = "snack-brands-20261008-v5";
const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
let nextStart=0,interval=125,requests=0;
async function details(ids:string[],tenantId:number):Promise<Row[]> {
  const key=process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) throw new Error("未配置高德Key");
  for(let attempt=0;attempt<5;attempt++) {
    const slot=Math.max(Date.now(),nextStart);nextStart=slot+interval;await sleep(Math.max(0,slot-Date.now()));
    await consumeBackgroundQuota(tenantId,{sourceType:"library_cleanup",sourceId:runId,operation:"/v5/place/detail",details:{pois:ids.length}});
    requests++;
    const url=new URL("https://restapi.amap.com/v5/place/detail");
    url.search=new URLSearchParams({key,id:ids.join("|"),show_fields:"business"}).toString();
    let data:Row;
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error(`高德HTTP ${response.status}`);
      data=await response.json() as Row;
    } catch {
      if(attempt<4){await sleep(1500*(attempt+1));continue}
      throw new Error("高德网络请求连续失败，未执行清理");
    }
    if(String(data.status)==="1"&&Array.isArray(data.pois))return data.pois;
    if(["10014","10015","10019","10020","10021","10022","10023"].includes(String(data.infocode))&&attempt<4){interval=Math.min(2000,Math.max(500,interval*1.5));await sleep(2000*(attempt+1));continue}
    throw new Error(`高德请求失败 ${String(data.infocode||"UNKNOWN")}，未执行清理`);
  }
  throw new Error("高德核验失败，未执行清理");
}

async function ensureAudit() {
  await query(`CREATE TABLE IF NOT EXISTS maintenance_snack_audit (
    run_id TEXT NOT NULL,store_id BIGINT NOT NULL,poi_id TEXT,snapshot_updated_at TIMESTAMPTZ NOT NULL,
    keep BOOLEAN NOT NULL,reason TEXT NOT NULL,poi_json JSONB,checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(run_id,store_id))`);
}
async function status() {
  const stats=(await query(`SELECT COUNT(*) checked,COUNT(*) FILTER(WHERE keep) keep,COUNT(*) FILTER(WHERE NOT keep) remove FROM maintenance_snack_audit WHERE run_id=$1`,[runId])).rows[0];
  const reasons=(await query(`SELECT reason,COUNT(*) count FROM maintenance_snack_audit WHERE run_id=$1 GROUP BY reason ORDER BY count DESC`,[runId])).rows;
  const remaining=Number((await query(`SELECT COUNT(*) count FROM brand_stores b LEFT JOIN maintenance_snack_audit a ON a.run_id=$1 AND a.store_id=b.id AND a.snapshot_updated_at=b.updated_at WHERE a.store_id IS NULL`,[runId])).rows[0].count);
  return {runId,...stats,remaining,reasons};
}
async function auditAll() {
  // Reuse fetched POIs, but recompute every decision under the revised rule.
  const previous=(await query(`SELECT DISTINCT ON(b.id) b.id,b.brand_name,b.amap_poi_id,b.updated_at::text AS updated_at,a.poi_json
    FROM brand_stores b JOIN maintenance_snack_audit a ON a.store_id=b.id AND a.run_id IN ('snack-labels-20261008','snack-brands-20261008-v2') AND a.snapshot_updated_at=b.updated_at
    LEFT JOIN maintenance_snack_audit current ON current.store_id=b.id AND current.run_id=$1 WHERE current.store_id IS NULL ORDER BY b.id,a.checked_at DESC`,[runId])).rows;
  for(let offset=0;offset<previous.length;offset+=500){
    const entries=previous.slice(offset,offset+500).map(row=>({store_id:row.id,poi_id:row.amap_poi_id,snapshot_updated_at:row.updated_at,...verifiedSnackDecision(row.brand_name,row.poi_json),poi_json:row.poi_json}));
    await query(`INSERT INTO maintenance_snack_audit(run_id,store_id,poi_id,snapshot_updated_at,keep,reason,poi_json)
      SELECT $1,x.store_id,x.poi_id,x.snapshot_updated_at,x.keep,x.reason,x.poi_json FROM jsonb_to_recordset($2::jsonb) AS x(store_id BIGINT,poi_id TEXT,snapshot_updated_at TIMESTAMPTZ,keep BOOLEAN,reason TEXT,poi_json JSONB)
      ON CONFLICT(run_id,store_id) DO NOTHING`,[runId,JSON.stringify(entries)]);
  }
  console.log(JSON.stringify({phase:"reclassified_previous_audit",records:previous.length}));
  const rows=(await query(`SELECT b.id,b.tenant_id,b.brand_name,b.amap_poi_id,b.updated_at::text AS updated_at FROM brand_stores b LEFT JOIN maintenance_snack_audit a ON a.run_id=$1 AND a.store_id=b.id AND a.snapshot_updated_at=b.updated_at WHERE a.store_id IS NULL ORDER BY b.tenant_id,b.id`,[runId])).rows;
  let cursor=0,processed=0,stopping=false;
  console.log(JSON.stringify({phase:"audit_started",pending:rows.length}));
  const workers=Array.from({length:4},async()=>{
    while(cursor<rows.length&&!stopping){
      const batch=rows.slice(cursor,cursor+=10);
      try{
        const ids=[...new Set(batch.map(row=>String(row.amap_poi_id||"")).filter(id=>/^B[A-Z0-9]{8,31}$/i.test(id)))];
        const pois=ids.length?await details(ids,Number(batch[0].tenant_id)):[];
        const byId=new Map(pois.map(poi=>[String(poi.id),poi]));
        for(const id of ids.filter(id=>!byId.has(id))){const single=await details([id],Number(batch[0].tenant_id));const found=single.find(poi=>String(poi.id)===id);if(found)byId.set(id,found)}
        const entries=batch.map(row=>{const poi=byId.get(String(row.amap_poi_id))||null;return {store_id:row.id,poi_id:row.amap_poi_id,snapshot_updated_at:row.updated_at,...verifiedSnackDecision(row.brand_name,poi),poi_json:poi}});
        await query(`INSERT INTO maintenance_snack_audit(run_id,store_id,poi_id,snapshot_updated_at,keep,reason,poi_json)
          SELECT $1,x.store_id,x.poi_id,x.snapshot_updated_at,x.keep,x.reason,x.poi_json FROM jsonb_to_recordset($2::jsonb) AS x(store_id BIGINT,poi_id TEXT,snapshot_updated_at TIMESTAMPTZ,keep BOOLEAN,reason TEXT,poi_json JSONB)
          ON CONFLICT(run_id,store_id) DO UPDATE SET poi_id=EXCLUDED.poi_id,snapshot_updated_at=EXCLUDED.snapshot_updated_at,keep=EXCLUDED.keep,reason=EXCLUDED.reason,poi_json=EXCLUDED.poi_json,checked_at=NOW()`,[runId,JSON.stringify(entries)]);
        processed+=batch.length;
        if(processed%500===0||processed===rows.length)console.log(JSON.stringify({phase:"audit_progress",processed,pending:rows.length,requests,interval_ms:interval}));
      }catch(error){stopping=true;throw error}
    }
  });
  const results=await Promise.allSettled(workers);const failed=results.find(result=>result.status==="rejected");
  if(failed?.status==="rejected")throw failed.reason;
  console.log(JSON.stringify({phase:"audit_complete",...await status(),requests}));
}

async function applyVerified() {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE brand_stores IN SHARE ROW EXCLUSIVE MODE");
    const pending=Number((await client.query(`SELECT COUNT(*) count FROM brand_stores b LEFT JOIN maintenance_snack_audit a ON a.run_id=$1 AND a.store_id=b.id AND a.snapshot_updated_at=b.updated_at WHERE a.store_id IS NULL`,[runId])).rows[0].count);
    if(pending)throw new Error(`还有 ${pending} 条记录未核验或核验后发生变化，请先重新运行 --audit`);
    await client.query(`CREATE TABLE IF NOT EXISTS maintenance_snack_removed (
      run_id TEXT NOT NULL,store_id BIGINT NOT NULL,original_row JSONB NOT NULL,linked_store_ids BIGINT[] NOT NULL,
      reason TEXT NOT NULL,verified_poi JSONB,removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(run_id,store_id))`);
    await client.query(`INSERT INTO maintenance_snack_removed(run_id,store_id,original_row,linked_store_ids,reason,verified_poi)
      SELECT $1,b.id,to_jsonb(b),ARRAY(SELECT s.id FROM stores s WHERE s.brand_store_id=b.id),a.reason,a.poi_json
      FROM brand_stores b JOIN maintenance_snack_audit a ON a.store_id=b.id AND a.run_id=$1 WHERE NOT a.keep
      ON CONFLICT(run_id,store_id) DO NOTHING`,[runId]);
    const removed=await client.query(`DELETE FROM brand_stores b USING maintenance_snack_audit a WHERE a.run_id=$1 AND a.store_id=b.id AND NOT a.keep`,[runId]);
    const updated=await client.query(`UPDATE brand_stores b SET
      raw_json=b.raw_json || jsonb_build_object('name',COALESCE(a.poi_json->>'name',b.amap_name),'business',a.poi_json->'business','tag',concat_ws(';',a.poi_json#>>'{business,tag}',a.poi_json#>>'{business,rectag}',a.poi_json#>>'{business,keytag}'),'type',a.poi_json->>'type','typecode',a.poi_json->>'typecode','rating',a.poi_json#>'{business,rating}','tel',a.poi_json#>'{business,tel}'),
      data_status=CASE WHEN a.poi_json IS NOT NULL AND b.amap_name IS DISTINCT FROM a.poi_json->>'name' THEN '更新' ELSE b.data_status END,
      amap_name=COALESCE(a.poi_json->>'name',b.amap_name),poi_type=COALESCE(a.poi_json->>'type',''),typecode=COALESCE(a.poi_json->>'typecode',''),updated_at=NOW()
      FROM maintenance_snack_audit a WHERE a.run_id=$1 AND a.store_id=b.id AND a.keep AND a.poi_json IS NOT NULL`,[runId]);
    const retained=Number((await client.query("SELECT COUNT(*) count FROM brand_stores")).rows[0].count);
    await client.query(`UPDATE brand_region_cache c SET complete=FALSE,store_count=(SELECT COUNT(*) FROM brand_stores b WHERE b.tenant_id=c.tenant_id AND b.brand_name=c.brand_name AND b.province=c.province AND b.city=c.city)`);
    await client.query("COMMIT");
    console.log(JSON.stringify({phase:"cleanup_applied",runId,removed:removed.rowCount,retained,metadata_updated:updated.rowCount,archive:"maintenance_snack_removed"}));
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
async function main(){await ensureAudit();if(process.argv.includes("--audit"))await auditAll();else if(process.argv.includes("--apply"))await applyVerified();else console.log(JSON.stringify(await status()));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:"清理失败");process.exitCode=1}).finally(()=>pool.end());
