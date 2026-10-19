"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatBeijingDateTime } from "./time";
import { useScrollMemory } from "./use-scroll-memory";
import "./history-activities.css";
import HistoryMatchingPanel from "./HistoryMatchingPanel";
import CandidateLookup, {type Candidate,type AmapHistoryCandidate} from "./HistoryCandidateLookup";
import {callHistory as call,ApiProblem,errorText,historyProblemDetails} from "./history-api";
import type {HistoryLocationSource,HistoryLocationDraft,HistoryLocationResult,HistoryAnalysisLinkResult,HistoryAnalysisStart} from "./HistoryStoreLocator";

export type HistoryPermissions = {can_view:boolean;can_export:boolean;can_manage:boolean};

type Store = HistoryLocationSource&{
  id:number; brand_name:string; store_name:string; province:string; city:string;
  brand_store_id:number|null; archive_only:boolean; current_store_name?:string|null;
  current_status?:string|null; current_deleted_at?:string|null; current_library_visible?:boolean|null;
  current_name_decision?:string|null; activity_count:number; latest_activity_start?:string|null;
  sales_amount:number|string|null; unknown_amount_count?:number; address?:string|null; poi_id?:string|null;
};
type HistoricalCandidate = {id:number;brand_name:string;store_name:string;province:string;city:string;address?:string;poi_id?:string|null};
type PendingStore = Store&{candidates:Candidate[];is_empty_archive?:boolean;poi_candidates?:AmapHistoryCandidate[];candidate_error?:string};
type Metrics = {store_count:number;activity_count:number;sales_amount:number|string|null;unknown_amount_count?:number;mixed_refund_basis:boolean};
type StorePage = {rows:Store[];total:number;metrics:Metrics};
type PendingPage = {rows:PendingStore[];total:number};
type Activity = {
  id:number;history_store_id:number;start_date:string;end_date:string;activity_name?:string|null;
  sales_amount:number|string|null;refund_basis:"refunded"|"not_refunded"|"unknown";
  brand_name?:string;store_name?:string;province?:string;city?:string;address?:string;
  calendar_tags?:string[];source_file_name?:string|null;source_sheet?:string|null;
  source_cell?:string|null;source_import_id?:number|null;revoked_at?:string|null;
};
type Revision = {id:number;action:string;reason?:string|null;changed_at:string;before_json?:{sales_amount?:number|string|null}|null;after_json?:{sales_amount?:number|string|null}|null};
type Detail = {store:Store;rows:Activity[]};
type ImportColumn = {index:number;header:string;start_date:string;end_date:string;activity_name?:string;name?:string;ignore?:boolean};
type ImportRow = {
  row_number:number;name:string;brand?:string;province?:string;city?:string;address?:string;
  poi_id?:string;brand_store_id?:number|null;history_store_id?:number|null;auto_match_id?:number|null;
  history_store_candidate?:HistoricalCandidate|null;history_store_candidates?:HistoricalCandidate[];
  issues?:string[];values?:Record<string,string>;candidates?:Candidate[];
};
type Conflict = {row_number:number;column_index:number;existing_amount?:number;incoming_amount?:number;existing_sales_amount?:number;incoming_sales_amount?:number};
type StoreConflict = {row_number:number;history_store_id?:number|null;candidate_stores?:HistoricalCandidate[];reason?:string};
type Preview = {import_id:number;columns:ImportColumn[];rows:ImportRow[];issues?:string[];conflicts?:Conflict[];store_conflicts?:StoreConflict[]};
type ActivityDraft = {start_date:string;end_date:string;activity_name:string;sales_amount:string;refund_basis:Activity["refund_basis"];brand_name:string;store_name:string;province:string;city:string;address:string;reason:string};
const emptyDraft=():ActivityDraft=>({start_date:"",end_date:"",activity_name:"",sales_amount:"",refund_basis:"unknown",brand_name:"",store_name:"",province:"",city:"",address:"",reason:""});
const amount=(value:number|string|null|undefined)=>Number(value??0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const date=(value:string|null|undefined)=>value?value.slice(0,10):"—";
const excelColumn=(index:number)=>{let result="";for(let value=index;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result};
const validSalesValue=(value:string)=>/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.replace(/[,，\s￥¥]/g,""));
const currentStoreStatus=(store:Store)=>store.archive_only?"仅历史门店":!store.brand_store_id?"待匹配（历史活动可查看）":store.current_deleted_at?"当前已删除":store.current_name_decision==="排除"?"当前已排除":store.current_library_visible===false?"当前未纳入门店库":store.current_status||"当前状态未提供";



function withStoreConflicts(preview:Preview,conflicts:StoreConflict[]):Preview{
  if(!conflicts.length)return preview;
  return {...preview,rows:preview.rows.map(row=>{
    const matching=conflicts.filter(item=>item.row_number===row.row_number);
    if(!matching.length)return row;
    const candidates=[...(row.history_store_candidates||[]),...matching.flatMap(item=>item.candidate_stores||[])];
    const single=matching.find(item=>item.history_store_id)?.history_store_id;
    if(single&&!candidates.some(item=>item.id===single))candidates.push({id:single,brand_name:row.brand||"",store_name:row.name,province:row.province||"",city:row.city||""});
    return {...row,history_store_candidates:[...new Map(candidates.map(item=>[item.id,item])).values()],issues:[...new Set([...(row.issues||[]),...matching.map(item=>item.reason||"请人工确认历史门店身份")])]};
  })};
}


export function useHistoryPermissions(active=true,api="/api"){
  const [permissions,setPermissions]=useState<HistoryPermissions|null>(null);
  useEffect(()=>{
    if(!active)return;
    let mounted=true;
    void call<HistoryPermissions>(api,"/history/permissions").then(value=>{if(mounted)setPermissions(value)}).catch(()=>{if(mounted)setPermissions({can_view:false,can_export:false,can_manage:false})});
    return()=>{mounted=false};
  },[active,api]);
  return permissions;
}

export default function HistoryActivities({active,isAdmin,api,brands,onStartAnalysis}:{active:boolean;isAdmin:boolean;api:string;brands:string[];onStartAnalysis?:(result:HistoryAnalysisStart)=>void}){
  const permissions=useHistoryPermissions(active,api);
  const [mode,setMode]=useState<"overview"|"pending"|"import"|"access">("overview");
  const scrollMemory=useScrollMemory(),workspaceRef=useRef<HTMLDivElement>(null),previousMode=useRef(mode);
  function switchMode(next:typeof mode){if(mode===next)return;scrollMemory.capture(`history:${mode}`,workspaceRef.current??undefined);setMode(next)}
  useLayoutEffect(()=>{if(previousMode.current===mode)return;previousMode.current=mode;scrollMemory.restore(`history:${mode}`,workspaceRef.current??undefined)},[mode,scrollMemory]);
  const [filter,setFilter]=useState({brand:"",province:"",city:"",year:"",start:"",end:"",refund_basis:""});
  const [facets,setFacets]=useState<{brands:string[];provinces:string[];cities:string[];rows:Array<{brand_name:string;province:string;city:string}>}>({brands:[],provinces:[],cities:[],rows:[]});
  const [page,setPage]=useState(1);
  const [storePage,setStorePage]=useState<StorePage>({rows:[],total:0,metrics:{store_count:0,activity_count:0,sales_amount:0,mixed_refund_basis:false}});
  const [loading,setLoading]=useState(false),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
  const [selectedStore,setSelectedStore]=useState<Detail|null>(null);
  const [selectedStoreId,setSelectedStoreId]=useState<number|null>(null),[detailAllHistory,setDetailAllHistory]=useState(false);
  const [detailLoading,setDetailLoading]=useState(false),detailRequestSeq=useRef(0);
  const [revisionsFor,setRevisionsFor]=useState<number|null>(null),[revisions,setRevisions]=useState<Revision[]>([]);
  const [editing,setEditing]=useState<Activity|null>(null),[draft,setDraft]=useState<ActivityDraft>(emptyDraft);
  const [showActivityForm,setShowActivityForm]=useState(false);
  const [revokeTarget,setRevokeTarget]=useState<Activity|null>(null),[revokeReason,setRevokeReason]=useState("");
  const [archiveForm,setArchiveForm]=useState({brand_name:"",store_name:"",province:"",city:"",address:"",poi_id:""});
  const [showArchiveForm,setShowArchiveForm]=useState(false);
  const [pending,setPending]=useState<PendingPage>({rows:[],total:0});
  const [pendingPage,setPendingPage]=useState(1);
  const [pendingChoices,setPendingChoices]=useState<Record<number,number>>({}),[pendingSelected,setPendingSelected]=useState<number[]>([]);
  const [pendingManualCandidates,setPendingManualCandidates]=useState<Record<number,Candidate>>({});
  const [pendingFeedback,setPendingFeedback]=useState<Record<number,{error:boolean;text:string;details:string[]}>>({});
  const pendingLinkLock=useRef(false),pendingMutationScroll=useRef(false);
  const [importFile,setImportFile]=useState<File|null>(null),[defaultYear,setDefaultYear]=useState(new Date().getFullYear());
  const [preview,setPreview]=useState<Preview|null>(null),[previewPage,setPreviewPage]=useState(1);
  const [conflictActions,setConflictActions]=useState<Record<string,"update"|"skip">>({});
  const [refundBasis,setRefundBasis]=useState<Activity["refund_basis"]>("unknown");
  const [accessRows,setAccessRows]=useState<Array<{id:number;email:string;display_name:string;role:string;can_view:boolean;can_export:boolean}>>([]);

  const params=useMemo(()=>{
    const value=new URLSearchParams({page:String(page),page_size:"50"});
    Object.entries(filter).forEach(([key,item])=>{if(item)value.set(key,item)});
    return value.toString();
  },[filter,page]);
  const detailParams=useMemo(()=>{
    if(detailAllHistory)return "";
    const value=new URLSearchParams();
    Object.entries(filter).forEach(([key,item])=>{if(item)value.set(key,item)});
    return value.toString();
  },[filter,detailAllHistory]);
  const detailScopeLabel=detailAllHistory?"全历史":`当前筛选：${[filter.brand,filter.province,filter.city,filter.year?`${filter.year} 年`:"",filter.start?`从 ${filter.start}`:"",filter.end?`至 ${filter.end}`:"",filter.refund_basis==="refunded"?"已扣退款":filter.refund_basis==="not_refunded"?"未扣退款":filter.refund_basis==="unknown"?"退款口径未知":""].filter(Boolean).join(" · ")||"不限"}`;
  const availableProvinces=useMemo(()=>[...new Set(facets.rows.filter(row=>!filter.brand||row.brand_name===filter.brand).map(row=>row.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-CN")),[facets,filter.brand]);
  const availableCities=useMemo(()=>[...new Set(facets.rows.filter(row=>(!filter.brand||row.brand_name===filter.brand)&&(!filter.province||row.province===filter.province)).map(row=>row.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-CN")),[facets,filter.brand,filter.province]);
  const loadOverview=useCallback(async()=>{
    if(filter.start&&filter.end&&filter.end<filter.start){setNotice("活动结束日期不能早于开始日期");return}
    setLoading(true);
    try{setStorePage(await call<StorePage>(api,`/history/stores?${params}`));return true}
    catch(error){setNotice(errorText(error));return false}
    finally{setLoading(false)}
  },[api,params,filter.start,filter.end]);
  const loadPending=useCallback(async()=>{
    try{
      const result=await call<PendingPage>(api,`/history/pending?page=${pendingPage}&page_size=50`);
      const lastPage=Math.max(1,Math.ceil(result.total/50));
      if(pendingPage>lastPage){setPendingPage(lastPage);return true}
      setPending({...result,rows:result.rows.map(row=>({...row,id:Number(row.id),brand_store_id:row.brand_store_id==null?null:Number(row.brand_store_id)}))});return true;
    }
    catch(error){setNotice(errorText(error));return false}
  },[api,pendingPage]);
  const loadFacets=useCallback(async()=>{
    try{setFacets(await call<typeof facets>(api,"/history/facets"))}
    catch(error){setNotice(errorText(error))}
  },[api]);
  const loadDetail=useCallback(async(id:number)=>{
    const seq=++detailRequestSeq.current;
    setSelectedStore(null);setDetailLoading(true);
    try{const detail=await call<Detail>(api,`/history/stores/${id}/activities${detailParams?`?${detailParams}`:""}`);if(seq===detailRequestSeq.current){setSelectedStore(detail);setRevisionsFor(null)}}
    catch(error){if(seq===detailRequestSeq.current)setNotice(errorText(error))}
    finally{if(seq===detailRequestSeq.current)setDetailLoading(false)}
  },[api,detailParams]);
  function openDetail(id:number){
    if(selectedStoreId===id&&!detailAllHistory){void loadDetail(id);return}
    setSelectedStore(null);setSelectedStoreId(id);setDetailAllHistory(false);
  }
  function openFirstActivity(store:PendingStore){
    setDraft({...emptyDraft(),brand_name:store.brand_name,store_name:store.store_name,province:store.province,city:store.city,address:store.address||""});
    setEditing(null);setShowActivityForm(true);setSelectedStore(null);setSelectedStoreId(store.id);setDetailAllHistory(true);switchMode("overview");
  }
  async function loadRevisions(id:number){
    if(revisionsFor===id){setRevisionsFor(null);return}
    try{setRevisions(await call<Revision[]>(api,`/history/activities/${id}/revisions`));setRevisionsFor(id)}
    catch(error){setNotice(errorText(error))}
  }
  const loadAccess=useCallback(async()=>{
    try{
      const users=await call<Array<{id:number;email:string;display_name:string;role:string}>>(api,"/admin/users");
      const rows=await Promise.all(users.map(async user=>{
        const permission=await call<HistoryPermissions>(api,`/history/admin/permissions/${user.id}`);
        return {...user,can_view:permission.can_view,can_export:permission.can_export};
      }));
      setAccessRows(rows);
    }catch(error){setNotice(errorText(error))}
  },[api]);

  useEffect(()=>{
    if(!active||!permissions?.can_view||mode!=="overview")return;
    const timer=window.setTimeout(()=>void loadOverview(),0);
    return()=>window.clearTimeout(timer);
  },[active,permissions?.can_view,mode,loadOverview]);
  useEffect(()=>{
    if(!active||!permissions?.can_view||mode!=="overview"||selectedStoreId==null)return;
    const timer=window.setTimeout(()=>void loadDetail(selectedStoreId),0);
    return()=>window.clearTimeout(timer);
  },[active,permissions?.can_view,mode,selectedStoreId,loadDetail]);
  useEffect(()=>{
    if(!active||!permissions?.can_view)return;
    const timer=window.setTimeout(()=>void loadFacets(),0);
    return()=>window.clearTimeout(timer);
  },[active,permissions?.can_view,loadFacets]);
  useEffect(()=>{
    if(!active||!permissions?.can_manage||mode!=="pending")return;
    const timer=window.setTimeout(()=>void loadPending(),0);
    return()=>window.clearTimeout(timer);
  },[active,permissions?.can_manage,mode,loadPending]);
  useEffect(()=>{
    if(!active||!isAdmin||mode!=="access")return;
    const timer=window.setTimeout(()=>void loadAccess(),0);
    return()=>window.clearTimeout(timer);
  },[active,isAdmin,mode,loadAccess]);

  async function run(action:string,work:()=>Promise<void>){
    setBusy(action);setNotice("");
    try{await work()}catch(error){setNotice(errorText(error))}finally{setBusy("")}
  }
  function updateFilter(key:keyof typeof filter,value:string){setFilter(current=>({...current,[key]:value,...key==="brand"?{province:"",city:""}:key==="province"?{city:""}:{}}));setPage(1)}
  function startActivity(activity?:Activity){
    setEditing(activity||null);
    const store=selectedStore?.store;
    setDraft({start_date:activity?date(activity.start_date):"",end_date:activity?date(activity.end_date):"",activity_name:activity?.activity_name||"",sales_amount:activity?.sales_amount==null?"":String(activity.sales_amount),refund_basis:activity?.refund_basis||"unknown",brand_name:activity?.brand_name||store?.brand_name||"",store_name:activity?.store_name||store?.store_name||"",province:activity?.province||store?.province||"",city:activity?.city||store?.city||"",address:activity?.address||store?.address||"",reason:""});
    setShowActivityForm(true);
  }
  async function saveActivity(){
    if(!selectedStore)return;
    if(!draft.start_date||!draft.end_date||draft.end_date<draft.start_date){setNotice("请填写有效的活动起止日期");return}
    if(!draft.brand_name.trim()||!draft.store_name.trim()){setNotice("请填写活动发生时的品牌和门店名称");return}
    if(draft.sales_amount.trim()!==""&&(!Number.isFinite(Number(draft.sales_amount))||Number(draft.sales_amount)<0)){setNotice("销售额必须不小于 0；留空表示活动已完成但金额未记录，0 表示零销售");return}
    if(editing&&!draft.reason.trim()){setNotice("修正已有活动时请填写修改原因");return}
    await run("activity",async()=>{
      const data={history_store_id:selectedStore.store.id,start_date:draft.start_date,end_date:draft.end_date,activity_name:draft.activity_name.trim(),sales_amount:draft.sales_amount.trim()===""?null:draft.sales_amount,refund_basis:draft.refund_basis,brand_name:draft.brand_name.trim(),store_name:draft.store_name.trim(),province:draft.province.trim(),city:draft.city.trim(),address:draft.address.trim(),...editing?{reason:draft.reason.trim()}:{} };
      await call(api,editing?`/history/activities/${editing.id}`:"/history/activities",{method:editing?"PATCH":"POST",body:JSON.stringify(data)});
      setShowActivityForm(false);setEditing(null);await Promise.all([loadDetail(selectedStore.store.id),loadOverview(),loadFacets()]);
      setNotice(editing?"活动记录已修正，原值和原因已留痕。":"活动记录已新增。");
    });
  }
  async function revokeActivity(){
    if(!revokeTarget||!selectedStore||!revokeReason.trim()){setNotice("撤销活动记录需要填写原因");return}
    await run("revoke",async()=>{
      await call(api,`/history/activities/${revokeTarget.id}/revoke`,{method:"POST",body:JSON.stringify({reason:revokeReason.trim()})});
      setRevokeTarget(null);setRevokeReason("");await Promise.all([loadDetail(selectedStore.store.id),loadOverview(),loadFacets()]);
      setNotice("活动记录已撤销，原始记录和操作原因仍保留。");
    });
  }
  async function createArchive(){
    if(!archiveForm.brand_name.trim()||!archiveForm.store_name.trim()){setNotice("请填写品牌和历史门店名称");return}
    await run("archive-create",async()=>{
      const created=await call<{id:number}>(api,"/history/stores/archive",{method:"POST",body:JSON.stringify(archiveForm)});
      setShowArchiveForm(false);setArchiveForm({brand_name:"",store_name:"",province:"",city:"",address:"",poi_id:""});
      setSelectedStore(null);setSelectedStoreId(created.id);setDetailAllHistory(true);
      setDraft({...emptyDraft(),brand_name:archiveForm.brand_name.trim(),store_name:archiveForm.store_name.trim(),province:archiveForm.province.trim(),city:archiveForm.city.trim(),address:archiveForm.address.trim()});setEditing(null);setShowActivityForm(true);
      setNotice("仅历史门店档案已创建；不会计入当前品牌门店总数。请在下方补录第一场活动。");
    });
  }
  useLayoutEffect(()=>{if(!pendingMutationScroll.current||mode!=="pending")return;pendingMutationScroll.current=false;scrollMemory.restore("history:pending",workspaceRef.current??undefined)},[pending,mode,scrollMemory]);
  async function finishPendingLinks(ids:number[],message:string){
    const affected=new Set(ids.map(Number));scrollMemory.capture("history:pending",workspaceRef.current??undefined);pendingMutationScroll.current=true;
    setPending(current=>({...current,rows:current.rows.filter(row=>!affected.has(Number(row.id))),total:Math.max(0,current.total-affected.size)}));
    setPendingSelected(current=>current.filter(id=>!affected.has(Number(id))));
    setPendingChoices(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!affected.has(Number(id)))));
    setPendingManualCandidates(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!affected.has(Number(id)))));
    const results=await Promise.all([loadPending(),loadOverview(),loadFacets()]);
    setNotice(message+(results.some(value=>value===false)?" 关联已保存，但列表刷新失败，请点“刷新候选”查看最新状态。":""));
  }
  async function linkPending(links:Array<{history_store_id:number;brand_store_id:number}>):Promise<boolean>{
    if(!links.length){setNotice("请先为所选门店指定品牌库候选");return false}
    if(pendingLinkLock.current){setNotice("正在保存另一项门店关联，请等待完成");return false}
    pendingLinkLock.current=true;setBusy("link");setNotice("");
    setPendingFeedback(current=>({...current,...Object.fromEntries(links.map(link=>[link.history_store_id,{error:false,text:"正在保存关联…",details:[]}]))}));
    try{const result=await call<{linked:number;changed:number;already_linked:number;without_poi_id:number}>(api,"/history/stores/bulk-link",{method:"POST",body:JSON.stringify({links})});
      await finishPendingLinks(links.map(link=>Number(link.history_store_id)),`已确认关联 ${result.linked} 家历史门店。${result.without_poi_id?`其中 ${result.without_poi_id} 家品牌库记录未提供 POI ID，已按门店记录关联。`:"POI ID 已保存。"}`);return true;
    }catch(error){const feedback={error:true,text:errorText(error),details:historyProblemDetails(error)};setPendingFeedback(current=>({...current,...Object.fromEntries(links.map(link=>[link.history_store_id,feedback]))}));setNotice(feedback.text);return false}
    finally{pendingLinkLock.current=false;setBusy("")}
  }
  async function linkPendingPoi(store:PendingStore,poi:AmapHistoryCandidate):Promise<boolean>{
    if(pendingLinkLock.current){setNotice("正在保存另一项门店关联，请等待完成");return false}
    pendingLinkLock.current=true;setBusy("link");setNotice("");setPendingFeedback(current=>({...current,[store.id]:{error:false,text:"正在保存关联…",details:[]}}));
    try{await call(api,`/history/stores/${store.id}/confirm-poi`,{method:"POST",body:JSON.stringify({poi_id:poi.id})});await finishPendingLinks([Number(store.id)],`已补充并关联：${poi.name}，POI ID 已保存。`);return true}
    catch(error){const feedback={error:true,text:errorText(error),details:historyProblemDetails(error)};setPendingFeedback(current=>({...current,[store.id]:feedback}));setNotice(feedback.text);return false}
    finally{pendingLinkLock.current=false;setBusy("")}
  }
  async function savePendingMetadata<T extends {store?:HistoryLocationSource}>(store:PendingStore,path:string,body:unknown,message:string):Promise<T>{
    if(pendingLinkLock.current)throw new Error("正在保存另一项门店操作，请等待完成");
    pendingLinkLock.current=true;setBusy("history-metadata");setNotice("");
    setPendingFeedback(current=>({...current,[store.id]:{error:false,text:"正在保存…",details:[]}}));
    try{
      const result=await call<T>(api,`/history/stores/${store.id}/${path}`,{method:path==="location"?"PATCH":"POST",body:JSON.stringify(body)});
      scrollMemory.capture("history:pending",workspaceRef.current??undefined);pendingMutationScroll.current=true;
      setPending(current=>({...current,rows:current.rows.map(row=>row.id===store.id?{...row,...result.store}:row)}));
      setPendingFeedback(current=>({...current,[store.id]:{error:false,text:message,details:[]}}));setNotice(message);
      return result;
    }catch(error){const feedback={error:true,text:errorText(error),details:historyProblemDetails(error)};setPendingFeedback(current=>({...current,[store.id]:feedback}));throw error}
    finally{pendingLinkLock.current=false;setBusy("")}
  }
  const savePendingLocation=(store:PendingStore,draft:HistoryLocationDraft)=>savePendingMetadata<HistoryLocationResult>(store,"location",draft,"人工核实位置已保存到历史档案；仍可补充真实 POI。");
  const linkPendingAnalysis=(store:PendingStore,id:number,reason:string)=>savePendingMetadata<HistoryAnalysisLinkResult&{store?:HistoryLocationSource}>(store,"link-analysis",{analysis_store_id:id,reason},"分析记录已关联历史档案，导出可带上活动数据；仍可补充真实 POI。");
  const createPendingAnalysis=(store:PendingStore,reason:string)=>savePendingMetadata<HistoryAnalysisStart&{store?:HistoryLocationSource}>(store,"create-analysis",{reason,expected_updated_at:store.updated_at},"已准备此历史档案的分析记录。");
  function confirmPendingRow(store:PendingStore){
    const choice=pendingChoices[store.id];if(!choice){setPendingFeedback(current=>({...current,[store.id]:{error:true,text:"尚未选择候选。请在下拉框选择门店，或点击候选卡片中的“确认关联此门店”。",details:[]}}));return}
    void linkPending([{history_store_id:Number(store.id),brand_store_id:Number(choice)}]);
  }
  function confirmPendingBatch(){
    const missing=pendingSelected.filter(id=>!pendingChoices[id]);if(missing.length){setNotice(`已勾选 ${pendingSelected.length} 家，其中 ${missing.length} 家尚未指定候选。请先指定候选或取消勾选，系统未保存本次关联。`);return}
    void linkPending(pendingSelected.map(id=>({history_store_id:Number(id),brand_store_id:Number(pendingChoices[id])})));
  }
  async function archivePending(id:number){
    await run("archive-pending",async()=>{
      await call(api,`/history/stores/${id}/archive`,{method:"POST",body:JSON.stringify({reason:"历史活动门店，无可确认的当前品牌库门店"})});
      await Promise.all([loadPending(),loadOverview()]);setNotice("已建立仅历史门店档案，历史活动会进入主页，但不计入当前门店库。");
    });
  }
  async function uploadPreview(){
    if(!importFile){setNotice("请选择 Excel 文件");return}
    await run("preview",async()=>{
      const form=new FormData();form.append("file",importFile);form.append("default_year",String(defaultYear));
      const data=await call<Preview>(api,"/history/imports/preview",{method:"POST",body:form});
      setPreview(withStoreConflicts(data,data.store_conflicts||[]));setPreviewPage(1);setConflictActions({});setNotice(`已预览 ${data.rows.length} 行门店、${data.columns.length} 个活动日期列。核对品牌、年份和关联候选后再保存。`);
    });
  }
  function updateColumn(index:number,patch:Partial<ImportColumn>){
    setPreview(current=>current?{...current,columns:current.columns.map(column=>column.index===index?{...column,...patch}:column)}:current);
  }
  function updateRow(number:number,patch:Partial<ImportRow>){
    setPreview(current=>current?{...current,rows:current.rows.map(row=>row.row_number===number?{...row,...patch}:row)}:current);
  }
  const conflicts=(preview?.conflicts||[]).filter(item=>!preview?.columns.find(column=>column.index===item.column_index)?.ignore);
  const invalidSalesCells=(preview?.rows||[]).flatMap(row=>Object.entries(row.values||{}).filter(([index,value])=>!preview?.columns.find(column=>column.index===Number(index))?.ignore&&!validSalesValue(value)).map(([index,value])=>`${excelColumn(Number(index))}${row.row_number}（${value}）`));
  const previewTotals=useMemo(()=>{
    if(!preview)return {events:0,sales:"0.00"};
    const active=new Set(preview.columns.filter(column=>!column.ignore).map(column=>String(column.index)));
    let events=0,cents=BigInt(0);
    for(const row of preview.rows)for(const [index,raw] of Object.entries(row.values||{})){
      if(!active.has(index)||!validSalesValue(raw))continue;
      const [whole,fraction=""]=raw.replace(/[,，\s￥¥]/g,"").split(".");
      cents+=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));events++;
    }
    return {events,sales:`${(cents/BigInt(100)).toLocaleString("zh-CN")}.${String(cents%BigInt(100)).padStart(2,"0")}`};
  },[preview]);
  const unresolved=conflicts.filter(item=>!conflictActions[`${item.row_number}:${item.column_index}`]).length;
  async function commitPreview(){
    if(!preview)return;
    if(preview.columns.some(column=>!column.ignore&&(!column.start_date||!column.end_date||column.end_date<column.start_date))){setNotice("请核对未忽略列的完整起止年月日");return}
    if(invalidSalesCells.length){setNotice(`有 ${invalidSalesCells.length} 个活动销售额无效，请修正原 Excel 后重新上传，或明确忽略不属于活动的整列`);return}
    if(unresolved){setNotice(`还有 ${unresolved} 处重复活动冲突尚未选择更新或跳过`);return}
    await run("commit",async()=>{
      const data={default_year:defaultYear,columns:preview.columns.map(({index,start_date,end_date,activity_name,name,ignore})=>({index,start_date,end_date,name:activity_name||name||"",ignore:Boolean(ignore)})),rows:preview.rows.map(row=>({row_number:row.row_number,brand:row.brand,province:row.province,city:row.city,name:row.name,address:row.address,poi_id:row.poi_id,brand_store_id:row.brand_store_id||undefined,history_store_id:row.history_store_id||undefined})),refund_basis:refundBasis,conflicts:conflicts.filter(item=>!preview.columns.find(column=>column.index===item.column_index)?.ignore).map(item=>({row_number:item.row_number,column_index:item.column_index,action:conflictActions[`${item.row_number}:${item.column_index}`]}))};
      let result:Record<string,number>;
      try{result=await call<Record<string,number>>(api,`/history/imports/${preview.import_id}/commit`,{method:"POST",body:JSON.stringify(data)})}
      catch(error){
        const details=error instanceof ApiProblem&&error.details&&typeof error.details==="object"?error.details as {conflicts?:Conflict[];store_conflicts?:StoreConflict[]}:null;
        if(details?.conflicts?.length){setPreview(current=>{if(!current)return current;const byCell=new Map((current.conflicts||[]).map(item=>[`${item.row_number}:${item.column_index}`,item]));details.conflicts!.forEach(item=>byCell.set(`${item.row_number}:${item.column_index}`,item));return {...current,conflicts:[...byCell.values()]}})}
        if(details?.store_conflicts?.length){const firstIndex=preview.rows.findIndex(row=>row.row_number===details.store_conflicts![0].row_number);if(firstIndex>=0)setPreviewPage(Math.floor(firstIndex/30)+1);setPreview(current=>current?withStoreConflicts(current,details.store_conflicts!):current)}
        throw error;
      }
      setPreview(null);setImportFile(null);await Promise.all([loadOverview(),loadPending(),loadFacets()]);
      setNotice(`导入已完成：${Object.entries(result).map(([key,value])=>`${key} ${value}`).join("，")}。待匹配门店可在独立清单中处理。`);
    });
  }
  async function saveAccess(id:number,can_view:boolean,can_export:boolean){
    await run(`access-${id}`,async()=>{
      const next=await call<HistoryPermissions>(api,`/history/admin/permissions/${id}`,{method:"PUT",body:JSON.stringify({can_view,can_export})});
      setAccessRows(current=>current.map(row=>row.id===id?{...row,can_view:next.can_view,can_export:next.can_export}:row));
      setNotice("销售数据权限已更新。");
    });
  }
  if(!permissions)return <section className="panel history-activities"><p>正在检查历史销售数据权限…</p></section>;
  if(!permissions.can_view)return <section className="panel history-activities"><h2>历史活动数据</h2><p>当前账号未获历史销售数据查看权限。请联系管理员授权。</p></section>;

  return <div className="history-activities" ref={workspaceRef}>
    <section className="panel history-intro"><div><h2>历史活动数据</h2><p>按活动发生时的品牌和地区归类；历史销售额为活动商品的原始上报金额。首版只用于查阅和导出。</p></div><div className="history-subtabs"><button className={mode==="overview"?"on":""} onClick={()=>switchMode("overview")}>活动门店</button>{permissions.can_manage&&<><button className={mode==="pending"?"on":""} onClick={()=>switchMode("pending")}>待匹配门店</button><button className={mode==="import"?"on":""} onClick={()=>switchMode("import")}>导入活动表</button></>}{isAdmin&&<button className={mode==="access"?"on":""} onClick={()=>switchMode("access")}>销售权限</button>}</div></section>
    {notice&&<div className={mode==="pending"?"history-operation-toast":"job-notice"} role="status" aria-live="polite" aria-atomic="true">{notice}{mode==="pending"&&<button type="button" aria-label="关闭操作提示" onClick={()=>setNotice("")}>关闭</button>}</div>}
    {mode==="overview"&&<>
      <section className="panel history-filter-panel">
        <div className="history-filter-grid">
          <label>品牌<select value={filter.brand} onChange={event=>updateFilter("brand",event.target.value)}><option value="">全部品牌</option>{facets.brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
          <label>省份<select value={filter.province} onChange={event=>updateFilter("province",event.target.value)}><option value="">全部省份</option>{availableProvinces.map(province=><option key={province} value={province}>{province}</option>)}</select></label>
          <label>城市<select value={filter.city} onChange={event=>updateFilter("city",event.target.value)}><option value="">全部城市</option>{availableCities.map(city=><option key={city} value={city}>{city}</option>)}</select></label>
          <label>年份<select value={filter.year} onChange={event=>updateFilter("year",event.target.value)}><option value="">全部年份</option>{Array.from({length:new Date().getFullYear()-1900+1},(_,index)=>new Date().getFullYear()-index).map(year=><option key={year} value={year}>{year} 年</option>)}</select></label>
          <label>开始日期<input type="date" value={filter.start} onChange={event=>updateFilter("start",event.target.value)}/></label>
          <label>结束日期<input type="date" value={filter.end} onChange={event=>updateFilter("end",event.target.value)}/></label>
          <label>退款口径<select value={filter.refund_basis} onChange={event=>updateFilter("refund_basis",event.target.value)}><option value="">全部口径</option><option value="refunded">已扣退款</option><option value="not_refunded">未扣退款</option><option value="unknown">未知</option></select></label>
          <button onClick={()=>{setFilter({brand:"",province:"",city:"",year:"",start:"",end:"",refund_basis:""});setPage(1)}}>清空筛选</button>
          <button onClick={()=>void loadOverview()} disabled={loading}>刷新</button>
        </div>
        <p className="selection-note">按活动开始日筛选整场活动；跨年活动归入开始年份，金额不拆分到每天。</p>
      </section>
      <div className="history-kpis"><article className="panel"><small>活动门店</small><strong>{storePage.metrics.store_count}</strong><span>仅含已匹配或仅历史档案</span></article><article className="panel"><small>活动场次</small><strong>{storePage.metrics.activity_count}</strong><span>已完成活动，包含零销售</span></article><article className="panel"><small>{Number(storePage.metrics.unknown_amount_count)>0?"已知原始上报销售额":"原始上报销售额"}</small><strong>{storePage.metrics.sales_amount==null?"未记录":`¥ ${amount(storePage.metrics.sales_amount)}`}</strong><span>活动商品销售额</span></article></div>
      {(storePage.metrics.mixed_refund_basis||Number(storePage.metrics.unknown_amount_count)>0)&&<p className="history-caveat">{storePage.metrics.mixed_refund_basis&&"当前汇总混合了已扣退款、未扣退款或未知口径，不可直接当作统一净销售额。"}{Number(storePage.metrics.unknown_amount_count)>0&&`另有 ${storePage.metrics.unknown_amount_count} 场活动的销售额未记录，未计入金额合计。`}</p>}
      <section className="panel history-table-panel"><div className="panel-head"><div><h2>门店历史活动</h2><p>一店一行，共 {storePage.total} 家；包含尚未匹配的已导入活动，无需 POI ID 即可查看。</p></div>{permissions.can_manage&&<button onClick={()=>setShowArchiveForm(current=>!current)}>＋ 建立仅历史门店档案</button>}</div>
        {showArchiveForm&&permissions.can_manage&&<div className="history-editor"><h3>建立仅历史门店档案</h3><p>用于已停业或品牌库找不到的老店，不计入当前品牌门店总数。</p><div className="history-form-grid">{(["brand_name","store_name","province","city","address","poi_id"] as const).map(key=><label key={key}>{({brand_name:"品牌",store_name:"门店名称",province:"省份",city:"城市",address:"地址",poi_id:"高德 POI ID（可空）"})[key]}<input value={archiveForm[key]} onChange={event=>setArchiveForm(current=>({...current,[key]:event.target.value}))}/></label>)}</div><div className="history-actions"><button onClick={()=>setShowArchiveForm(false)}>取消</button><button className="primary" disabled={busy!==""} onClick={()=>void createArchive()}>保存历史档案</button></div></div>}
        <div className="table-wrap history-store-table" data-scroll-memory="history-stores"><table><thead><tr><th>活动时品牌／门店</th><th>活动时省市</th><th>场次</th><th>最近活动</th><th>销售额（元）</th><th>当前门店</th><th>操作</th></tr></thead><tbody>{loading&&!storePage.rows.length?<tr><td colSpan={7}>正在读取历史活动…</td></tr>:!storePage.rows.length?<tr><td colSpan={7}>当前筛选下暂无已完成活动门店。未匹配不会影响历史活动展示。</td></tr>:storePage.rows.map(store=><tr key={store.id}><td><b>{store.brand_name||"品牌待确认"}</b><small>{store.store_name}</small></td><td>{store.province||"—"} {store.city||""}</td><td>{store.activity_count}</td><td>{date(store.latest_activity_start)}</td><td>{store.sales_amount==null?"未记录":`¥ ${amount(store.sales_amount)}`}{Number(store.unknown_amount_count)>0&&<small>{store.sales_amount!=null&&"已知金额合计；"}{store.unknown_amount_count} 场销售额缺失</small>}</td><td>{store.archive_only?"无当前品牌库门店":store.current_store_name||"—"}<small>{currentStoreStatus(store)}</small></td><td><button onClick={()=>openDetail(store.id)}>查看逐场</button></td></tr>)}</tbody></table></div>
        <div className="library-pagination"><button disabled={page<=1||loading} onClick={()=>setPage(current=>current-1)}>上一页</button><span>第 {page} 页 · 共 {storePage.total} 家</span><button disabled={loading||page*50>=storePage.total} onClick={()=>setPage(current=>current+1)}>下一页</button></div>
      </section>
      {selectedStoreId!=null&&detailLoading&&<section className="panel history-detail" role="status">正在读取逐场活动…</section>}{selectedStore&&<section className="panel history-detail"><div className="panel-head"><div><h2>{selectedStore.store.store_name}</h2><p>{selectedStore.store.brand_name} · {selectedStore.store.province} {selectedStore.store.city} · 当前关联：{selectedStore.store.archive_only?"仅历史档案":selectedStore.store.current_store_name||"未关联"} · {currentStoreStatus(selectedStore.store)}</p><p className="history-detail-scope">逐场范围：{detailScopeLabel}。已撤销记录仅供核对，不计入汇总。</p></div><div className="history-actions"><button onClick={()=>setDetailAllHistory(current=>!current)}>{detailAllHistory?"查看当前筛选范围":"查看该店全历史"}</button>{permissions.can_manage&&<button onClick={()=>startActivity()}>＋ 补录活动</button>}<button onClick={()=>{detailRequestSeq.current++;setSelectedStore(null);setSelectedStoreId(null);setDetailLoading(false);setDetailAllHistory(false);setShowActivityForm(false)}}>关闭</button></div></div>
        <div className="table-wrap history-event-table" data-scroll-memory="history-events"><table><thead><tr><th>活动日期</th><th>活动／日历标注</th><th>活动时品牌／省市</th><th>活动商品销售额</th><th>退款口径</th><th>来源</th>{permissions.can_manage&&<th>管理</th>}</tr></thead><tbody>{!selectedStore.rows.length?<tr><td colSpan={permissions.can_manage?7:6}>{detailAllHistory?"该店暂无活动；可手工补录。":"当前筛选范围内无活动；可切换至该店全历史。"}</td></tr>:selectedStore.rows.map(activity=><tr key={activity.id} className={activity.revoked_at?"history-revoked":""}><td>{date(activity.start_date)} 至 {date(activity.end_date)}</td><td><b>{activity.activity_name||`${date(activity.start_date)}—${date(activity.end_date)}`}</b><small>{activity.calendar_tags?.join(" · ")||""}</small><button className="history-revisions-link" onClick={()=>void loadRevisions(activity.id)}>变更记录</button>{activity.revoked_at&&<small>已撤销 · {formatBeijingDateTime(activity.revoked_at)}</small>}</td><td>{activity.brand_name||selectedStore.store.brand_name}<small>{activity.province} {activity.city}</small></td><td>{activity.sales_amount==null?"未记录":`¥ ${amount(activity.sales_amount)}`}</td><td>{activity.refund_basis==="refunded"?"已扣退款":activity.refund_basis==="not_refunded"?"未扣退款":"未知"}</td><td>{activity.source_import_id?<>导入 #{activity.source_import_id}{permissions.can_manage&&<small><a href={`${api}/history/imports/${activity.source_import_id}/file`}>下载原文件</a></small>}</>:"手工补录"}<small>{[activity.source_sheet,activity.source_cell].filter(Boolean).join(" · ")}</small></td>{permissions.can_manage&&<td>{!activity.revoked_at&&<><button onClick={()=>startActivity(activity)}>修正</button><button className="danger-btn" onClick={()=>{setRevokeTarget(activity);setRevokeReason("")}}>撤销</button></>}</td>}</tr>)}</tbody></table></div>
        {revisionsFor&&<div className="history-editor"><div className="panel-head"><h3>活动 #{revisionsFor} 的变更记录</h3><button onClick={()=>setRevisionsFor(null)}>收起</button></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>原金额</th><th>新金额</th><th>原因</th></tr></thead><tbody>{revisions.map(item=><tr key={item.id}><td>{formatBeijingDateTime(item.changed_at)}</td><td>{item.action}</td><td>{item.before_json?.sales_amount==null?"—":`¥ ${amount(item.before_json.sales_amount)}`}</td><td>{item.after_json?.sales_amount==null?"—":`¥ ${amount(item.after_json.sales_amount)}`}</td><td>{item.reason||"—"}</td></tr>)}</tbody></table></div></div>}
        {showActivityForm&&permissions.can_manage&&<div className="history-editor"><h3>{editing?"修正活动记录":"补录活动记录"}</h3><div className="history-form-grid"><label>开始日期<input type="date" value={draft.start_date} onChange={event=>setDraft(current=>({...current,start_date:event.target.value}))}/></label><label>结束日期<input type="date" value={draft.end_date} onChange={event=>setDraft(current=>({...current,end_date:event.target.value}))}/></label><label>活动名称（可选）<input value={draft.activity_name} onChange={event=>setDraft(current=>({...current,activity_name:event.target.value}))} placeholder="默认显示日期段"/></label><label>活动商品销售额（元）<input type="number" min="0" step="0.01" value={draft.sales_amount} onChange={event=>setDraft(current=>({...current,sales_amount:event.target.value}))} placeholder="留空＝金额缺失；0＝零销售"/></label><label>退款口径<select value={draft.refund_basis} onChange={event=>setDraft(current=>({...current,refund_basis:event.target.value as Activity["refund_basis"]}))}><option value="unknown">未知</option><option value="refunded">已扣退款</option><option value="not_refunded">未扣退款</option></select></label>{editing&&<label>修正原因<input value={draft.reason} onChange={event=>setDraft(current=>({...current,reason:event.target.value}))} placeholder="必填，修改留痕"/></label>}</div><p>以下信息按活动发生时保存；老店更名、迁址后可保留当时的归属。</p><div className="history-form-grid">{(["brand_name","store_name","province","city","address"] as const).map(key=><label key={key}>{({brand_name:"活动时品牌",store_name:"活动时门店名称",province:"活动时省份",city:"活动时城市",address:"活动时地址"})[key]}<input value={draft[key]} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}/></label>)}</div><div className="history-actions"><button onClick={()=>setShowActivityForm(false)}>取消</button><button className="primary" disabled={busy!==""} onClick={()=>void saveActivity()}>保存活动</button></div></div>}
        {revokeTarget&&permissions.can_manage&&<div className="history-editor"><h3>撤销 {date(revokeTarget.start_date)} 的活动记录</h3><p>撤销会留痕，不会擦除原始来源。</p><label>撤销原因<input value={revokeReason} onChange={event=>setRevokeReason(event.target.value)} placeholder="必填"/></label><div className="history-actions"><button onClick={()=>setRevokeTarget(null)}>取消</button><button className="danger-btn" disabled={busy!==""} onClick={()=>void revokeActivity()}>确认撤销</button></div></div>}
      </section>}
    </>}
    {mode==="pending"&&permissions.can_manage&&<section className="panel history-table-panel"><HistoryMatchingPanel api={api} onChanged={async(ids)=>{if(ids?.length)await finishPendingLinks(ids,"历史门店关联已保存。");else await Promise.all([loadPending(),loadOverview(),loadFacets()])}}/><div className="panel-head"><div><h2>待匹配／仅历史档案</h2><p>下拉候选来自现有品牌门店库；可直接按门店名查询，或展开“补充线索／无 POI 处理”填写地址、分享位置并地图选点。无法取得真实 POI 时，也可人工核实历史位置、关联分析记录。仅凭名称相似不会自动关联；历史活动始终保留。共 {pending.total} 家。</p></div><button onClick={()=>void loadPending()}>刷新候选</button></div><div className="history-actions"><button disabled={busy!==""||!pendingSelected.length} onClick={confirmPendingBatch}>批量确认关联（{pendingSelected.filter(id=>pendingChoices[id]).length}/{pendingSelected.length}）</button><button onClick={()=>setPendingSelected([])}>清空选择</button><small>单家关联无需勾选；勾选仅用于批量操作。已勾选 {pendingSelected.length} 家，已指定候选 {pendingSelected.filter(id=>pendingChoices[id]).length} 家。</small></div><div className="table-wrap history-pending-table" data-scroll-memory="history-pending"><table><thead><tr><th>选择</th><th>历史门店</th><th>地区／活动</th><th>品牌库匹配候选</th><th>操作</th></tr></thead><tbody>{!pending.rows.length?<tr><td colSpan={5}>暂无待匹配记录。</td></tr>:pending.rows.map(store=><tr key={store.id}><td><input type="checkbox" checked={pendingSelected.includes(store.id)} onChange={event=>setPendingSelected(current=>event.target.checked?[...current,store.id]:current.filter(id=>id!==store.id))}/></td><td><b>{store.brand_name||"品牌待确认"}</b><small>{store.store_name}</small><small>{store.poi_id||"原表未提供真实 POI ID"}</small>{store.location_confirmed_at&&<small className="history-verified-location">位置已人工核实 · {store.verified_address}<br/>GCJ-02 {store.verified_longitude}, {store.verified_latitude}</small>}{store.candidate_error&&<small role="status">候选查询提示：{store.candidate_error}</small>}{store.is_empty_archive&&<small className="history-empty-archive">仅历史档案 · 尚无活动</small>}</td><td>{store.province} {store.city}<small>{store.activity_count} 场 · {store.sales_amount==null?"销售额未记录":`¥ ${amount(store.sales_amount)}`}</small>{Number(store.unknown_amount_count)>0&&<small>{store.sales_amount!=null&&"已知金额合计；"}{store.unknown_amount_count} 场销售额缺失</small>}</td><td><CandidateLookup api={api} historyStoreId={store.id} historySource={store} disabled={busy!==""} onSaveLocation={draft=>savePendingLocation(store,draft)} onLinkAnalysis={(id,reason)=>linkPendingAnalysis(store,id,reason)} onCreateAnalysis={reason=>createPendingAnalysis(store,reason)} onStartAnalysis={onStartAnalysis} cachedCandidates={store.poi_candidates} onLinked={async(message)=>{await finishPendingLinks([Number(store.id)],message||"门店关联已保存。")}} onConfirmPoi={async(poi)=>linkPendingPoi(store,poi)} onConfirmCandidate={async(candidate)=>linkPending([{history_store_id:Number(store.id),brand_store_id:Number(candidate.id)}])} brand={store.brand_name||""} province={store.province||""} city={store.city||""} initial={[...(store.candidates||[]),...(pendingManualCandidates[store.id]?[pendingManualCandidates[store.id]]:[])]} selectedId={pendingChoices[store.id]||null} label={`${store.store_name}匹配候选`} onSelect={candidate=>{setPendingChoices(current=>({...current,[store.id]:candidate?.id||0}));setPendingFeedback(current=>({...current,[store.id]:{error:false,text:"",details:[]}}));if(candidate)setPendingManualCandidates(current=>({...current,[store.id]:candidate}))}}/><small>请核对品牌、省市、名称和地址；同名门店不可仅凭相似度确认。</small></td><td className="history-pending-actions"><button disabled={busy!==""} onClick={()=>confirmPendingRow(store)}>{busy==="link"&&pendingFeedback[store.id]?.text==="正在保存关联…"?"正在保存…":"确认关联"}</button>{pendingFeedback[store.id]?.text&&<div className={pendingFeedback[store.id].error?"history-inline-error":"history-inline-status"} role={pendingFeedback[store.id].error?"alert":"status"}>{pendingFeedback[store.id].text}{pendingFeedback[store.id].details.map((detail,index)=><small key={index}>{detail}</small>)}</div>}{store.is_empty_archive?<button onClick={()=>openFirstActivity(store)}>补录首场</button>:<button disabled={busy!==""} onClick={()=>void archivePending(store.id)}>设为仅历史档案</button>}</td></tr>)}</tbody></table></div><div className="library-pagination"><button disabled={pendingPage<=1} onClick={()=>setPendingPage(current=>current-1)}>上一页</button><span>第 {pendingPage}/{Math.max(1,Math.ceil(pending.total/50))} 页</span><button disabled={pendingPage*50>=pending.total} onClick={()=>setPendingPage(current=>current+1)}>下一页</button></div></section>}
    {mode==="import"&&permissions.can_manage&&<section className="panel history-import"><div className="panel-head"><div><h2>导入历史活动 Excel</h2><p>支持每行一家门店、每个日期段一场活动的宽表；多品牌可在品牌列逐行填写。空白格无活动，数字 0 表示已完成但零销售。</p></div></div><datalist id="history-brand-options">{[...new Set([...brands,...facets.brands])].map(brand=><option key={brand} value={brand}/>)}</datalist>
      <div className="history-import-controls"><label>Excel 文件<input type="file" accept=".xlsx" onChange={event=>{setImportFile(event.target.files?.[0]||null);setPreview(null)}}/></label><label>默认年份<input type="number" min="2000" max="2100" value={defaultYear} onChange={event=>setDefaultYear(Number(event.target.value))}/></label><button className="primary" disabled={busy!==""||!importFile} onClick={()=>void uploadPreview()}>{busy==="preview"?"正在预览…":"上传并预览"}</button></div>
      {preview&&<><div className="history-import-summary"><strong>{preview.rows.length} 行门店 · {preview.columns.length} 个活动日期列 · {previewTotals.events} 场 · ¥ {previewTotals.sales}</strong><span>金额按当前未忽略的有效单元格汇总，0 元计为一场；请与原表核对。原文件、工作表和单元格来源会保留。</span></div>{(preview.issues||[]).length>0&&<div className="history-caveat">{(preview.issues||[]).map((issue,index)=><p key={index}>{issue}</p>)}</div>}
        <h3>核对活动日期列</h3><div className="table-wrap history-import-columns"><table><thead><tr><th>原表列</th><th>处理</th><th>完整开始日期</th><th>完整结束日期</th><th>活动名称（可选）</th></tr></thead><tbody>{preview.columns.map(column=><tr key={column.index}><td>{column.header}<small>Excel 第 {column.index} 列</small></td><td><label className="history-skip-column"><input type="checkbox" checked={Boolean(column.ignore)} onChange={event=>updateColumn(column.index,{ignore:event.target.checked})}/> 忽略此列</label></td><td><input type="date" disabled={column.ignore} value={date(column.start_date)==="—"?"":date(column.start_date)} onChange={event=>updateColumn(column.index,{start_date:event.target.value})}/></td><td><input type="date" disabled={column.ignore} value={date(column.end_date)==="—"?"":date(column.end_date)} onChange={event=>updateColumn(column.index,{end_date:event.target.value})}/></td><td><input disabled={column.ignore} value={column.activity_name||column.name||""} onChange={event=>updateColumn(column.index,{activity_name:event.target.value})} placeholder="默认日期段"/></td></tr>)}</tbody></table></div><p className="selection-note">仅对原表的非活动附加列勾选“忽略”；被忽略列不会生成活动记录。</p>
        <h3>核对门店与品牌</h3><p className="selection-note">“湖北武汉”之类前缀仅用于推测省市；没有唯一 POI ID 时请人工核对候选。同品牌同名同城门店需补充地址或 POI ID 以消除歧义。未关联行导入后进入待匹配清单。</p><div className="table-wrap history-import-rows" data-scroll-memory="history-import-rows"><table><thead><tr><th>原表行／门店</th><th>品牌</th><th>省份</th><th>城市</th><th>地址（可补）</th><th>POI ID（可补）</th><th>品牌库候选</th><th>问题</th></tr></thead><tbody>{preview.rows.slice((previewPage-1)*30,previewPage*30).map(row=><tr key={row.row_number}><td>第 {row.row_number} 行<input value={row.name} onChange={event=>updateRow(row.row_number,{name:event.target.value})}/></td><td><input list="history-brand-options" value={row.brand||""} onChange={event=>updateRow(row.row_number,{brand:event.target.value})} placeholder="逐行填写品牌"/></td><td><input value={row.province||""} onChange={event=>updateRow(row.row_number,{province:event.target.value})}/></td><td><input value={row.city||""} onChange={event=>updateRow(row.row_number,{city:event.target.value})}/></td><td><input value={row.address||""} onChange={event=>updateRow(row.row_number,{address:event.target.value})} placeholder="用于区分同名店"/></td><td><input value={row.poi_id||""} onChange={event=>updateRow(row.row_number,{poi_id:event.target.value})} placeholder="高德 POI ID"/></td><td>{(row.history_store_candidate||(row.history_store_candidates||[]).length>0)&&<label className="history-reimport-choice">确认沿用历史档案<select value={row.history_store_id||""} onChange={event=>updateRow(row.row_number,{history_store_id:Number(event.target.value)||null})}><option value="">暂不沿用；新档案或待匹配</option>{[...new Map([...(row.history_store_candidate?[row.history_store_candidate]:[]),...(row.history_store_candidates||[])].map(candidate=>[candidate.id,candidate] as const)).values()].map(candidate=><option key={candidate.id} value={candidate.id}>#{candidate.id} · {candidate.brand_name} {candidate.store_name} · {candidate.province} {candidate.city} · {candidate.address||"地址未知"} · {candidate.poi_id||"无 POI ID"}</option>)}</select><small>同 POI 已有历史档案时，必须核对并明确选择；仅选品牌库候选不能跳过此核对。</small></label>}{row.auto_match_id&&<small>唯一 POI ID 可自动关联品牌库 #{row.auto_match_id}</small>}<CandidateLookup api={api} brand={row.brand||""} province={row.province||""} city={row.city||""} initial={row.candidates||[]} selectedId={row.brand_store_id||null} label={`第 ${row.row_number} 行品牌库候选`} onSelect={candidate=>updateRow(row.row_number,{brand_store_id:candidate?.id||null,candidates:candidate?[...new Map([...(row.candidates||[]),candidate].map(value=>[value.id,value])).values()]:row.candidates})}/></td><td>{row.issues?.join("；")||"—"}</td></tr>)}</tbody></table></div><div className="library-pagination"><button disabled={previewPage<=1} onClick={()=>setPreviewPage(current=>current-1)}>上一页</button><span>第 {previewPage}/{Math.max(1,Math.ceil(preview.rows.length/30))} 页</span><button disabled={previewPage*30>=preview.rows.length} onClick={()=>setPreviewPage(current=>current+1)}>下一页</button></div>
        {conflicts.length>0&&<div className="history-conflicts"><h3>重复活动冲突（{conflicts.length}）</h3><p>同店同日期已有记录。请逐项确认更新或跳过；不会重复累计。</p><div className="table-wrap"><table><thead><tr><th>原表位置</th><th>原销售额</th><th>新销售额</th><th>决定</th></tr></thead><tbody>{conflicts.map(item=><tr key={`${item.row_number}:${item.column_index}`}><td>第 {item.row_number} 行／第 {item.column_index} 列</td><td>{(item.existing_amount??item.existing_sales_amount)==null?"未记录":`¥ ${amount(item.existing_amount??item.existing_sales_amount)}`}</td><td>{(item.incoming_amount??item.incoming_sales_amount)==null?"未记录":`¥ ${amount(item.incoming_amount??item.incoming_sales_amount)}`}</td><td><select value={conflictActions[`${item.row_number}:${item.column_index}`]||""} onChange={event=>setConflictActions(current=>({...current,[`${item.row_number}:${item.column_index}`]:event.target.value as "update"|"skip"}))}><option value="">请选择</option><option value="skip">保留原记录</option><option value="update">更新并留痕</option></select></td></tr>)}</tbody></table></div></div>}
        {invalidSalesCells.length>0&&<div className="history-caveat" role="alert"><b>{invalidSalesCells.length} 个非数字活动单元格不能导入</b><p>请修正原 Excel 后重新上传；若整列不是活动数据，可在上方明确勾选“忽略此列”。来源位置：{invalidSalesCells.slice(0,20).join("、")}{invalidSalesCells.length>20?"……":""}</p></div>}
        <div className="history-import-footer"><label>金额退款口径<select value={refundBasis} onChange={event=>setRefundBasis(event.target.value as Activity["refund_basis"])}><option value="unknown">未知，保存原值</option><option value="refunded">已扣退款</option><option value="not_refunded">未扣退款</option></select></label><a href={`${api}/history/imports/${preview.import_id}/file`}>查看原始文件</a><button className="primary" disabled={busy!==""||unresolved>0||invalidSalesCells.length>0} onClick={()=>void commitPreview()}>{busy==="commit"?"正在写入…":`确认导入${unresolved?`（待处理 ${unresolved} 个冲突）`:""}`}</button></div>
      </>}
    </section>}
    {mode==="access"&&isAdmin&&<section className="panel history-table-panel"><div className="panel-head"><div><h2>历史销售数据权限</h2><p>管理员默认可维护；其他账号分别授权查看与导出。导出权限需要查看权限。</p></div><button onClick={()=>void loadAccess()}>刷新账号</button></div><div className="table-wrap"><table><thead><tr><th>账号</th><th>角色</th><th>查看销售</th><th>导出销售</th></tr></thead><tbody>{accessRows.map(user=><tr key={user.id}><td>{user.display_name}<small>{user.email}</small></td><td>{user.role==="admin"?"管理员":"成员"}</td><td><input type="checkbox" checked={user.role==="admin"||user.can_view} disabled={user.role==="admin"||busy!==""} onChange={event=>void saveAccess(user.id,event.target.checked,event.target.checked?user.can_export:false)}/></td><td><input type="checkbox" checked={user.role==="admin"||user.can_export} disabled={user.role==="admin"||busy!==""} onChange={event=>void saveAccess(user.id,event.target.checked?true:user.can_view,event.target.checked)}/></td></tr>)}</tbody></table></div></section>}
  </div>;
}
