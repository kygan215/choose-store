"use client";
import {useCallback,useEffect,useState} from "react";
import {formatBeijingDateTime} from "./time";
import "./discovery-monitor.css";

type Log={id:string;level:string;stage:string;message:string;created_at:string;details:Record<string,string|number>};
type Diagnostics={job_id:number;checked_at:string;queue_state:string;worker_heartbeat_at:string|null;heartbeat_at:string|null;last_activity_at:string|null;last_request_at:string|null;last_saved_at:string|null;request_count:number;saved_store_count:number;active_units:Array<Record<string,string|number>>;health:{state:string;message:string;idle_seconds:number|null};logs:Log[]};
const stageLabels:Record<string,string>={regions:"读取城市列表",searching:"检索门店",request:"等待高德响应",saving:"门店入库"};
const time=(value:string|null)=>value?formatBeijingDateTime(value):"暂无记录";
const detail=(value:Record<string,string|number>)=>[value.province,value.city,value.brand,value.path,value.page?`第 ${value.page} 页`:null,value.saved!==undefined?`已保存 ${value.saved}/${value.total??"—"}`:null,value.duration_ms!==undefined?`耗时 ${Number(value.duration_ms)/1000} 秒`:null,value.returned!==undefined?`返回 ${value.returned} 条`:null].filter(Boolean).join(" · ");

export default function BrandDiscoveryMonitor({api,jobId,onClose}:{api:string;jobId:number;onClose:()=>void}){
  const [data,setData]=useState<Diagnostics|null>(null),[error,setError]=useState(""),[automatic,setAutomatic]=useState(true),[errorsOnly,setErrorsOnly]=useState(false),[loading,setLoading]=useState(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try{const response=await fetch(`${api}/brand-library/jobs/${jobId}/diagnostics`,{signal:signal||AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||"诊断信息加载失败");if(!signal?.aborted){setData(result.data);setError("")}}
    catch(problem){if(!signal?.aborted)setError(problem instanceof Error?problem.message:"诊断信息加载失败")}
    finally{if(!signal?.aborted)setLoading(false)}
  },[api,jobId]);
  useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>;let controller:AbortController|null=null;
    const poll=async()=>{controller=new AbortController();const timeout=setTimeout(()=>{controller?.abort();if(!stopped){setError("读取诊断信息超时，请稍后重试");setLoading(false)}},15000);await load(controller.signal);clearTimeout(timeout);if(!stopped&&automatic)timer=setTimeout(()=>void poll(),5000)};
    void poll();return()=>{stopped=true;controller?.abort();clearTimeout(timer)};
  },[load,automatic]);
  function download(){if(!data)return;const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`品牌查询任务-${jobId}-诊断.json`;link.click();URL.revokeObjectURL(url)}
  return <section className="discovery-monitor" aria-label={`任务 ${jobId} 日志与监控`}><header><div><h3>任务 #{jobId} · 日志与监控</h3><p>每 5 秒刷新；最近 100 条记录，日志保留 30 天。时间均为北京时间。</p></div><div className="discovery-monitor-actions"><label><input type="checkbox" checked={automatic} onChange={event=>setAutomatic(event.target.checked)}/>自动刷新</label><button disabled={loading} onClick={()=>void load()}>刷新</button><button disabled={!data} onClick={download}>下载诊断信息</button><button onClick={onClose}>关闭</button></div></header>
    {error&&<p role="alert" className="discovery-monitor-warning">刷新失败：{error}。当前保留上次结果，请核对“采集时间”。</p>}
    {!data&&!error&&<p>正在读取任务运行状态…</p>}
    {data&&<><p className={`discovery-monitor-health ${data.health.state}`} role="status">{data.health.message}{data.health.idle_seconds!==null&&` · 距最近活动 ${data.health.idle_seconds} 秒`}<small>采集时间：{time(data.checked_at)}</small></p><div className="discovery-monitor-metrics"><div>已记录调用<b>{data.request_count} 次</b><small>最近请求：{time(data.last_request_at)}</small></div><div>本次已写入／更新门店<b>{data.saved_store_count} 家</b><small>最近入库：{time(data.last_saved_at)}</small></div><div>后台执行状态<b>{{active:"执行中",waiting:"等待执行",delayed:"延迟执行",missing:"未发现队列项",unavailable:"队列连接异常",unknown:"待确认"}[data.queue_state]||data.queue_state}</b><small>最近 Worker 心跳：{time(data.worker_heartbeat_at)}</small></div></div>
      {data.active_units.length>0&&<div className="discovery-active-units"><h4>当前并行区域</h4>{data.active_units.map((unit,index)=><p key={`${unit.province}-${unit.city}-${unit.brand}-${index}`}><b>{stageLabels[String(unit.stage)]||unit.stage}</b> · {detail(unit)}<small>阶段更新：{time(String(unit.updated_at||""))}</small></p>)}</div>}
      {data.queue_state==="active"&&!data.heartbeat_at&&<p className="discovery-monitor-note">此任务尚未上报详细阶段心跳，当前可查看已有的高德请求和入库时间。更新后执行的任务会增加响应耗时和分批入库日志。</p>}
      <div className="discovery-log-heading"><h4>最近运行日志</h4><label><input type="checkbox" checked={errorsOnly} onChange={event=>setErrorsOnly(event.target.checked)}/>仅看警告和错误</label></div><div className="discovery-log-table"><table><thead><tr><th>时间</th><th>级别</th><th>事件与地区</th></tr></thead><tbody>{data.logs.filter(log=>!errorsOnly||log.level!=="info").map(log=><tr key={log.id} className={log.level}><td>{time(log.created_at)}</td><td>{{info:"信息",warn:"警告",error:"错误"}[log.level]||log.level}</td><td>{log.message}<small>{detail(log.details)}</small></td></tr>)}{!data.logs.length&&<tr><td colSpan={3}>暂无日志。新任务开始执行后会自动记录。</td></tr>}</tbody></table></div>
      <details><summary>进度不动时如何排查</summary><ol><li>先看是否“已暂停”或“等待执行”。暂停后用“继续”恢复，避免重复创建全国任务。</li><li>最近请求或入库时间持续更新，说明仍在工作；城市完成数只在整座城市处理完后增加。</li><li>超过 2 分钟无新活动会显示提示。查看当前阶段、错误日志及最近心跳，判断是接口等待还是入库耗时。</li><li>若提示队列没有对应执行项或刷新失败，下载诊断信息，保留任务编号供管理员排查。</li></ol></details></>}
  </section>;
}
