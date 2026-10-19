"use client";
import React,{useEffect,useRef,useState} from "react";
import {callHistory as call,errorText} from "./history-api";
import HistoryStoreLocator,{type HistoryLocationSource,type HistorySearchClues,type HistoryLocationDraft,type HistoryLocationResult,type HistoryAnalysisLinkResult,type HistoryAnalysisStart,type HistoryLocationHints} from "./HistoryStoreLocator";
export type Candidate={id:number;brand_name:string;amap_name:string;province:string;city:string;address:string;amap_poi_id:string|null};
export type AmapHistoryCandidate={id:string;name:string;province:string;city:string;district:string;address:string;type:string;score:number;reasons:string[];conflicts:string[];warnings:string[];library_candidates:Candidate[]};
type Props={api:string;brand:string;province:string;city:string;initial:Candidate[];selectedId:number|null;onSelect:(candidate:Candidate|null)=>void;label:string;historyStoreId?:number;cachedCandidates?:AmapHistoryCandidate[];onLinked?:(message?:string)=>Promise<void>;onConfirmCandidate?:(candidate:Candidate)=>Promise<boolean>;onConfirmPoi?:(candidate:AmapHistoryCandidate)=>Promise<boolean>;historySource?:HistoryLocationSource;disabled?:boolean;onSaveLocation?:(draft:HistoryLocationDraft)=>Promise<HistoryLocationResult>;onLinkAnalysis?:(id:number,reason:string)=>Promise<HistoryAnalysisLinkResult>;onCreateAnalysis?:(reason:string)=>Promise<HistoryAnalysisStart>;onStartAnalysis?:(result:HistoryAnalysisStart)=>void};
const normalized=(rows:Candidate[])=>rows.map(row=>({...row,id:Number(row.id)})).filter(row=>Number.isSafeInteger(row.id)&&row.id>0);
export default function CandidateLookup({api,brand,province,city,initial,selectedId,onSelect,label,historyStoreId,cachedCandidates,onLinked,onConfirmCandidate,onConfirmPoi,historySource,disabled,onSaveLocation,onLinkAnalysis,onCreateAnalysis,onStartAnalysis}:Props){
 const [query,setQuery]=useState(""),[found,setFound]=useState<Candidate[]>([]),[searching,setSearching]=useState(false),[saving,setSaving]=useState(""),[error,setError]=useState("");
 const [amapFound,setAmapFound]=useState<AmapHistoryCandidate[]|null>(null),request=useRef<{sequence:number;controller?:AbortController}>({sequence:0}),mutation=useRef(false);
 const [diagnostics,setDiagnostics]=useState<string[]>([]);
 const blocked=Boolean(disabled||saving);
 useEffect(()=>()=>{request.current.sequence++;request.current.controller?.abort()},[]);
 const options=[...new Map(normalized([...initial,...found]).map(item=>[item.id,item])).values()];
 const selected=options.find(item=>item.id===Number(selectedId)),shownAmap=amapFound??(searching?[]:cachedCandidates||[]);
 const mismatch=(candidate:Candidate)=>Boolean((brand&&candidate.brand_name!==brand)||(province&&candidate.province&&candidate.province!==province)||(city&&candidate.city&&candidate.city!==city));
 function select(candidate:Candidate|null){if(candidate&&mismatch(candidate)){onSelect(null);setError("候选的品牌或省市与历史门店不一致，请核对后选择");return}onSelect(candidate);setError("")}
 function startSearch(){request.current.controller?.abort();const controller=new AbortController();request.current={sequence:request.current.sequence+1,controller};setSearching(true);setError("");setDiagnostics([]);onSelect(null);setFound([]);setAmapFound([]);return {sequence:request.current.sequence,controller}}
 async function search(scoped:boolean){
  if(!query.trim()){setError("请输入门店名称、地址或 POI ID");return}
  const q=query.trim(),params=new URLSearchParams({q});if(scoped){if(brand)params.set("brand",brand);if(province)params.set("province",province);if(city)params.set("city",city)}
  const current=startSearch();
  try{const result=await call<{rows:Candidate[]}>(api,`/history/brand-stores/search?${params}`,{signal:current.controller.signal});if(request.current.sequence!==current.sequence)return;const rows=normalized(result.rows);setFound(rows);
   const exact=rows.filter(row=>row.amap_poi_id?.toUpperCase()===q.toUpperCase()&&!mismatch(row));if(/^B[A-Z0-9]{9}$/i.test(q)&&exact.length===1)onSelect(exact[0]);
   if(!rows.length)setError("品牌库未找到候选，可点“高德实时找”按 POI ID 或分店名称查询")
  }catch(problem){if(!current.controller.signal.aborted&&request.current.sequence===current.sequence)setError(errorText(problem))}
  finally{if(request.current.sequence===current.sequence)setSearching(false)}
 }
 async function searchAmap(clues:HistorySearchClues={}){
  if(!historyStoreId)return;const current=startSearch(),q=query.trim();
  try{const result=await call<{rows:AmapHistoryCandidate[];diagnostics?:{warnings?:string[];budget_exhausted?:boolean;failed_stages?:Array<string|{stage?:string;message?:string;error?:string}>;location_hints?:HistoryLocationHints}}>(api,`/history/stores/${historyStoreId}/amap-candidates`,{method:"POST",body:JSON.stringify({q,...clues}),signal:current.controller.signal});if(request.current.sequence!==current.sequence)return;
   const details=result.diagnostics;setDiagnostics([...(details?.warnings||[]),...(details?.budget_exhausted?["本次查询已达到请求预算上限，部分回退阶段可能未完成；可补充更具体的地址或坐标后重试。"]:[]),...(details?.failed_stages||[]).map(stage=>typeof stage==="string"?`查询阶段未完成：${stage}`:`查询阶段未完成：${stage.stage||"未知阶段"}${stage.message||stage.error?`（${stage.message||stage.error}）`:""}`)]);
   const rows=result.rows.map(row=>({...row,conflicts:row.conflicts||[],warnings:row.warnings||[],library_candidates:normalized(row.library_candidates||[])}));setAmapFound(rows);
   const exact=/^B[A-Z0-9]{9}$/i.test(q)?rows.filter(row=>row.id.toUpperCase()===q.toUpperCase()):rows.length===1&&rows[0].score>=85?rows:[];
   if(exact.length===1&&exact[0].library_candidates.length===1&&!exact[0].conflicts.length&&!mismatch(exact[0].library_candidates[0])){const candidate=exact[0].library_candidates[0];setFound([candidate]);onSelect(candidate)}
   if(!rows.length)setError("本次查询没有返回可关联的真实门店 POI。可在“补充线索／无 POI 处理”中补充地址、分享位置或地图选点；仍无结果时可人工核实历史档案。")
   return details?.location_hints
  }catch(problem){if(!current.controller.signal.aborted&&request.current.sequence===current.sequence)setError(errorText(problem))}
  finally{if(request.current.sequence===current.sequence)setSearching(false)}
 }
 async function confirmLibrary(candidate:Candidate){
  if(!historyStoreId||mutation.current||disabled)return;if(mismatch(candidate)){setError("候选品牌或省市不一致，不能直接关联");return}mutation.current=true;
  select(candidate);setFound(current=>[...new Map([...current,candidate].map(row=>[Number(row.id),row])).values()]);setSaving(String(candidate.id));setError("");
  try{if(onConfirmCandidate){if(!await onConfirmCandidate(candidate))setError("未保存关联，请查看当前门店旁的具体原因")}else{await call(api,`/history/stores/${historyStoreId}/link`,{method:"POST",body:JSON.stringify({brand_store_id:candidate.id})});await onLinked?.(`已关联：${candidate.amap_name}`)}}
  catch(problem){setError(errorText(problem))}finally{mutation.current=false;setSaving("")}
 }
 async function confirmPoi(item:AmapHistoryCandidate){if(!historyStoreId||mutation.current||disabled)return;mutation.current=true;setSaving(item.id);setError("");try{if(onConfirmPoi){if(!await onConfirmPoi(item))setError("未保存关联，请查看当前门店旁的具体原因")}else{await call(api,`/history/stores/${historyStoreId}/confirm-poi`,{method:"POST",body:JSON.stringify({poi_id:item.id})});await onLinked?.(`已补充并关联：${item.name}`)}}catch(problem){setError(errorText(problem))}finally{mutation.current=false;setSaving("")}}
 function invalidateSearch(){request.current.controller?.abort();request.current.sequence++;setSearching(false);setFound([]);setAmapFound([]);onSelect(null);setError("");setDiagnostics([])}
 function changeQuery(value:string){setQuery(value);invalidateSearch()}
 return <div className="history-candidate-lookup" aria-busy={searching||blocked}>
  <select aria-label={label} value={selectedId||""} disabled={blocked} onChange={event=>select(options.find(item=>item.id===Number(event.target.value))||null)}><option value="">请选择要关联的门店</option>{options.map(item=><option disabled={mismatch(item)} key={item.id} value={item.id}>{item.brand_name} · {item.amap_name} · {item.province} {item.city} · {item.address||"地址未知"} · {item.amap_poi_id||"无 POI ID"}</option>)}</select>
  <div className="history-candidate-search"><input aria-label={`${label}搜索词`} value={query} maxLength={100} disabled={blocked} onChange={event=>changeQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void (/^B[A-Z0-9]{9}$/i.test(query.trim())&&historyStoreId?searchAmap():search(true))}}} placeholder="搜店名、地址或 POI ID"/><button type="button" disabled={searching||blocked} onClick={()=>void search(true)}>本品牌地区找</button><button type="button" disabled={searching||blocked} onClick={()=>void search(false)}>全库找</button>{historyStoreId&&<button type="button" disabled={searching||blocked} onClick={()=>void searchAmap()}>{searching?"查询中…":"高德实时找"}</button>}</div>
  {selected&&<div className="history-selected-candidate" role="status"><b>已选择：{selected.amap_name}</b><small>{selected.province} {selected.city} · {selected.address||"地址未知"}</small><small>POI ID：{selected.amap_poi_id||"品牌库未提供"} · 点击“确认关联”保存</small></div>}
  {error&&<p className="history-inline-error" role="alert">{error}</p>}
  {diagnostics.length>0&&<div className="history-search-diagnostics" role="status">{diagnostics.map((detail,index)=><small key={index}>{detail}</small>)}</div>}
  {historyStoreId&&<small>无需先找 POI ID，可直接按门店名查询或补充地址、分享位置。查到唯一对应门店时会预选，仍须确认保存。</small>}
  {historySource&&<HistoryStoreLocator api={api} source={historySource} disabled={blocked} searching={searching} onSearch={searchAmap} onCluesChange={invalidateSearch} onSaveLocation={onSaveLocation} onLinkAnalysis={onLinkAnalysis} onCreateAnalysis={onCreateAnalysis} onStartAnalysis={onStartAnalysis}/>}
  {shownAmap.length>0&&<div className="history-amap-results">{shownAmap.map(item=><div className="history-amap-result" key={item.id}><b>{item.name}</b><small>{item.province} {item.city} {item.district} · {item.address||"地址未知"}</small><small>POI ID：{item.id} · 匹配分 {item.score} · {item.type||"分类未提供"}</small>{item.conflicts?.length>0&&<small>冲突：{item.conflicts.join("；")}</small>}{item.warnings?.length>0&&<small>{item.warnings.join("；")}</small>}{item.library_candidates?.length?normalized(item.library_candidates).map(candidate=><div className="history-candidate-actions" key={candidate.id}><button type="button" disabled={blocked||searching||mismatch(candidate)} aria-pressed={Number(selectedId)===candidate.id} onClick={()=>{setFound(current=>[...current,candidate]);select(candidate)}}>{Number(selectedId)===candidate.id?"已选择此门店":"选择此门店"}</button>{historyStoreId&&<button type="button" className="primary" disabled={blocked||searching||mismatch(candidate)} onClick={()=>void confirmLibrary(candidate)}>{saving===String(candidate.id)?"正在关联…":"确认关联此门店"}</button>}</div>):<div><small>品牌库暂无此 POI。核对名称、地址后，可补充入库并关联。</small><button type="button" disabled={blocked||searching} onClick={()=>void confirmPoi(item)}>{saving===item.id?"正在关联…":"补充品牌库并确认关联此 POI"}</button></div>}</div>)}</div>}
 </div>;
}

