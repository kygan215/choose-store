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
  distance: number; location: [number, number];
};
type ImportPreview = {
  filename: string; headers: string[]; mapping: Record<string,string>;
  rows: Array<Record<string,string>>; all_rows: Array<Record<string,string>>;
  total_rows: number; warnings: string[];
};
type BusinessAnalysis = {
  id:number; analysis_version:string; radius_config:number[]; confidence_level:string;
  business_area:{name:string;source:string;confidence:string};
  business_district_type:{type:string;scores:Record<string,number>;confidence:string};
  level:{level:string;score:number;mode:string}; fit:{score:number;level:string};
  competition:{score:number;level:string}; feature_vector:{layers:Record<string,{total:number;density:number;counts:Record<string,number>;nearest:Record<string,number|null>}>;level_indicators?:Record<string,number>;fit_components?:Record<string,number>};
  strengths:string[]; weaknesses:string[]; warning_messages:string[]; disclaimer:string; created_at:string;
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
const allCategories = ["住宅小区", "幼儿园", "小学", "购物中心", "超市", "便利店", "医院", "药店", "公园", "地铁站", "公交站", "竞品门店"];
const defaultCategories = ["住宅小区", "小学", "幼儿园"];
const defaultRadii = [500,1000,2000];
const formatRadius = (value:number) => value >= 1000 ? `${Number((value/1000).toFixed(2))} 公里` : `${value} 米`;

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
  const [batchJob, setBatchJob] = useState<{job_id:number;status:string}|null>(null);
  const [resultTab,setResultTab] = useState<"distribution"|"profile"|"details">("distribution");
  const [business,setBusiness] = useState<BusinessAnalysis|null>(null);

  useEffect(() => { request<typeof mode>("/health").then(setMode).catch(() => setError("后端服务未连接，请先启动 FastAPI 服务")); }, []);

  const counts = useMemo(() => Object.entries(pois.reduce<Record<string, number>>((a, p) => ((a[p.category] = (a[p.category] || 0) + 1), a), {})), [pois]);
  const maxCount = Math.max(1, ...counts.map(([, n]) => n));

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
      setBusiness(data);setResultTab("profile");
    }catch(e){setError(e instanceof Error?e.message:"商圈画像生成失败")}finally{setBusy("")}
  }

  async function uploadFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx","xls","csv"].includes(extension)) {
      setError("仅支持 .xlsx、.xls、.csv 文件");
      return;
    }
    setBusy("upload"); setError(""); setImportPreview(null); setBatchJob(null);
    const formData = new FormData(); formData.append("file",file);
    try {
      const response = await fetch(`${API}/import/preview`,{method:"POST",body:formData});
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "文件解析失败");
      setImportPreview(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
      setDrag(false);
    }
  }

  async function createBatchJob() {
    if (!importPreview) return;
    setBusy("confirm-import"); setError("");
    try {
      const data = await request<{job_id:number;status:string}>("/import/confirm",{
        method:"POST",
        body:JSON.stringify({filename:importPreview.filename,mapping:importPreview.mapping,rows:importPreview.all_rows}),
      });
      setBatchJob(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建批量任务失败");
    } finally {
      setBusy("");
    }
  }

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

          {pois.length>0 && <><div className="result-tabs"><button className={resultTab==="distribution"?"on":""} onClick={()=>setResultTab("distribution")}>POI分布</button><button className={resultTab==="profile"?"on":""} onClick={()=>setResultTab("profile")}>商圈画像</button><button className={resultTab==="details"?"on":""} onClick={()=>setResultTab("details")}>POI明细</button><button className="primary profile-action" disabled={!!busy} onClick={generateBusinessProfile}>{busy==="business"?"正在查询更多特征…":business?"重新生成商圈画像":"生成商圈画像"}</button></div>
          {resultTab==="distribution"&&<section className="results">
            <div className="panel map-panel"><div className="panel-head"><div><h2>设施分布地图</h2><p>圆圈表示系统分析圈层，不代表高德官方商圈边界</p></div><div className="legend"><i/>门店 <i/>POI</div></div>
              <PoiMap store={selected} pois={pois} radii={radii}/>
            </div>
            <div className="panel chart"><div className="panel-head"><div><h2>分类统计</h2><p>共 {pois.length} 个已去重 POI</p></div></div>
              {counts.map(([name,n])=><div className="bar" key={name}><span>{name}</span><div><i style={{width:`${n/maxCount*100}%`}}/></div><b>{n}</b></div>)}
              <div className="disclaimer">本分析仅反映周边设施与兴趣点分布，不等同于人口、客流、消费能力或销售预测。</div>
            </div>
          </section>}
          {resultTab==="profile"&&<BusinessProfile data={business} onGenerate={generateBusinessProfile} busy={busy==="business"}/>} 
          {resultTab==="details"&&<section className="panel table-panel"><div className="panel-head"><div><h2>POI明细</h2><p>按直线距离排序</p></div>{jobId&&<a className="download" href={`${API}/analysis-jobs/${jobId}/export`}>导出 Excel</a>}</div><div className="table-wrap"><table><thead><tr><th>POI 名称</th><th>分类</th><th>地址</th><th>直线距离</th><th>距离层级</th></tr></thead><tbody>{pois.map(p=><tr key={p.id}><td>{p.name}</td><td><span className="tag">{p.category}</span></td><td>{p.address}</td><td>{p.distance} m</td><td>{(p as Poi & {distance_bucket?:string}).distance_bucket}</td></tr>)}</tbody></table></div></section>}
          </>}
        </>}

        {tab==="batch" && <section className="panel upload-panel">
          <div className="section-title"><span>01</span><div><h2>上传门店表格</h2><p>支持 .xlsx、.xls、.csv，单次最多 5,000 行</p></div></div>
          <label className={`dropzone ${drag?"drag":""}`}
            onDragEnter={e=>{e.preventDefault();setDrag(true)}}
            onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";setDrag(true)}}
            onDragLeave={e=>{e.preventDefault();if(e.currentTarget===e.target)setDrag(false)}}
            onDrop={e=>{e.preventDefault();setDrag(false);const file=e.dataTransfer.files?.[0];if(file)void uploadFile(file)}}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadFile(file);e.currentTarget.value=""}}/>
            <b>{busy==="upload"?"正在解析文件…":drag?"松开即可上传":"拖放文件到这里，或点击选择"}</b>
            <span>{busy==="upload"?"正在识别工作表、表头和数据…":"系统会展示字段映射和前 20 行预览，不会立即执行分析"}</span>
          </label>
          {importPreview && <div className="import-result">
            <div className="import-summary">
              <div><small>文件</small><b>{importPreview.filename}</b></div>
              <div><small>识别数据</small><b>{importPreview.total_rows} 行</b></div>
              <div><small>字段映射</small><b>{Object.keys(importPreview.mapping).length} 项</b></div>
              <span className="success-badge">解析成功</span>
            </div>
            <div className="mapping-block"><h3>字段映射</h3><div className="mapping-list">
              {Object.entries(importPreview.mapping).map(([field,header])=><span key={field}><b>{header}</b><i>→</i>{({name:"门店名称",province:"省份",city:"城市",district:"区县",address:"详细地址",code:"门店编号",brand:"品牌",remark:"备注"} as Record<string,string>)[field]||field}</span>)}
            </div></div>
            <div className="preview-head"><div><h3>数据预览</h3><p>显示前 {Math.min(20,importPreview.rows.length)} 行，共 {importPreview.total_rows} 行</p></div>
              <button className="primary" disabled={!!busy||!!batchJob} onClick={createBatchJob}>{busy==="confirm-import"?"正在创建任务…":batchJob?"任务已创建":"确认字段并创建任务"}</button>
            </div>
            <div className="table-wrap import-table"><table><thead><tr>{importPreview.headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{importPreview.rows.map((row,index)=><tr key={index}>{importPreview.headers.map(h=><td key={h}>{row[h]||""}</td>)}</tr>)}</tbody>
            </table></div>
            {batchJob && <div className="job-created"><b>批量任务 #{batchJob.job_id} 已创建</b><span>当前状态：{batchJob.status}。可前往“分析任务”查看。</span></div>}
          </div>}
          <div className="flow"><b>批量流程</b><span>上传文件</span><i>→</i><span>确认字段</span><i>→</i><span>候选匹配</span><i>→</i><span>人工确认</span><i>→</i><span>POI 查询</span><i>→</i><span>导出结果</span></div>
        </section>}

        {tab==="jobs" && <Jobs api={API}/>}
      </main>
    </div>
  );
}

function Jobs({api}:{api:string}) {
  const [jobs,setJobs]=useState<Array<Record<string,number|string>>>([]);
  const [results,setResults]=useState<Array<BusinessAnalysis&{store:Record<string,unknown>}>>([]);
  const [activeJob,setActiveJob]=useState<number|null>(null);
  const [jobBusy,setJobBusy]=useState("");
  const [filters,setFilters]=useState({city:"",district:"",type:"",level:"",lowConfidence:false});
  useEffect(()=>{fetch(`${api}/analysis-jobs`).then(r=>r.json()).then(b=>setJobs(b.data||[])).catch(()=>{})},[api]);
  async function loadResults(id:number){setActiveJob(id);setJobBusy("load");try{const r=await fetch(`${api}/analysis-jobs/${id}/business-district-results`);const b=await r.json();setResults(b.data||[])}finally{setJobBusy("")}}
  async function generate(id:number){setJobBusy("generate");try{await fetch(`${api}/analysis-jobs/${id}/business-district-analysis`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({radii:[500,1000,2000]})});await loadResults(id)}finally{setJobBusy("")}}
  const visible=results.filter(x=>(!filters.city||x.store?.city===filters.city)&&(!filters.district||x.store?.district===filters.district)&&(!filters.type||x.business_district_type.type===filters.type)&&(!filters.level||x.level.level===filters.level)&&(!filters.lowConfidence||x.confidence_level==="低"));
  return <section className="panel jobs"><div className="section-title"><span>●</span><div><h2>最近分析任务</h2><p>刷新页面后进度仍会保留</p></div></div>
    {jobs.length===0?<div className="empty"><b>暂无分析任务</b><p>完成一次单门店分析或批量导入后，任务会显示在这里。</p></div>:
    <table><thead><tr><th>任务</th><th>状态</th><th>门店数</th><th>进度</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>分析任务 #{j.id}</td><td><span className="tag">{j.status}</span></td><td>{j.total_stores}</td><td><progress value={Number(j.processed_stores)} max={Number(j.total_stores)||1}/></td><td>{String(j.created_at).slice(0,16).replace("T"," ")}</td><td className="row-actions"><a href={`${api}/analysis-jobs/${j.id}/export`}>导出</a><button onClick={()=>loadResults(Number(j.id))}>商圈对比</button><button disabled={!!jobBusy} onClick={()=>generate(Number(j.id))}>生成商圈</button></td></tr>)}</tbody></table>}
    {activeJob&&<div className="batch-compare"><div className="panel-head"><div><h2>任务 #{activeJob} 商圈对比</h2><p>共 {visible.length} 个结果；高适配 {visible.filter(x=>x.fit.score>=85).length} 个；高竞争 {visible.filter(x=>x.competition.level==="高").length} 个</p></div><a className="download" href={`${api}/analysis-jobs/${activeJob}/business-district-export`}>导出商圈 Excel</a></div>
      <div className="compare-filters"><input placeholder="城市" value={filters.city} onChange={e=>setFilters({...filters,city:e.target.value})}/><input placeholder="区县" value={filters.district} onChange={e=>setFilters({...filters,district:e.target.value})}/><select value={filters.type} onChange={e=>setFilters({...filters,type:e.target.value})}><option value="">全部商圈类型</option>{[...new Set(results.map(x=>x.business_district_type.type))].map(x=><option key={x}>{x}</option>)}</select><select value={filters.level} onChange={e=>setFilters({...filters,level:e.target.value})}><option value="">全部能级</option>{["S","A","B","C","D"].map(x=><option key={x}>{x}</option>)}</select><label><input type="checkbox" checked={filters.lowConfidence} onChange={e=>setFilters({...filters,lowConfidence:e.target.checked})}/>只看低可信度</label></div>
      {jobBusy==="load"?<p>正在加载…</p>:<div className="table-wrap"><table><thead><tr><th>门店</th><th>城市</th><th>区县</th><th>商圈名称</th><th>类型</th><th>能级</th><th>适配度</th><th>竞争压力</th><th>可信度</th></tr></thead><tbody>{visible.sort((a,b)=>b.fit.score-a.fit.score).map(x=><tr key={x.id}><td>{String(x.store?.input_name||"")}</td><td>{String(x.store?.city||"")}</td><td>{String(x.store?.district||"")}</td><td>{x.business_area.name}</td><td>{x.business_district_type.type}</td><td>{x.level.level} · {x.level.score}</td><td>{x.fit.score}</td><td>{x.competition.level}</td><td>{x.confidence_level}</td></tr>)}</tbody></table></div>}
    </div>}
  </section>
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

function PoiMap({store,pois,radii}:{store:Candidate;pois:Poi[];radii:number[]}) {
  const ref = useRef<HTMLDivElement>(null);
  const jsKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || "";
  useEffect(()=>{
    if (!jsKey || !ref.current) return;
    let map: any;
    const draw = () => {
      const AMap = (window as Window & {AMap?: any}).AMap;
      if (!AMap || !ref.current) return;
      map = new AMap.Map(ref.current,{zoom:14,center:store.location,viewMode:"2D"});
      radii.forEach((radius,i)=>map.add(new AMap.Circle({center:store.location,radius,strokeColor:"#08745b",strokeOpacity:.55,strokeWeight:1,fillColor:"#67b79e",fillOpacity:.04,zIndex:10+i})));
      map.add(new AMap.Marker({position:store.location,title:store.name,label:{content:"门店",direction:"top"},zIndex:100}));
      const markers=pois.map(p=>new AMap.Marker({position:p.location,title:`${p.name} · ${p.distance}米`,extData:p}));
      map.add(markers);
      map.setFitView(markers,false,[60,60,60,60],16);
    };
    (window as Window & {_AMapSecurityConfig?:Record<string,string>})._AMapSecurityConfig={securityJsCode:securityCode};
    if ((window as Window & {AMap?: any}).AMap) draw();
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
  },[jsKey,securityCode,store,pois,radii]);

  if (jsKey) return <div ref={ref} className="map-canvas real-map" aria-label="高德地图 POI 分布"/>;
  return <div className="map-canvas">
    {[24,40,58].map((s,i)=><div key={s} className="radius" style={{width:`${s}%`,height:`${s}%`}}><span>{[...radii].sort((a,b)=>a-b)[i]||Math.max(...radii)}m</span></div>)}
    <div className="store-pin">店</div>
    {pois.slice(0,38).map((p,i)=><button key={p.id} className="poi-dot" title={`${p.name} · ${p.distance}m`} style={{left:`${12+(i*37)%78}%`,top:`${14+(i*53)%70}%`}}/> )}
    <div className="map-note">演示地图底图 · 配置 NEXT_PUBLIC_AMAP_JS_KEY 后加载高德 JS API</div>
  </div>;
}
