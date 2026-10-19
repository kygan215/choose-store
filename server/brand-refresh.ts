import {Router} from "express";
import {pool,query,audit} from "./db.js";
import {requireAdmin} from "./auth.js";
import {createDiscoveryJob} from "./brand-library.js";
import {isRetiredSnackBrand} from "./snack-brands.js";
import {nextWeeklyRefresh,validateRefreshSchedule} from "./refresh-time.js";
import {recordOps,safeLogText} from "./ops-log.js";
import {taskQueue} from "./queue.js";
export const REFRESH_DISPATCH_JOB="brand-refresh-dispatch";
export async function dispatchBrandRefreshes(){
 const client=await pool.connect();
 try{await client.query("BEGIN");
  const due=(await client.query("SELECT * FROM brand_refresh_schedules WHERE enabled AND next_run_at<=now() FOR UPDATE SKIP LOCKED")).rows;
  for(const schedule of due){
   const actor=(await client.query("SELECT id FROM users WHERE tenant_id=$1 AND active AND role='admin' ORDER BY (id=$2) DESC,id LIMIT 1",[schedule.tenant_id,schedule.created_by])).rows[0];
   if(!actor){await client.query("UPDATE brand_refresh_schedules SET enabled=false,updated_at=now() WHERE tenant_id=$1",[schedule.tenant_id]);recordOps({tenantId:Number(schedule.tenant_id),service:"worker",level:"error",module:"brand_refresh",event:"schedule_disabled",message:"周期更新没有可用管理员账号，已停用，请重新配置"});continue}
   schedule.created_by=actor.id;
   const brands=(await client.query("SELECT standard_name FROM brand_catalog WHERE tenant_id=$1 AND active AND approval_status='approved' ORDER BY standard_name",[schedule.tenant_id])).rows.map(r=>r.standard_name).filter(name=>!isRetiredSnackBrand(name));
   await client.query("INSERT INTO brand_refresh_runs(tenant_id,created_by,due_at,brands_json) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[schedule.tenant_id,schedule.created_by,schedule.next_run_at,JSON.stringify(brands)]);
   await client.query("UPDATE brand_refresh_schedules SET next_run_at=$2,last_dispatched_at=now(),updated_at=now() WHERE tenant_id=$1",[schedule.tenant_id,nextWeeklyRefresh(schedule.weekday,schedule.hour,schedule.minute)]);
  }await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
 const runs=(await query("SELECT * FROM brand_refresh_runs WHERE status='pending' ORDER BY id LIMIT 5")).rows;
 for(const run of runs){
  const dispatched:Record<string,unknown>=run.dispatch_json||{};
  for(const brand of run.brands_json as string[]){if(dispatched[brand])continue;if(isRetiredSnackBrand(brand)){dispatched[brand]={skipped:"品牌已移除"};continue}
   const active=(await query("SELECT 1 FROM brand_catalog WHERE tenant_id=$1 AND standard_name=$2 AND active",[run.tenant_id,brand])).rowCount;
   if(!active){dispatched[brand]={skipped:"品牌未启用"};continue}
   try{
    const job=await createDiscoveryJob(Number(run.tenant_id),Number(run.created_by),{province:"全国",cities:[],brands:[brand],force_refresh:true,schedule_key:`refresh:${run.id}:${brand}`});
    await taskQueue.add("discover-brand-stores",{jobId:job.id,tenantId:Number(run.tenant_id),userId:Number(run.created_by)},{jobId:`brand-discovery-${job.id}`,attempts:1});dispatched[brand]={job_id:job.id};
   }catch(error){recordOps({tenantId:Number(run.tenant_id),service:"worker",level:"warn",module:"brand_refresh",event:"dispatch_deferred",message:`${brand} 周期更新等待调度：${safeLogText(error instanceof Error?error.message:error)}`,taskType:"refresh",taskId:String(run.id)})}
   await query("UPDATE brand_refresh_runs SET dispatch_json=$2,updated_at=now() WHERE id=$1",[run.id,JSON.stringify(dispatched)]);
  }
  const finished=(run.brands_json as string[]).every(brand=>Boolean(dispatched[brand]));
  await query("UPDATE brand_refresh_runs SET status=$2,dispatch_json=$3,updated_at=now() WHERE id=$1",[run.id,finished?"dispatched":"pending",JSON.stringify(dispatched)]);
 }
}
const router=Router();router.use(requireAdmin);
router.get("/",async(req,res,next)=>{try{const schedule=(await query("SELECT * FROM brand_refresh_schedules WHERE tenant_id=$1",[req.user!.tenantId])).rows[0]||{enabled:false,weekday:1,hour:12,minute:0,timezone:"Asia/Shanghai",next_run_at:null};const runs=(await query("SELECT id,due_at,status,brands_json,dispatch_json,updated_at FROM brand_refresh_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 5",[req.user!.tenantId])).rows;res.json({success:true,data:{schedule,runs}})}catch(error){next(error)}});
router.put("/",async(req,res,next)=>{try{const input=validateRefreshSchedule(req.body||{}),nextRun=input.enabled?nextWeeklyRefresh(input.weekday,input.hour,input.minute):null;
 await query("INSERT INTO brand_refresh_schedules(tenant_id,created_by,enabled,weekday,hour,minute,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id) DO UPDATE SET created_by=EXCLUDED.created_by,enabled=EXCLUDED.enabled,weekday=EXCLUDED.weekday,hour=EXCLUDED.hour,minute=EXCLUDED.minute,next_run_at=EXCLUDED.next_run_at,updated_at=now()",[req.user!.tenantId,req.user!.id,input.enabled,input.weekday,input.hour,input.minute,nextRun]);await audit(req.user!.tenantId,req.user!.id,"configure_brand_refresh","brand_refresh_schedule",req.user!.tenantId,req.ip||"",input);res.json({success:true,data:{...input,next_run_at:nextRun,timezone:"Asia/Shanghai"}})
 }catch(error){next(error)}});
export default router;
