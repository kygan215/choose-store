"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./globals.css";

type Candidate = {
  id: string; name: string; address: string; city: string; district: string;
  location: [number, number]; type: string; typecode: string; score: number;
  status: string; reasons: string[]; province?: string; adcode?: string;
  formatted_address?: string; level?: string; source?: string;
  breakdown?: Array<{label:string;points:number;kind:string}>;
  conflicts?: string[]; warnings?: string[]; auto_confirm?: boolean;
};
type Poi = {
  id: string; name: string; category: string; type: string; address: string;
  distance: number; location: [number, number]; distance_bucket?: string;
};
type PoiSummary = {total:number;by_category:Record<string,number>;by_distance:Record<string,number>};
type ImportPreview = {
  filename: string; headers: string[]; mapping: Record<string,string>;
  rows: Array<Record<string,string|number|boolean|string[]>>; all_rows: Array<Record<string,string>>;
  selectable_rows: Array<Record<string,string|number|boolean|string[]>>; file_size:number;
  total_rows: number; valid_rows:number; invalid_rows:number; duplicate_rows:number; warnings: string[];
};
type JobRecord = {
  id:number;filename?:string;status:string;total_stores:number;processed_stores:number;matched_stores:number;
  pending_stores:number;success_stores:number;failed_stores:number;created_at:string;updated_at:string;
  stage:"match"|"analysis";control:string;stage_total:number;stage_processed:number;progress_percent:number;current_store:string;
  config?:{radii?:number[];categories?:string[];generate_profile?:boolean};
};
type BusinessAnalysis = {
  id:number; analysis_version:string; radius_config:number[]; confidence_level:string;
  business_area:{name:string;source:string;confidence:string};
  business_district_type:{type:string;scores:Record<string,number>;confidence:string};
  level:{level:string;score:number;mode:string}; fit:{score:number;level:string};
  competition:{score:number;level:string}; feature_vector:{layers:Record<string,{total:number;density:number;counts:Record<string,number>;nearest:Record<string,number|null>}>;level_indicators?:Record<string,number>;fit_components?:Record<string,number>};
  audience_profile?: AudienceProfileData | null;
  strengths:string[]; weaknesses:string[]; warning_messages:string[]; disclaimer:string; created_at:string;
  poi_summary?:PoiSummary;
};
type AudienceProfileData = {
  method:string; confidence:string;
  primary_groups:Array<{label:string;age_range:string;index:number;basis:string}>;
  age_segments:Array<{label:string;age_range:string;index:number;basis:string}>;
  consumption_power:{level:string;index:number;confidence:string;basis:string};
  mall_profile:{level:string;confidence:string;sample_count:number;sample_names:string[];basis:string};
  summary:string[]; evidence:string[]; limitations:string[];
};
type AMapObject = {destroy?:()=>void;add:(item:unknown)=>void;setFitView:(items:unknown[],immediate:boolean,padding:number[],maxZoom:number)=>void};
type AMapApi = {
  Map:new (element:HTMLDivElement,options:Record<string,unknown>)=>AMapObject;
  Circle:new (options:Record<string,unknown>)=>unknown;
  Marker:new (options:Record<string,unknown>)=>unknown;
};
type BatchStore = {
  id:number;input_name:string;standard_name?:string;amap_poi_id?:string;longitude:number|null;latitude:number|null;
  province?:string;city?:string;district?:string;address?:string;match_score?:number;match_status?:string;location_source?:string;
};
type BatchResult = BusinessAnalysis&{store:BatchStore;poi_summary:PoiSummary};
type BatchStoreDetail = {job:JobRecord;store:BatchStore;status:string;pois:Poi[];poi_summary:PoiSummary;analysis:BusinessAnalysis|null;disclaimer:string};
type MapStore = {name:string;location:[number,number]};

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const allCategories = ["住宅小区", "幼儿园", "小学", "购物中心", "超市", "便利店", "医院", "药店", "公园", "地铁站", "公交站", "竞品门店"];
const defaultCategories = ["住宅小区", "小学", "幼儿园"];
const defaultRadii = [500];
const importFields = [
  ["name","门店名称"],["province","省份"],["city","城市"],["district","区县"],
  ["address","详细地址"],["code","门店编号"],["brand","品牌"],["remark","备注"],
] as const;
const formatRadius = (value:number) => value >= 1000 ? `${Number((value/1000).toFixed(2))} 公里` : `${value} 米`;
const formatFileSize = (value:number) => value >= 1024*1024 ? `${(value/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(value/1024))} KB`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.message || "请求失败");
  return body.data as T;
}

export default function Page() {
  const [tab, setTab] = useState<"single"|"batch"|"jobs">("single");
  const [mode, setMode] = useState({ mock: true, web_key: false, js_key: false });
  const [searchMode, setSearchMode] = useState<"name"|"address">("name");
  const [query, setQuery] = useState({ name: "", province:"", city: "", district: "", address: "", adcode:"" });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [categories, setCategories] = useState<string[]>(defaultCategories);
  const [radii, setRadii] = useState<number[]>(defaultRadii);
  const [radiusValue,setRadiusValue] = useState("");
  const [radiusUnit,setRadiusUnit] = useState<"米"|"公里">("米");
  const [radiusError,setRadiusError] = useState("");
  const [pois, setPois] = useState<Poi[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [uploadedFile,setUploadedFile] = useState<{name:string;size:number;status:"success"|"error";message:string}|null>(null);
  const [selectedRowNumbers,setSelectedRowNumbers] = useState<number[]>([]);
  const [storeFilter,setStoreFilter] = useState("");
  const [batchJob, setBatchJob] = useState<{job_id:number;status:string}|null>(null);
  const [batchCategories,setBatchCategories] = useState<string[]>(defaultCategories);
  const [batchRadii,setBatchRadii] = useState<number[]>(defaultRadii);
  const [batchProfile,setBatchProfile] = useState(true);
  const [resultTab,setResultTab] = useState<"distribution"|"profile"|"audience"|"details">("distribution");
  const [business,setBusiness] = useState<BusinessAnalysis|null>(null);

  useEffect(() => { request<typeof mode>("/health").then(setMode).catch(() => setError("后端服务未连接，请先启动 FastAPI 服务")); }, []);

  const counts = useMemo(() => Object.entries(pois.reduce<Record<string, number>>((a, p) => ((a[p.category] = (a[p.category] || 0) + 1), a), {})), [pois]);
  const maxCount = Math.max(1, ...counts.map(([, n]) => n));
  const filteredImportRows = useMemo(()=>{
    if(!importPreview)return [];
    const keyword=storeFilter.trim().toLowerCase();
    return importPreview.selectable_rows.filter(row=>{
      if(row._valid===false)return false;
      if(!keyword)return true;
      return importPreview.headers.some(header=>String(row[header]||"").toLowerCase().includes(keyword));
    });
  },[importPreview,storeFilter]);

  async function search() {
    setBusy("search"); setError(""); setPois([]); setSelected(null);
    try {
      if (searchMode === "address") {
        const data = await request<{candidates:Array<Record<string,unknown>>}>("/geocode", {method:"POST",body:JSON.stringify(query)});
        setCandidates(data.candidates.map((item,index)=>({
          id:`GEO-${index}`, name:query.name || String(item.formatted_address || query.address), address:String(item.formatted_address || query.address),
          formatted_address:String(item.formatted_address || query.address), province:String(item.province||""), city:String(item.city||""),district:String(item.district||""),adcode:String(item.adcode||""),
          location:item.location as [number,number], type:`地址解析 · ${item.level||"未知级别"}`,typecode:"",score:item.requires_confirmation?60:85,
          status:item.requires_confirmation?"需要地图确认":"较高精度，仍需确认", reasons:[`高德匹配级别：${item.level||"未知"}`],level:String(item.level||""),source:String(item.source||""),
          breakdown:[{label:`地址匹配级别：${item.level||"未知"}`,points:item.requires_confirmation?60:85,kind:item.requires_confirmation?"warning":"match"}],conflicts:[],warnings:item.requires_confirmation?["定位精度不足，确认前不能开始分析"]:[]
        })));
      } else {
        const data = await request<{ candidates: Candidate[] }>("/stores/search", { method: "POST", body: JSON.stringify(query) });
        setCandidates(data.candidates);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "搜索失败"); } finally { setBusy(""); }
  }

  async function confirm(c: Candidate) {
    setBusy("confirm"); setError("");
    try {
      const store = c.id.startsWith("GEO-")
        ? await request<{id:number}>("/stores/from-geocode",{method:"POST",body:JSON.stringify({...query,candidate:c})})
        : await request<{ id: number }>("/stores", { method: "POST", body: JSON.stringify({ ...query, candidate: c }) });
      await request(`/stores/${store.id}/confirm`, { method: "POST", body: JSON.stringify({ candidate: c, confirmation_method: "用户手动选择候选" }) });
      setSelected({ ...c, storeId: store.id } as Candidate & { storeId: number });
    } catch (e) { setError(e instanceof Error ? e.message : "确认失败"); } finally { setBusy(""); }
  }

  async function analyze() {
    if (!selected) return;
    setBusy("poi"); setError("");
    try {
      const storeId = (selected as Candidate & { storeId: number }).storeId;
      const data = await request<{ job_id: number; pois: Poi[] }>(`/stores/${storeId}/poi-search`, {
        method: "POST", body: JSON.stringify({ categories, radii, max_radius: Math.max(...radii) })
      });
      setPois(data.pois); setJobId(data.job_id); setBusiness(null); setResultTab("distribution");
    } catch (e) { setError(e instanceof Error ? e.message : "分析失败"); } finally { setBusy(""); }
  }

  function addRadius() {
    setRadiusError("");
    if (!/^\d+(?:\.\d{1,2})?$/.test(radiusValue)) return setRadiusError("请输入大于 0 的数字；公里最多保留两位小数");
    const number=Number(radiusValue);
    if(number<=0) return setRadiusError("搜索半径必须大于 0");
    if(radiusUnit==="米"&&!Number.isInteger(number)) return setRadiusError("以米为单位时请输入正整数");
    const meters=radiusUnit==="公里"?Math.round(number*1000):number;
    if(meters>50000) return setRadiusError("搜索半径不能超过高德接口上限 50 公里");
    if(meters>10000&&!window.confirm("该半径超过推荐的 10 公里，会增加查询量并降低局部分析意义。仍要添加吗？")) return;
    const next=[...new Set([...radii,meters])].sort((a,b)=>a-b);
    if(next.length>5) return setRadiusError("最多同时选择 5 个搜索半径");
    setRadii(next);setRadiusValue("");
  }

  async function generateBusinessProfile() {
    if(!selected) return;
    setBusy("business");setError("");
    try{
      const storeId=(selected as Candidate & {storeId:number}).storeId;
      const data=await request<BusinessAnalysis>(`/stores/${storeId}/business-district-analysis`,{method:"POST",body:JSON.stringify({radii})});
      setBusiness(data);setResultTab("audience");
    }catch(e){setError(e instanceof Error?e.message:"商圈画像生成失败")}finally{setBusy("")}
  }

  async function uploadFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx","xls","csv"].includes(extension)) {
      setUploadedFile({name:file.name,size:file.size,status:"error",message:"仅支持 .xlsx、.xls、.csv 文件"});
      setError("仅支持 .xlsx、.xls、.csv 文件");
      return;
    }
    setBusy("upload"); setError(""); setImportPreview(null); setBatchJob(null);setStoreFilter("");setSelectedRowNumbers([]);setUploadedFile({name:file.name,size:file.size,status:"success",message:"正在解析文件…"});
    const formData = new FormData(); formData.append("file",file);
    try {
      const response = await fetch(`${API}/import/preview`,{method:"POST",body:formData});
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "文件解析失败");
      setImportPreview(body.data);
      setUploadedFile({name:file.name,size:file.size,status:"success",message:`解析成功：${body.data.valid_rows} 家门店可导入`});
      setSelectedRowNumbers(body.data.selectable_rows.filter((row:Record<string,unknown>)=>row._valid!==false).map((row:Record<string,unknown>)=>Number(row._row_number)));
    } catch (e) {
      const message=e instanceof Error ? e.message : "上传失败";
      setUploadedFile({name:file.name,size:file.size,status:"error",message});setError(message);
    } finally {
      setBusy("");
      setDrag(false);
    }
  }

  async function createBatchJob() {
    if (!importPreview) return;
    const selected=new Set(selectedRowNumbers);
    const rows=importPreview.selectable_rows.filter(row=>row._valid!==false&&selected.has(Number(row._row_number))).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith("_"))) as Record<string,string>);
    if(!rows.length){setError("请至少选择一家需要分析的门店");return}
    setBusy("confirm-import"); setError("");
    try {
      const data = await request<{job_id:number;status:string}>("/import/confirm",{
        method:"POST",
        body:JSON.stringify({filename:importPreview.filename,mapping:importPreview.mapping,rows,config:{categories:batchCategories,radii:batchRadii,generate_profile:batchProfile}}),
      });
      setBatchJob(data);
      window.setTimeout(()=>setTab("jobs"),650);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建批量任务失败");
    } finally {
      setBusy("");
    }
  }

  function updateImportMapping(field:string,header:string) {
    if(!importPreview) return;
    const mapping={...importPreview.mapping};
    for(const key of Object.keys(mapping)) if(mapping[key]===header) delete mapping[key];
    if(header) mapping[field]=header; else delete mapping[field];
    setImportPreview({...importPreview,mapping});
    setBatchJob(null);
  }

  function removeUploadedFile(){setUploadedFile(null);setImportPreview(null);setSelectedRowNumbers([]);setStoreFilter("");setBatchJob(null);setError("")}

  function setFilteredSelection(selected:boolean){const filtered=new Set(filteredImportRows.map(row=>Number(row._row_number)));setSelectedRowNumbers(current=>selected?[...new Set([...current,...filtered])]:current.filter(row=>!filtered.has(row)))}

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span>界</span><div><b>店界 POI</b><small>选址分析工作台</small></div></div>
        <nav>
          <button className={tab==="single"?"active":""} onClick={()=>setTab("single")}>⌖ 单门店分析</button>
          <button className={tab==="batch"?"active":""} onClick={()=>setTab("batch")}>⇧ 批量导入</button>
          <button className={tab==="jobs"?"active":""} onClick={()=>setTab("jobs")}>▤ 分析任务</button>
        </nav>
        <div className="side-foot"><i className={mode.web_key?"ok":""}/><div><b>{mode.mock ? "演示模式" : "真实高德模式"}</b><small>Web Key {mode.web_key?"已配置":"未配置"}</small></div></div>
      </aside>

      <main>
        <header><div><h1>{tab==="single"?"单门店周边分析":tab==="batch"?"批量导入门店":"分析任务"}</h1><p>基于 GCJ-02 坐标系的设施分布分析</p></div><a className="download" href={`${API}/import/template`}>下载导入模板</a></header>
        {mode.mock && <div className="banner">演示模式：地图及 POI 结果为明确标注的模拟数据，不代表真实高德查询结果。配置 Key 并关闭 Mock 后即可切换真实数据。</div>}
        {error && <div className="error">{error}<button onClick={()=>setError("")}>×</button></div>}

        {tab==="single" && <>
          <section className="panel search-panel">
            <div className="section-title"><span>01</span><div><h2>查找并确认门店</h2><p>系统始终返回候选列表，不会无条件选择第一条结果</p></div></div>
            <div className="mode-switch"><button className={searchMode==="name"?"on":""} onClick={()=>{setSearchMode("name");setCandidates([])}}>按门店名称搜索</button><button className={searchMode==="address"?"on":""} onClick={()=>{setSearchMode("address");setCandidates([])}}>按详细地址定位</button></div>
            <div className="form-grid">
              {searchMode==="address"&&<label>省份<input value={query.province} onChange={e=>setQuery({...query,province:e.target.value})} placeholder="湖北省"/></label>}
              <label className="wide">门店名称 {searchMode==="name"&&<em>*</em>}<input value={query.name} onChange={e=>setQuery({...query,name:e.target.value})} placeholder={searchMode==="name"?"例如：零食很忙武汉南湖店":"选填，用于保存门店名称"}/></label>
              <label>城市<input value={query.city} onChange={e=>setQuery({...query,city:e.target.value})} placeholder="武汉市"/></label>
              <label>区县<input value={query.district} onChange={e=>setQuery({...query,district:e.target.value})} placeholder="洪山区"/></label>
              <label className="wide">详细地址 {searchMode==="address"&&<em>*</em>}<input value={query.address} onChange={e=>setQuery({...query,address:e.target.value})} placeholder={searchMode==="address"?"例如：严西湖路8号附137号":"选填，可提高匹配准确度"}/></label>
              <button className="primary" disabled={(searchMode==="name"?!query.name.trim():!query.address.trim())||!!busy} onClick={search}>{busy==="search"?"正在查找…":searchMode==="address"?"解析地址":"查找门店"}</button>
            </div>
            {candidates.length>0 && <div className="candidates">
              <h3>找到 {candidates.length} 个候选位置 <small>请核对名称、城市和地址</small></h3>
              {candidates.map((c,i)=><article key={c.id} className={selected?.id===c.id?"chosen":""}>
                <div className="rank">{i+1}</div><div className="candidate-main"><h4>{c.name}<span>{c.type}</span></h4><p>{c.city} · {c.district}　{c.address}</p><small>POI ID {c.id}　坐标 {c.location.join(", ")}</small></div>
                <div className="score"><b>{c.score}</b><span>匹配分</span><small>{c.status}</small></div>
                <div className="why">{(c.breakdown||c.reasons.map(label=>({label,points:0,kind:"match"}))).map((item,j)=><span key={j} className={item.kind}>{item.label}{item.points>0?`：+${item.points}`:""}</span>)}{c.conflicts?.map((text,j)=><strong key={`c${j}`}>警告：{text}，不能自动确认。</strong>)}{c.warnings?.map((text,j)=><em key={`w${j}`}>{text}</em>)}</div>
                <button className="outline" onClick={()=>confirm(c)}>{selected?.id===c.id?"已确认":"选择此位置"}</button>
              </article>)}
            </div>}
          </section>

          <section className={`panel analysis ${selected?"":"disabled"}`}>
            <div className="section-title"><span>02</span><div><h2>配置周边搜索</h2><p>{selected?`已确认：${selected.name}`:"请先确认门店位置"}</p></div></div>
            <div className="config-grid">
              <div><h3>搜索半径</h3><div className="chips">{[500,1000,2000,3000,5000].map(r=><button key={r} className={radii.includes(r)?"on":""} onClick={()=>setRadii(radii.includes(r)?radii.filter(x=>x!==r):[...radii,r].sort((a,b)=>a-b))}>{formatRadius(r)}</button>)}</div>
                <div className="custom-radius"><input value={radiusValue} onChange={e=>setRadiusValue(e.target.value)} placeholder="自定义半径"/><select value={radiusUnit} onChange={e=>setRadiusUnit(e.target.value as "米"|"公里")}><option>米</option><option>公里</option></select><button onClick={addRadius}>添加</button></div>
                {radiusError&&<p className="field-error">{radiusError}</p>}<div className="selected-radii"><small>已选择</small>{radii.map(r=><button key={r} title="点击删除" onClick={()=>setRadii(radii.filter(x=>x!==r))}>{formatRadius(r)} ×</button>)}</div><button className="text-btn" onClick={()=>setRadii(defaultRadii)}>恢复默认半径</button>
              </div>
              <div><div className="config-heading"><h3>POI 分类 <small>已选 {categories.length} 项</small></h3><div><button className="text-btn" onClick={()=>setCategories(defaultCategories)}>恢复默认</button><button className="text-btn" onClick={()=>setCategories([])}>清空选择</button></div></div><div className="category-grid">{allCategories.map(c=><label key={c}><input type="checkbox" checked={categories.includes(c)} onChange={()=>setCategories(categories.includes(c)?categories.filter(x=>x!==c):[...categories,c])}/><span>{c}</span></label>)}</div></div>
            </div>
            <button className="primary analyze-btn" disabled={!selected||!categories.length||!radii.length||!!busy} onClick={analyze}>{busy==="poi"?"正在查询并去重…":"开始周边 POI 分析"}</button>
          </section>

          {pois.length>0 && <><div className="result-tabs"><button className={resultTab==="distribution"?"on":""} onClick={()=>setResultTab("distribution")}>POI分布</button><button className={resultTab==="profile"?"on":""} onClick={()=>setResultTab("profile")}>商圈画像</button><button className={resultTab==="audience"?"on":""} onClick={()=>setResultTab("audience")}>潜在人群</button><button className={resultTab==="details"?"on":""} onClick={()=>setResultTab("details")}>POI明细</button><button className="primary profile-action" disabled={!!busy} onClick={generateBusinessProfile}>{busy==="business"?"正在查询更多特征…":business?"重新生成智能画像":"生成智能画像"}</button></div>
          {resultTab==="distribution"&&<section className="results">
            <div className="panel map-panel"><div className="panel-head"><div><h2>设施分布地图</h2><p>圆圈表示系统分析圈层，不代表高德官方商圈边界</p></div><div className="legend"><i/>门店 <i/>POI</div></div>
              <PoiMap key={`${selected.name}-${selected.location.join("-")}`} store={selected} pois={pois} radii={radii}/>
            </div>
            <div className="panel chart"><div className="panel-head"><div><h2>分类统计</h2><p>共 {pois.length} 个已去重 POI</p></div></div>
              {counts.map(([name,n])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${n/maxCount*100}%`}}/></div><b>{n}</b></div>)}
              <div className="disclaimer">本分析仅反映周边设施与兴趣点分布，不等同于人口、客流、消费能力或销售预测。</div>
            </div>
          </section>}
          {resultTab==="profile"&&<BusinessProfile data={business} onGenerate={generateBusinessProfile} busy={busy==="business"}/>}
          {resultTab==="audience"&&<AudienceProfile data={business?.audience_profile||null} onGenerate={generateBusinessProfile} busy={busy==="business"}/>}
          {resultTab==="details"&&<section className="panel table-panel"><div className="panel-head"><div><h2>POI明细</h2><p>按直线距离排序</p></div>{jobId&&<a className="download" href={`${API}/analysis-jobs/${jobId}/export`}>导出 Excel</a>}</div><div className="table-wrap"><table><thead><tr><th>POI 名称</th><th>分类</th><th>地址</th><th>直线距离</th><th>距离层级</th></tr></thead><tbody>{pois.map(p=><tr key={p.id}><td>{p.name}</td><td><span className="tag">{p.category}</span></td><td>{p.address}</td><td>{p.distance} m</td><td>{(p as Poi & {distance_bucket?:string}).distance_bucket}</td></tr>)}</tbody></table></div></section>}
          </>}
        </>}

        {tab==="batch" && <section className="panel upload-panel">
          <div className="section-title"><span>01</span><div><h2>上传门店表格</h2><p>支持 .xlsx、.xls、.csv，单次最多 5,000 行</p></div></div>
          {!uploadedFile&&<label className={`dropzone ${drag?"drag":""}`}
            onDragEnter={e=>{e.preventDefault();setDrag(true)}}
            onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";setDrag(true)}}
            onDragLeave={e=>{e.preventDefault();if(e.currentTarget===e.target)setDrag(false)}}
            onDrop={e=>{e.preventDefault();setDrag(false);const file=e.dataTransfer.files?.[0];if(file)void uploadFile(file)}}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadFile(file);e.currentTarget.value=""}}/>
            <b>{busy==="upload"?"正在解析文件…":drag?"松开即可上传":"拖放文件到这里，或点击选择"}</b>
            <span>{busy==="upload"?"正在识别工作表、表头和数据…":"系统会展示字段映射和门店选择，不会立即执行分析"}</span>
          </label>}
          {uploadedFile&&<div className={`uploaded-file ${uploadedFile.status}`}><div className="file-icon">{uploadedFile.status==="success"?"✓":"!"}</div><div><small>{uploadedFile.status==="success"?"文件已接收":"文件解析失败"}</small><b>{uploadedFile.name}</b><span>{formatFileSize(uploadedFile.size)} · {uploadedFile.message}</span></div><div className="file-actions"><label>替换文件<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadFile(file);e.currentTarget.value=""}}/></label><button onClick={removeUploadedFile}>删除文件</button></div></div>}
          {importPreview && <div className="import-result">
            <div className="import-summary">
              <div><small>文件</small><b>{importPreview.filename}</b></div>
              <div><small>可导入数据</small><b>{importPreview.valid_rows} / {importPreview.total_rows} 行</b></div>
              <div><small>字段映射</small><b>{Object.keys(importPreview.mapping).length} 项</b></div>
              <span className="success-badge">导入解析成功</span>
            </div>
            {importPreview.warnings.length>0&&<div className="import-warnings">{importPreview.warnings.map(x=><p key={x}>⚠ {x}</p>)}</div>}
            <div className="mapping-block"><h3>确认字段映射 <small>门店名称和详细地址至少映射一项</small></h3><div className="mapping-selects">
              {importFields.map(([field,label])=><label key={field}><span>{label}{field==="name"||field==="address"?<em> *</em>:null}</span><select value={importPreview.mapping[field]||""} onChange={e=>updateImportMapping(field,e.target.value)}><option value="">不导入</option>{importPreview.headers.map(header=><option key={header} value={header}>{header}</option>)}</select></label>)}
            </div></div>
            <div className="batch-config"><div><h3>统一搜索半径</h3><div className="chips">{[500,1000,2000,3000,5000].map(radius=><button key={radius} className={batchRadii.includes(radius)?"on":""} onClick={()=>setBatchRadii(batchRadii.includes(radius)?batchRadii.filter(x=>x!==radius):[...batchRadii,radius].sort((a,b)=>a-b))}>{formatRadius(radius)}</button>)}</div></div><div><h3>统一 POI 分类 <small>已选 {batchCategories.length} 项</small></h3><div className="category-grid">{allCategories.map(category=><label key={category}><input type="checkbox" checked={batchCategories.includes(category)} onChange={()=>setBatchCategories(batchCategories.includes(category)?batchCategories.filter(x=>x!==category):[...batchCategories,category])}/><span>{category}</span></label>)}</div></div><label className="profile-toggle"><input type="checkbox" checked={batchProfile} onChange={e=>setBatchProfile(e.target.checked)}/><span><b>匹配后生成智能画像</b><small>包含商圈、潜在人群、消费环境和商场线索</small></span></label></div>
            <div className="store-selector"><div><h3>选择需要分析的门店</h3><p>默认全选有效门店，可搜索后批量选择或取消。</p></div><div className="store-selection-count"><b>已选 {selectedRowNumbers.length}</b><span>/ {importPreview.valid_rows} 家</span></div><input value={storeFilter} onChange={e=>setStoreFilter(e.target.value)} placeholder="搜索门店、品牌、城市、区县、地址或编号"/><div className="selection-actions"><button onClick={()=>setFilteredSelection(true)}>全选筛选结果</button><button onClick={()=>setFilteredSelection(false)}>取消筛选结果</button><button onClick={()=>setSelectedRowNumbers(importPreview.selectable_rows.filter(row=>row._valid!==false).map(row=>Number(row._row_number)))}>恢复全选</button></div></div>
            <div className="preview-head"><div><h3>门店预览与选择</h3><p>筛选到 {filteredImportRows.length} 家，最多显示前 {Math.min(200,filteredImportRows.length)} 家</p></div>
              <button className="primary" disabled={!!busy||!!batchJob||!selectedRowNumbers.length||(!importPreview.mapping.name&&!importPreview.mapping.address)||!batchRadii.length||!batchCategories.length} onClick={createBatchJob}>{busy==="confirm-import"?"正在创建任务…":batchJob?"任务已创建":`创建批量任务（${selectedRowNumbers.length} 家）`}</button>
            </div>
            <div className="table-wrap import-table"><table><thead><tr><th>选择</th>{importPreview.headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{filteredImportRows.slice(0,200).map(row=><tr key={Number(row._row_number)}><td><input aria-label={`选择第${row._row_number}行`} type="checkbox" checked={selectedRowNumbers.includes(Number(row._row_number))} onChange={()=>setSelectedRowNumbers(current=>current.includes(Number(row._row_number))?current.filter(value=>value!==Number(row._row_number)):[...current,Number(row._row_number)])}/></td>{importPreview.headers.map(h=><td key={h}>{String(row[h]||"")}</td>)}</tr>)}</tbody>
            </table></div>
            {batchJob && <div className="job-created"><div><b>批量任务 #{batchJob.job_id} 已创建</b><span>正在进入任务监控页；点击一次开始匹配即可自动处理全部门店。</span></div><button className="primary" onClick={()=>setTab("jobs")}>立即查看任务</button></div>}
          </div>}
          <div className="flow"><b>批量流程</b><span>上传并选店</span><i>→</i><span>一键连续匹配</span><i>→</i><span>一键完整分析</span><i>→</i><span>详情与对比</span><i>→</i><span>导出报告</span></div>
        </section>}

        {tab==="jobs" && <Jobs api={API} focusJobId={batchJob?.job_id||null}/>}
      </main>
    </div>
  );
}

function Jobs({api,focusJobId}:{api:string;focusJobId:number|null}) {
  const [jobs,setJobs]=useState<JobRecord[]>([]);
  const [results,setResults]=useState<BatchResult[]>([]);
  const [activeJob,setActiveJob]=useState<number|null>(null);
  const [currentJobId,setCurrentJobId]=useState<number|null>(focusJobId);
  const [currentJob,setCurrentJob]=useState<JobRecord|null>(null);
  const [jobStores,setJobStores]=useState<Array<{store:BatchStore;status:string;poi_summary:PoiSummary;has_profile:boolean;error_message?:string}>>([]);
  const [comparisonIds,setComparisonIds]=useState<number[]>([]);
  const [detail,setDetail]=useState<BatchStoreDetail|null>(null);
  const [jobBusy,setJobBusy]=useState("");
  const [notice,setNotice]=useState("");
  const [filters,setFilters]=useState({keyword:"",city:"",district:"",type:"",level:"",lowConfidence:false});
  async function apiRequest(path:string,init?:RequestInit){const response=await fetch(`${api}${path}`,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});const body=await response.json();if(!response.ok||!body.success)throw new Error(body.message||"操作失败");return body.data}
  async function loadJobs(){try{const data=await apiRequest("/analysis-jobs") as JobRecord[];setJobs(data);setCurrentJobId(current=>focusJobId||current||data.find(job=>["正在匹配门店","正在完整分析","已暂停"].includes(job.status))?.id||data[0]?.id||null)}catch(e){setNotice(e instanceof Error?e.message:"任务加载失败")}}
  useEffect(()=>{let active=true;const refresh=async()=>{try{const response=await fetch(`${api}/analysis-jobs`);const body=await response.json();const data=(body.data||[]) as JobRecord[];if(active){setJobs(data);setCurrentJobId(current=>focusJobId||current||data.find(job=>["正在匹配门店","正在完整分析","已暂停"].includes(job.status))?.id||data[0]?.id||null)}}catch{}};const initial=window.setTimeout(()=>void refresh(),0);const timer=window.setInterval(()=>void refresh(),4000);return()=>{active=false;window.clearTimeout(initial);window.clearInterval(timer)}},[api,focusJobId]);
  useEffect(()=>{if(!currentJobId)return;let active=true;const fetchData=async(path:string)=>{const response=await fetch(`${api}${path}`);const body=await response.json();return body.data};const refresh=async()=>{try{const [job,stores]=await Promise.all([fetchData(`/analysis-jobs/${currentJobId}`),fetchData(`/analysis-jobs/${currentJobId}/stores`)]);if(active){setCurrentJob(job as JobRecord);setJobStores(stores as typeof jobStores);setJobs(current=>current.map(item=>item.id===(job as JobRecord).id?job as JobRecord:item))}}catch{}};const initial=window.setTimeout(()=>void refresh(),0);const timer=window.setInterval(()=>void refresh(),2000);return()=>{active=false;window.clearTimeout(initial);window.clearInterval(timer)}},[api,currentJobId]);
  async function loadResults(id:number){setCurrentJobId(id);setActiveJob(id);setDetail(null);setJobBusy("load");setNotice("");try{const data=await apiRequest(`/analysis-jobs/${id}/business-district-results`) as BatchResult[];setResults(data);setComparisonIds(data.slice(0,Math.min(12,data.length)).map(item=>item.store.id))}catch(e){setResults([]);setComparisonIds([]);setNotice(e instanceof Error?e.message:"结果加载失败")}finally{setJobBusy("")}}
  async function loadDetail(jobId:number,storeId:number){setJobBusy(`detail-${storeId}`);setNotice("");try{setDetail(await apiRequest(`/analysis-jobs/${jobId}/stores/${storeId}`) as BatchStoreDetail);window.setTimeout(()=>document.querySelector(".batch-store-detail")?.scrollIntoView({behavior:"smooth",block:"start"}),50)}catch(e){setNotice(e instanceof Error?e.message:"门店详情加载失败")}finally{setJobBusy("")}}
  async function taskAction(id:number,name:"start-matching"|"start-analysis"|"pause"|"resume"|"end"|"retry"){setCurrentJobId(id);setJobBusy(`${name}-${id}`);setNotice("");try{const data=await apiRequest(`/analysis-jobs/${id}/${name}`,{method:"POST",body:"{}"});if(name==="retry"){await apiRequest(`/analysis-jobs/${id}/start-matching`,{method:"POST",body:"{}"});setNotice("失败门店已重新加入连续匹配任务")}else{setNotice(name==="start-matching"?"已开始连续匹配全部门店，可离开页面后再回来查看进度。":name==="start-analysis"?"已开始连续完整分析，完成后可直接查看详情与对比。":name==="pause"?"任务将在当前门店处理完成后暂停。":name==="resume"?"任务已继续。":"任务已结束，已完成结果会保留。");if(data?.id)setCurrentJob(data as JobRecord)}await loadJobs()}catch(e){setNotice(e instanceof Error?e.message:"操作失败")}finally{setJobBusy("")}}
  function toggleComparison(storeId:number){if(comparisonIds.includes(storeId))return setComparisonIds(comparisonIds.filter(id=>id!==storeId));if(comparisonIds.length>=12)return setNotice("重点对比最多选择 12 家门店");setComparisonIds([...comparisonIds,storeId])}
  const keyword=filters.keyword.trim().toLowerCase();
  const visible=results.filter(x=>(!keyword||`${x.store.input_name} ${x.store.standard_name||""} ${x.store.address||""}`.toLowerCase().includes(keyword))&&(!filters.city||x.store?.city===filters.city)&&(!filters.district||x.store?.district===filters.district)&&(!filters.type||x.business_district_type.type===filters.type)&&(!filters.level||x.level.level===filters.level)&&(!filters.lowConfidence||x.confidence_level==="低"));
  const compared=results.filter(item=>comparisonIds.includes(item.store.id));
  const failedStores=jobStores.filter(item=>["匹配失败","分析失败"].includes(item.status));
  const running=Boolean(currentJob&&["正在匹配门店","正在完整分析"].includes(currentJob.status));
  const paused=currentJob?.status==="已暂停";
  return <section className="jobs-workspace">
    {notice&&<div className="job-notice">{notice}</div>}
    {currentJob&&<section className="panel current-task"><div className="current-task-head"><div><small>当前任务 · #{currentJob.id}</small><h2>{currentJob.filename||"单门店任务"}</h2><p>{currentJob.stage==="analysis"?"正在进行完整 POI 与画像分析":"正在进行门店自动匹配"} · 最近更新 {currentJob.updated_at.slice(11,19)}</p></div><span className={`task-state ${running?"running":""}`}>{currentJob.status}</span></div><div className="task-progress"><div className="progress-copy"><b>{currentJob.progress_percent}%</b><span>{currentJob.stage_processed} / {currentJob.stage_total} 家</span></div><progress value={currentJob.stage_processed} max={currentJob.stage_total||1}/><div className="task-stats"><span>已匹配 <b>{currentJob.matched_stores}</b></span><span>分析成功 <b>{currentJob.success_stores}</b></span><span>失败 <b>{currentJob.failed_stores}</b></span><span>剩余 <b>{Math.max(0,currentJob.stage_total-currentJob.stage_processed)}</b></span></div>{currentJob.current_store&&<p className="current-store"><i/>当前处理：{currentJob.current_store}</p>}</div><div className="current-task-actions">{["等待开始匹配","等待继续匹配"].includes(currentJob.status)&&<button className="primary" onClick={()=>taskAction(currentJob.id,"start-matching")}>一键匹配全部门店</button>}{running&&<><button className="outline" onClick={()=>taskAction(currentJob.id,"pause")}>暂停任务</button><button className="danger-btn" onClick={()=>taskAction(currentJob.id,"end")}>结束任务</button></>}{paused&&<><button className="primary" onClick={()=>taskAction(currentJob.id,"resume")}>继续任务</button><button className="danger-btn" onClick={()=>taskAction(currentJob.id,"end")}>结束任务</button></>}{["匹配完成","匹配部分失败"].includes(currentJob.status)&&currentJob.matched_stores>0&&<button className="primary" onClick={()=>taskAction(currentJob.id,"start-analysis")}>一键运行完整分析</button>}{["已完成","部分完成"].includes(currentJob.status)&&<button className="primary" onClick={()=>loadResults(currentJob.id)}>门店详情与对比</button>}<a className="download" href={`${api}/analysis-jobs/${currentJob.id}/export`}>导出总报告</a>{currentJob.failed_stores>0&&<button onClick={()=>taskAction(currentJob.id,"retry")}>重试失败门店</button>}</div>{failedStores.length>0&&<div className="failed-stores"><h3>未能完成的门店</h3>{failedStores.map(item=><div key={item.store.id}><b>{item.store.input_name}</b><span>{item.error_message||"高德未返回有效候选或分析请求失败"}</span></div>)}</div>}</section>}
    <section className="panel jobs-history"><div className="section-title"><span>●</span><div><h2>最近分析任务</h2><p>当前任务优先展示在上方；历史任务保留在这里。</p></div></div>
    {jobs.length===0?<div className="empty"><b>暂无分析任务</b><p>完成一次单门店分析或批量导入后，任务会显示在这里。</p></div>:
    <div className="table-wrap jobs-table"><table><thead><tr><th>任务</th><th>状态</th><th>门店</th><th>当前阶段进度</th><th>失败</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{jobs.map(job=><tr className={currentJobId===job.id?"current-row":""} key={job.id}><td><b>任务 #{job.id}</b><small>{job.filename||"单门店任务"}</small></td><td><span className="tag">{job.status}</span></td><td>{job.matched_stores}/{job.total_stores}</td><td><progress value={job.stage_processed} max={job.stage_total||1}/><small>{job.progress_percent}%</small></td><td>{job.failed_stores}</td><td>{job.created_at.slice(0,16).replace("T"," ")}</td><td className="row-actions"><button onClick={()=>setCurrentJobId(job.id)}>查看任务</button>{["等待开始匹配","等待继续匹配"].includes(job.status)&&<button onClick={()=>taskAction(job.id,"start-matching")}>一键匹配</button>}{["匹配完成","匹配部分失败"].includes(job.status)&&job.matched_stores>0&&<button onClick={()=>taskAction(job.id,"start-analysis")}>完整分析</button>}{["已完成","部分完成"].includes(job.status)&&<button onClick={()=>loadResults(job.id)}>详情与对比</button>}<a href={`${api}/analysis-jobs/${job.id}/export`}>导出</a></td></tr>)}</tbody></table></div>}
    </section>
    {activeJob&&<div className="batch-compare"><div className="panel-head"><div><h2>任务 #{activeJob} 门店分析与对比</h2><p>共 {visible.length} 家已完成分析；可勾选 2–12 家进行重点对比。</p></div><div className="report-actions"><a className="download" href={`${api}/analysis-jobs/${activeJob}/business-district-export`}>导出画像报告</a><a className="download" href={`${api}/analysis-jobs/${activeJob}/export`}>导出完整总报告</a></div></div>
      <div className="compare-filters"><input placeholder="搜索门店或地址" value={filters.keyword} onChange={e=>setFilters({...filters,keyword:e.target.value})}/><input placeholder="城市" value={filters.city} onChange={e=>setFilters({...filters,city:e.target.value})}/><input placeholder="区县" value={filters.district} onChange={e=>setFilters({...filters,district:e.target.value})}/><select value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">全部商圈类型</option>{[...new Set(results.map(x=>x.business_district_type.type))].map(x=><option key={x}>{x}</option>)}</select><select value={filters.level} onChange={e=>setFilters({...filters,level:e.target.value})}><option value="">全部能级</option>{["S","A","B","C","D"].map(x=><option key={x}>{x}</option>)}</select><label><input type="checkbox" checked={filters.lowConfidence} onChange={e=>setFilters({...filters,lowConfidence:e.target.checked})}/>只看低可信度</label></div>
      {jobBusy==="load"?<p>正在加载…</p>:visible.length===0?<div className="empty"><b>暂无完整分析结果</b><p>点击任务上的“运行完整分析”，系统会逐店查询 POI 并生成画像。</p></div>:<div className="table-wrap compare-table"><table><thead><tr><th>重点对比</th><th>门店</th><th>POI总量</th><th>商圈类型</th><th>能级</th><th>适配度</th><th>竞争压力</th><th>主要潜在人群</th><th>消费指数</th><th>可信度</th><th>操作</th></tr></thead><tbody>{visible.map(x=><tr key={x.id}><td><input aria-label={`选择${x.store.input_name}进行对比`} type="checkbox" checked={comparisonIds.includes(x.store.id)} onChange={()=>toggleComparison(x.store.id)}/></td><td><b>{x.store.input_name}</b><small>{x.store.city} · {x.store.district}</small></td><td><b>{x.poi_summary?.total||0}</b><small>{Object.entries(x.poi_summary?.by_category||{}).slice(0,2).map(([name,count])=>`${name}${count}`).join(" · ")}</small></td><td>{x.business_district_type.type}</td><td>{x.level.level} · {x.level.score}</td><td>{x.fit.score}</td><td>{x.competition.level}</td><td>{x.audience_profile?.primary_groups?.map(group=>group.label).join(" + ")||"需重新分析"}</td><td>{x.audience_profile?.consumption_power?.index??"—"}</td><td>{x.confidence_level}</td><td><button onClick={()=>loadDetail(activeJob,x.store.id)}>{jobBusy===`detail-${x.store.id}`?"加载中…":"查看详情"}</button></td></tr>)}</tbody></table></div>}
      {compared.length>0&&<div className="focus-compare"><div className="compare-title"><div><h3>重点门店横向对比</h3><p>已选择 {compared.length} / 12 家；建议至少选择 2 家。</p></div><button className="text-btn" onClick={()=>setComparisonIds([])}>清空选择</button></div><div className="compare-cards">{compared.map(item=><article key={item.store.id}><h4>{item.store.input_name}</h4><p>{item.store.district} · {item.business_district_type.type}</p><dl><div><dt>POI 总量</dt><dd>{item.poi_summary.total}</dd></div><div><dt>商圈能级</dt><dd>{item.level.level} / {item.level.score}</dd></div><div><dt>适配度</dt><dd>{item.fit.score}</dd></div><div><dt>竞争压力</dt><dd>{item.competition.level}</dd></div><div><dt>消费指数</dt><dd>{item.audience_profile?.consumption_power?.index??"—"}</dd></div><div><dt>主要年龄</dt><dd>{item.audience_profile?.primary_groups?.map(group=>group.age_range).join("、")||"—"}</dd></div></dl><button className="outline" onClick={()=>loadDetail(activeJob,item.store.id)}>查看完整详情</button></article>)}</div></div>}
    </div>}
    {detail&&activeJob&&<BatchStoreDetailView detail={detail} api={api} onClose={()=>setDetail(null)}/>}
  </section>
}

function BatchStoreDetailView({detail,api,onClose}:{detail:BatchStoreDetail;api:string;onClose:()=>void}) {
  const [tab,setTab]=useState<"distribution"|"profile"|"audience"|"details">("distribution");
  const counts=Object.entries(detail.poi_summary.by_category).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...counts.map(([,value])=>value));
  const storeForMap:MapStore={name:detail.store.standard_name||detail.store.input_name,location:[detail.store.longitude||0,detail.store.latitude||0]};
  return <div className="batch-store-detail">
    <div className="detail-hero"><div><small>任务 #{detail.job.id} · 单店完整报告</small><h2>{detail.store.input_name}</h2><p>{detail.store.city} · {detail.store.district}　{detail.store.address}</p><span>高德标准名称：{detail.store.standard_name||"—"}　匹配分：{detail.store.match_score??"—"}</span></div><div className="report-actions"><a className="download" href={`${api}/analysis-jobs/${detail.job.id}/stores/${detail.store.id}/export`}>导出本店报告</a><button onClick={onClose}>关闭详情</button></div></div>
    <div className="detail-kpis"><div><small>任务内 POI</small><b>{detail.poi_summary.total}</b></div><div><small>已分析分类</small><b>{counts.length}</b></div><div><small>商圈类型</small><b>{detail.analysis?.business_district_type.type||"—"}</b></div><div><small>消费环境指数</small><b>{detail.analysis?.audience_profile?.consumption_power.index??"—"}</b></div><div><small>分析可信度</small><b>{detail.analysis?.confidence_level||"—"}</b></div></div>
    <div className="result-tabs detail-tabs"><button className={tab==="distribution"?"on":""} onClick={()=>setTab("distribution")}>POI分布</button><button className={tab==="profile"?"on":""} onClick={()=>setTab("profile")}>商圈画像</button><button className={tab==="audience"?"on":""} onClick={()=>setTab("audience")}>潜在人群</button><button className={tab==="details"?"on":""} onClick={()=>setTab("details")}>POI明细</button></div>
    {tab==="distribution"&&<section className="results"><div className="panel map-panel"><div className="panel-head"><div><h2>本店设施分布地图</h2><p>{detail.job.config?.radii?.map(formatRadius).join("、")} 分析圈层</p></div><div className="legend"><i/>门店 <i/>POI</div></div><PoiMap key={detail.store.id} store={storeForMap} pois={detail.pois} radii={detail.job.config?.radii||defaultRadii}/></div><div className="panel chart"><div className="panel-head"><div><h2>分类统计</h2><p>仅统计任务 #{detail.job.id} 的 POI</p></div></div>{counts.map(([name,value])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${value/max*100}%`}}/></div><b>{value}</b></div>)}<div className="disclaimer">{detail.disclaimer}</div></div></section>}
    {tab==="profile"&&<BusinessProfile data={detail.analysis} onGenerate={()=>{}} busy={false}/>}
    {tab==="audience"&&<AudienceProfile data={detail.analysis?.audience_profile||null} onGenerate={()=>{}} busy={false}/>}
    {tab==="details"&&<section className="panel table-panel"><div className="panel-head"><div><h2>本店 POI 明细</h2><p>共 {detail.pois.length} 条，按直线距离排序</p></div><a className="download" href={`${api}/analysis-jobs/${detail.job.id}/stores/${detail.store.id}/export`}>导出本店报告</a></div><div className="table-wrap"><table><thead><tr><th>POI 名称</th><th>分类</th><th>地址</th><th>直线距离</th><th>距离层级</th></tr></thead><tbody>{detail.pois.map((poi,index)=><tr key={`${poi.id}-${poi.category}-${index}`}><td>{poi.name}</td><td><span className="tag">{poi.category}</span></td><td>{poi.address}</td><td>{poi.distance} m</td><td>{poi.distance_bucket}</td></tr>)}</tbody></table></div></section>}
  </div>
}

function BusinessProfile({data,onGenerate,busy}:{data:BusinessAnalysis|null;onGenerate:()=>void;busy:boolean}) {
  if(!data) return <section className="panel profile-empty"><h2>尚未生成商圈画像</h2><p>商圈分析会额外查询或复用商业、住宅、教育、交通、办公等 POI，可能增加高德接口调用量。</p><button className="primary" disabled={busy} onClick={onGenerate}>{busy?"正在生成…":"生成商圈画像"}</button></section>;
  const layers=Object.entries(data.feature_vector.layers).sort((a,b)=>Number(a[0])-Number(b[0]));
  const typeScores=Object.entries(data.business_district_type.scores).sort((a,b)=>b[1]-a[1]);
  const levelIndicators=Object.entries(data.feature_vector.level_indicators||{});
  const fitComponents=Object.entries(data.feature_vector.fit_components||{});
  return <section className="business-profile">
    <div className="profile-kpis panel">
      <div><small>高德商圈名称</small><b>{data.business_area.name}</b><span>可信度：{data.business_area.confidence}</span></div>
      <div><small>商圈类型</small><b>{data.business_district_type.type}</b><span>类型可信度：{data.business_district_type.confidence}</span></div>
      <div><small>商圈能级</small><b>{data.level.level}级 · {data.level.score}分</b><span>{data.level.mode}</span></div>
      <div><small>业务适配度</small><b>{data.fit.score}分</b><span>{data.fit.level}</span></div>
      <div><small>竞争压力</small><b>{data.competition.level}</b><span>{data.competition.score}分</span></div>
      <div><small>分析可信度</small><b>{data.confidence_level}</b><span>{new Date(data.created_at).toLocaleString("zh-CN")}</span></div>
    </div>
    <div className="profile-grid">
      <div className="panel metric-chart"><h2>不同半径 POI 对比</h2>{layers.map(([radius,layer])=><div className="bar" key={radius}><span>{formatRadius(Number(radius))}</span><div><i style={{width:`${Math.min(100,layer.total/Math.max(1,...layers.map(([,x])=>x.total))*100)}%`}}/></div><b>{layer.total}</b></div>)}</div>
      <div className="panel metric-chart"><h2>商圈类型得分</h2>{typeScores.slice(0,6).map(([name,value])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${value}%`}}/></div><b>{Math.round(value)}</b></div>)}</div>
      <div className="panel metric-chart"><h2>商圈能级指标</h2>{levelIndicators.map(([name,value])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${value}%`}}/></div><b>{Math.round(value)}</b></div>)}</div>
      <div className="panel metric-chart"><h2>业务适配度构成</h2>{fitComponents.map(([name,value])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${value}%`}}/></div><b>{Math.round(value)}</b></div>)}</div>
    </div>
    <div className="panel evidence-grid"><div><h3>判断依据与主要优势</h3>{data.strengths.map((x,i)=><p key={i}>• {x}</p>)}</div><div><h3>主要不足</h3>{data.weaknesses.length?data.weaknesses.map((x,i)=><p key={i}>• {x}</p>):<p>当前规则未识别到明显短板</p>}</div><div><h3>数据限制与风险</h3>{data.warning_messages.map((x,i)=><p key={i}>• {x}</p>)}<p>{data.disclaimer}</p></div></div>
  </section>
}

function AudienceProfile({data,onGenerate,busy}:{data:AudienceProfileData|null;onGenerate:()=>void;busy:boolean}) {
  if(!data) return <section className="panel profile-empty"><h2>尚未生成潜在人群画像</h2><p>系统会根据住宅、教育、办公、交通、商业等 POI 推断周边可能较多的人群年龄段和消费环境。结论不是人口统计或真实顾客数据。</p><button className="primary" disabled={busy} onClick={onGenerate}>{busy?"正在生成…":"生成智能画像"}</button></section>;
  return <section className="audience-profile">
    <div className="panel audience-hero">
      <div><small>智能环境画像</small><h2>{data.primary_groups.map(x=>x.label).join(" + ")}</h2><p>{data.method} · 综合可信度：{data.confidence}</p></div>
      <span className="confidence">推断结果</span>
    </div>
    <div className="panel narrative"><h2>一眼看懂</h2>{data.summary.map((text,index)=><p key={index}>{text}</p>)}</div>
    <div className="audience-grid">
      <div className="panel metric-chart"><h2>潜在人群年龄段指数</h2><p className="metric-note">指数用于比较环境倾向，不代表人口比例</p>{data.age_segments.map(item=><div className="age-row" key={item.label}><div><b>{item.label}</b><small>{item.age_range}</small></div><div className="bar"><span aria-hidden="true"/><div><i style={{width:`${item.index}%`}}/></div><b>{Math.round(item.index)}</b></div><p>{item.basis}</p></div>)}</div>
      <div className="profile-stack">
        <div className="panel insight-card"><small>消费能力代理判断</small><h2>{data.consumption_power.level}</h2><strong>{data.consumption_power.index}<i>/100</i></strong><p>{data.consumption_power.basis}</p><span>可信度：{data.consumption_power.confidence}</span></div>
        <div className="panel insight-card"><small>商场档次代理判断</small><h2>{data.mall_profile.level}</h2><strong>{data.mall_profile.sample_count}<i> 个商业样本</i></strong><p>{data.mall_profile.basis}</p>{data.mall_profile.sample_names.length>0&&<div className="sample-tags">{data.mall_profile.sample_names.map(name=><span key={name}>{name}</span>)}</div>}<span>可信度：{data.mall_profile.confidence}</span></div>
      </div>
    </div>
    <div className="panel evidence-grid audience-evidence"><div><h3>推断依据</h3>{data.evidence.map((x,i)=><p key={i}>• {x}</p>)}</div><div><h3>重要限制</h3>{data.limitations.map((x,i)=><p key={i}>• {x}</p>)}</div></div>
  </section>;
}

function PoiMap({store,pois,radii}:{store:MapStore;pois:Poi[];radii:number[]}) {
  const ref = useRef<HTMLDivElement>(null);
  const jsKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || "";
  const [displayed,setDisplayed]=useState(()=>({store:{...store,location:[...store.location] as [number,number]},pois:[...pois],radii:[...radii]}));
  const latestFingerprint=`${store.location.join(",")}|${radii.join(",")}|${pois.map(p=>`${p.id}:${p.location.join(",")}`).join("|")}`;
  const displayedFingerprint=`${displayed.store.location.join(",")}|${displayed.radii.join(",")}|${displayed.pois.map(p=>`${p.id}:${p.location.join(",")}`).join("|")}`;
  const hasUpdates=latestFingerprint!==displayedFingerprint;
  const refreshMap=()=>setDisplayed({store:{...store,location:[...store.location] as [number,number]},pois:[...pois],radii:[...radii]});
  useEffect(()=>{
    if (!jsKey || !ref.current) return;
    let map: AMapObject | undefined;
    const draw = () => {
      const AMap = (window as Window & {AMap?: AMapApi}).AMap;
      if (!AMap || !ref.current) return;
      map = new AMap.Map(ref.current,{zoom:14,center:displayed.store.location,viewMode:"2D"});
      displayed.radii.forEach((radius,i)=>map.add(new AMap.Circle({center:displayed.store.location,radius,strokeColor:"#08745b",strokeOpacity:.55,strokeWeight:1,fillColor:"#67b79e",fillOpacity:.04,zIndex:10+i})));
      map.add(new AMap.Marker({position:displayed.store.location,title:displayed.store.name,label:{content:"门店",direction:"top"},zIndex:100}));
      const markers=displayed.pois.map(p=>new AMap.Marker({position:p.location,title:`${p.name} · ${p.distance}米`,extData:p}));
      map.add(markers);
      map.setFitView(markers,false,[60,60,60,60],16);
    };
    (window as Window & {_AMapSecurityConfig?:Record<string,string>})._AMapSecurityConfig={securityJsCode:securityCode};
    if ((window as Window & {AMap?: AMapApi}).AMap) draw();
    else {
      const existing=document.querySelector<HTMLScriptElement>('script[data-amap="poi-platform"]');
      if (existing) existing.addEventListener("load",draw,{once:true});
      else {
        const script=document.createElement("script");script.dataset.amap="poi-platform";script.src=`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}`;script.async=true;script.onload=draw;
        script.onerror=()=>{if(ref.current)ref.current.innerHTML='<div class="map-load-error">高德地图 JS 加载失败，请检查 JS Key、安全密钥和域名白名单</div>'};
        document.head.appendChild(script);
      }
    }
    return ()=>map?.destroy?.();
  },[jsKey,securityCode,displayed]);

  return <div className="manual-map"><div className="map-refresh-bar"><span aria-live="polite">{hasUpdates?"POI 数据已有更新，地图尚未刷新":"地图已显示当前数据"}</span><button type="button" onClick={refreshMap}>刷新地图</button></div>{jsKey?<div ref={ref} className="map-canvas real-map" aria-label="高德地图 POI 分布"/>:<div className="map-canvas">
    {[24,40,58].map((s,i)=><div key={s} className="radius" style={{width:`${s}%`,height:`${s}%`}}><span>{[...displayed.radii].sort((a,b)=>a-b)[i]||Math.max(...displayed.radii)}m</span></div>)}
    <div className="store-pin">店</div>
    {displayed.pois.slice(0,38).map((p,i)=><button key={p.id} className="poi-dot" title={`${p.name} · ${p.distance}m`} style={{left:`${12+(i*37)%78}%`,top:`${14+(i*53)%70}%`}}/> )}
    <div className="map-note">演示地图底图 · 配置 NEXT_PUBLIC_AMAP_JS_KEY 后加载高德 JS API</div>
  </div>}</div>;
}
