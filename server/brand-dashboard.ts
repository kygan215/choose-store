import type {PoolClient} from "pg";
import {pool,query} from "./db.js";
import {aggregateDashboard,nextDashboardRefresh,type BrandDashboardSnapshot,type DashboardGroup} from "../shared/brand-dashboard.js";

type SnapshotRow={data_json:ReturnType<typeof aggregateDashboard>|null;generated_at:Date|null;refresh_after:Date|null;invalidated_at:Date|null};
function serialize(row:SnapshotRow):BrandDashboardSnapshot{
  return {...row.data_json!,generatedAt:row.generated_at!.toISOString(),nextRefreshAt:row.refresh_after!.toISOString(),stale:Boolean(row.invalidated_at)||Number(row.refresh_after)<=Date.now()};
}

export async function refreshBrandDashboard(tenantId:number,force=false,connect:()=>Promise<PoolClient>=()=>pool.connect()){
  const client=await connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('brand-dashboard:'||$1::text,0))",[tenantId]);
    await client.query("INSERT INTO brand_dashboard_snapshots(tenant_id) VALUES($1) ON CONFLICT DO NOTHING",[tenantId]);
    const current=(await client.query<SnapshotRow>("SELECT * FROM brand_dashboard_snapshots WHERE tenant_id=$1 FOR UPDATE",[tenantId])).rows[0];
    if(!force&&current.data_json&&!serialize(current).stale){await client.query("COMMIT");return serialize(current)}
    const groups=(await client.query<DashboardGroup>(`SELECT province,brand_name,COUNT(*)::int count FROM brand_stores
      WHERE tenant_id=$1 AND library_visible AND deleted_at IS NULL GROUP BY province,brand_name`,[tenantId])).rows;
    const data=aggregateDashboard(groups),now=new Date(),next=nextDashboardRefresh(now);
    const row=(await client.query<SnapshotRow>("UPDATE brand_dashboard_snapshots SET data_json=$2,generated_at=$3,refresh_after=$4,invalidated_at=NULL WHERE tenant_id=$1 RETURNING *",[tenantId,JSON.stringify(data),now,next])).rows[0];
    await client.query("COMMIT");return serialize(row);
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}

export async function readBrandDashboard(tenantId:number){
  const row=(await query<SnapshotRow>("SELECT * FROM brand_dashboard_snapshots WHERE tenant_id=$1",[tenantId])).rows[0];
  if(row?.data_json&&!serialize(row).stale)return serialize(row);
  try{return await refreshBrandDashboard(tenantId)}catch(error){
    if(!row?.data_json)throw error;
    return {...serialize(row),stale:true,message:"更新失败，当前显示上次成功的统计；请稍后重试。"};
  }
}

export const DASHBOARD_SCHEDULE={pattern:"0 2 * * *",tz:"Asia/Shanghai"};
export const DASHBOARD_JOB="brand-library-dashboard-refresh";
export async function refreshAllBrandDashboards(){
  const tenants=(await query<{id:string}>("SELECT id FROM tenants ORDER BY id")).rows,failed:number[]=[];
  for(const tenant of tenants){try{await refreshBrandDashboard(Number(tenant.id))}catch(error){failed.push(Number(tenant.id));console.error("Dashboard refresh failed",{tenantId:tenant.id,error})}}
  if(failed.length)throw new Error(`门店看板更新失败，租户：${failed.join(",")}`);
  return {updated:tenants.length};
}
