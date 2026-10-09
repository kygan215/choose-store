"use client";

import {useEffect,useId,useMemo,useRef,useState} from "react";
import "./poi-explorer.css";
import {amapPlaceUrl,normalizeAmapTel} from "./amap-contact";
import {formatAmapRating} from "./amap-rating";
import {emptyPoiFilters,filterPois,poiCategoryOptions,poiKey,type ExplorerPoi,type PoiFilters} from "./poi-explorer";

export function PoiFilterBar({pois,radii,value,onChange}:{pois:ExplorerPoi[];radii:number[];value:PoiFilters;onChange:(value:PoiFilters)=>void}){
  const options=useMemo(()=>poiCategoryOptions(pois),[pois]);
  const category=value.categories===null?"":value.categories.length===1?value.categories[0]:"__custom";
  const distances=[...new Set(radii.filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
  return <div className="poi-filter-bar">
    <label>POI 分类<select aria-label="POI 分类筛选" value={category} onChange={e=>onChange({...value,categories:e.target.value?[e.target.value]:null})}>
      <option value="">全部分类（{pois.length}）</option>
      {category==="__custom"&&<option value="__custom" disabled>{value.categories?.length?`已选 ${value.categories.length} 类`:"未选择分类"}</option>}
      {options.map(item=><option key={item.name} value={item.name}>{item.name}（{item.count}）</option>)}
    </select></label>
    <label className="poi-search-field">查找 POI<input type="search" aria-label="搜索 POI" placeholder="输入名称、地址或关键词，如：实验小学" value={value.keyword} onChange={e=>onChange({...value,keyword:e.target.value})}/></label>
    <label>直线距离<select aria-label="POI 距离筛选" value={value.radius} onChange={e=>onChange({...value,radius:e.target.value})}><option value="">全部距离</option>{distances.map(radius=><option key={radius} value={radius}>{radius} 米以内</option>)}</select></label>
    <button type="button" className="outline" onClick={()=>onChange(emptyPoiFilters())}>重置筛选</button>
  </div>;
}

export function PoiDetails({poi,onClose}:{poi:ExplorerPoi;onClose:()=>void}){
  const titleId=useId(),ref=useRef<HTMLElement>(null),url=amapPlaceUrl(poi.id);
  useEffect(()=>{ref.current?.focus()},[poi]);
  return <section ref={ref} tabIndex={-1} className="poi-detail-card" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==="Escape")onClose()}}>
    <div className="poi-detail-heading"><div><small>周边 POI 详情</small><h3 id={titleId}>{poi.name}</h3></div><button type="button" aria-label="关闭 POI 详情" onClick={onClose}>×</button></div>
    <div className="poi-detail-tags"><span className="tag">{poi.category}</span>{poi.competitor_relation&&<span className="tag">{poi.competitor_relation}</span>}</div>
    <dl><div><dt>详细地址</dt><dd>{poi.address||"暂无地址"}</dd></div><div><dt>高德分类</dt><dd>{poi.type||"暂无分类信息"}</dd></div>
      <div><dt>距本店</dt><dd>{Number.isFinite(poi.distance)?`${poi.distance} 米（直线距离）`:"暂无距离"}</dd></div>
      <div><dt>联系电话</dt><dd>{normalizeAmapTel(poi.tel)||"当前记录未提供"}</dd></div>
      <div><dt>高德评分</dt><dd>{formatAmapRating(poi.rating)}</dd></div>
      {poi.cost!=null&&Number.isFinite(poi.cost)&&poi.cost>0&&<div><dt>人均消费</dt><dd>¥{poi.cost}</dd></div>}
      {poi.brand&&<div><dt>品牌</dt><dd>{poi.brand}</dd></div>}
      <div><dt>POI 编号</dt><dd>{poi.id||"暂无编号"}</dd></div>
    </dl>
    {url&&<a className="download" href={url} target="_blank" rel="noopener noreferrer">在高德查看详情、照片与评价 ↗</a>}
    <p className="poi-detail-note">以上为本次分析保存的信息；更多信息以高德当前页面为准。</p>
  </section>;
}

export default function PoiTable({pois,radii}:{pois:ExplorerPoi[];radii:number[]}){
  const [filters,setFilters]=useState(emptyPoiFilters),[selected,setSelected]=useState<ExplorerPoi|null>(null);
  const rows=useMemo(()=>filterPois(pois,filters),[pois,filters]);
  const selectedPoi=selected?rows.find(p=>poiKey(p)===poiKey(selected)):undefined;
  return <div className="poi-explorer">
    <PoiFilterBar pois={pois} radii={radii} value={filters} onChange={value=>{setFilters(value);setSelected(null)}}/>
    <p className="poi-result-count" aria-live="polite">筛选结果 {rows.length} / {pois.length} 条 · 按直线距离从近到远排列 · 点击名称查看详情</p>
    {selectedPoi&&<PoiDetails poi={selectedPoi} onClose={()=>setSelected(null)}/>}
    <div className="table-wrap"><table><thead><tr><th>POI 名称</th><th>分类</th><th>地址</th><th>直线距离</th><th>距离层级</th></tr></thead><tbody>
      {rows.map((poi,index)=><tr key={`${poiKey(poi)}-${index}`} className={selectedPoi===poi?"current-row":""}><td><button type="button" className="poi-name-button" onClick={()=>setSelected(poi)}>{poi.name}</button></td><td><span className="tag">{poi.category}</span></td><td>{poi.address||"暂无地址"}</td><td>{poi.distance} m</td><td>{poi.distance_bucket||"—"}</td></tr>)}
      {!rows.length&&<tr><td colSpan={5}><div className="empty"><b>当前筛选没有匹配的 POI</b><p>可调整分类、关键词或距离。分类为 0 表示本次结果未包含该类地点，不代表附近一定没有。</p></div></td></tr>}
    </tbody></table></div>
  </div>;
}
