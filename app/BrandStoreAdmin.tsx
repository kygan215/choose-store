"use client";

import { useEffect, useRef, useState } from "react";
import { formatBeijingDateTime } from "./time";

type RemovedStore={id:number;brand_name:string;amap_name:string;province:string;city:string;district:string;address:string;amap_poi_id:string;delete_reason:string;deleted_at:string;deleted_by_name:string|null};
type RemovedPage={rows:RemovedStore[];total:number;page:number;pages:number};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Target={ids:number[];name?:string;action:"delete"|"restore"};

export function BrandStoreRemovalDialog({target,onClose,onSubmit}:{target:Target;onClose:()=>void;onSubmit:(reason:string)=>Promise<void>}){
  const ref=useRef<HTMLDialogElement>(null),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close()},[]);
  const removing=target.action==="delete";
  return <dialog ref={ref} className="brand-removal-dialog" aria-labelledby="brand-removal-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
    <form onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError("");try{await onSubmit(reason)}catch(e){setError(e instanceof Error?e.message:"操作失败")}finally{setBusy(false)}}}>
      <h2 id="brand-removal-title">确认{removing?"删除":"恢复"}门店</h2>
      <p>{target.name?`门店：${target.name}`:`已勾选 ${target.ids.length} 家门店（包含其他页的选择）。`}</p>
      <p>{removing?"删除后，这些门店将从共享门店库、后续导出和新建POI反查中移除。保留删除记录，可由管理员恢复；再次查询高德也不会自动重新加入。":"恢复后，门店重新参与正常筛选、导出和新建POI反查。"}</p>
      {removing&&<label>删除原因（必填）<textarea autoFocus required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} placeholder="例如：人工核实为蛋糕店，并非目标零食品牌"/></label>}
      {error&&<p role="alert">{error}</p>}
      <div className="brand-removal-actions"><button type="button" autoFocus={!removing} disabled={busy} onClick={onClose}>取消</button><button type="submit" className={removing?"danger-btn":"primary"} disabled={busy||(removing&&!reason.trim())}>{busy?"正在处理…":`确认${removing?"删除":"恢复"} ${target.ids.length} 家`}</button></div>
    </form>
  </dialog>;
}

export default function RemovedBrandStores({request,onChanged}:{request:Request;onChanged:()=>void}){
  const [data,setData]=useState<RemovedPage>({rows:[],total:0,page:1,pages:0}),[page,setPage]=useState(1),[keyword,setKeyword]=useState(""),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[target,setTarget]=useState<Target|null>(null);
  useEffect(()=>{let active=true;const controller=new AbortController();setLoading(true);setError("");const timer=window.setTimeout(()=>void request<RemovedPage>(`/admin/brand-library/deleted-stores?page=${page}&keyword=${encodeURIComponent(keyword)}`,{signal:controller.signal}).then(result=>{if(active){if(page>Math.max(1,result.pages))setPage(Math.max(1,result.pages));else setData(result)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"删除记录加载失败")}).finally(()=>{if(active)setLoading(false)}),200);return()=>{active=false;controller.abort();window.clearTimeout(timer)}},[request,page,keyword,reload]);
  return <section className="panel"><h2>已删除门店</h2><p>仅管理员可查看和恢复。删除原因、操作人和删除时间保留在此处；已有分析报告仍可查阅。</p>
    <input className="removed-store-search" placeholder="搜索已删除门店名称或地址" value={keyword} onChange={event=>{setKeyword(event.target.value);setPage(1)}}/>
    {notice&&<p role="status">{notice}</p>}
    <div className="table-wrap brand-library-table" aria-busy={loading}><table><thead><tr><th>品牌/门店</th><th>地址</th><th>删除原因</th><th>删除人/时间</th><th>操作</th></tr></thead><tbody>
      {loading?<tr><td colSpan={5} role="status">正在加载删除记录…</td></tr>:error?<tr><td colSpan={5} role="alert">{error} <button onClick={()=>setReload(v=>v+1)}>重试</button></td></tr>:!data.rows.length?<tr><td colSpan={5}>暂无符合条件的删除记录</td></tr>:data.rows.map(store=><tr key={store.id}><td><b>{store.brand_name}</b><small>{store.amap_name}</small><small>{store.amap_poi_id}</small></td><td>{store.province} {store.city} {store.district}<small>{store.address}</small></td><td>{store.delete_reason}</td><td>{store.deleted_by_name||"原管理员"}<small>{formatBeijingDateTime(store.deleted_at)}</small></td><td><button onClick={()=>setTarget({ids:[store.id],name:store.amap_name,action:"restore"})}>恢复</button></td></tr>)}
    </tbody></table></div>
    <div className="library-pagination"><button disabled={loading||Boolean(error)||page<=1} onClick={()=>setPage(v=>v-1)}>上一页</button><span>共 {data.total} 家 · 第 {page}/{Math.max(1,data.pages)} 页</span><button disabled={loading||Boolean(error)||page>=data.pages} onClick={()=>setPage(v=>v+1)}>下一页</button></div>
    {target&&<BrandStoreRemovalDialog target={target} onClose={()=>setTarget(null)} onSubmit={async()=>{const result=await request<{changed:number}>("/admin/brand-library/stores/restore",{method:"POST",body:JSON.stringify({store_ids:target.ids})});setTarget(null);setNotice(`已恢复 ${result.changed} 家门店。`);setReload(v=>v+1);onChanged()}}/>}
  </section>;
}
