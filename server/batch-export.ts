import ExcelJS from "exceljs";
import type { Poi, Row } from "./services.js";

export const EXPORT_BASE_FIELDS = [
  {id:"province",label:"省份",group:"门店信息"},{id:"city",label:"城市",group:"门店信息"},{id:"district",label:"区县",group:"门店信息"},
  {id:"longitude",label:"经度",group:"定位信息"},{id:"latitude",label:"纬度",group:"定位信息"},{id:"amap_poi_id",label:"高德 POI ID",group:"定位信息"},
  {id:"user_code",label:"门店编号",group:"门店信息"},{id:"brand",label:"品牌",group:"门店信息"},{id:"status",label:"分析状态",group:"分析信息"},
  {id:"match_score",label:"门店匹配分",group:"分析信息"},{id:"poi_total",label:"POI 总数量",group:"分析信息"},{id:"analysis_time",label:"分析完成时间",group:"分析信息"},
  {id:"business_district_type",label:"商圈类型",group:"商圈画像"},{id:"business_area",label:"识别区域",group:"商圈画像"},{id:"business_level",label:"商圈能级",group:"商圈画像"},
  {id:"business_district_recognition",label:"各半径商圈识别",group:"商圈画像"},{id:"business_district_score",label:"主半径商圈得分",group:"商圈画像"},{id:"business_district_confidence",label:"商圈识别置信度",group:"商圈画像"},{id:"business_district_evidence",label:"商圈识别依据",group:"商圈画像"},
  {id:"main_audience",label:"主要潜在人群",group:"潜在人群"},{id:"secondary_audience",label:"次要潜在人群",group:"潜在人群"},{id:"age_ranges",label:"主要年龄段",group:"潜在人群"},
  {id:"consumption_level",label:"消费能力判断",group:"潜在人群"},{id:"consumption_index",label:"消费环境指数",group:"潜在人群"},{id:"mall_profile",label:"商场环境判断",group:"潜在人群"},
  {id:"analysis_confidence",label:"分析可信度",group:"可信度与依据"},{id:"analysis_evidence",label:"分析依据",group:"可信度与依据"},{id:"analysis_limitations",label:"数据限制",group:"可信度与依据"},
  {id:"ai_summary",label:"AI 分析摘要",group:"AI 分析"},{id:"ai_audience",label:"AI 主要潜在人群",group:"AI 分析"},{id:"ai_consumption",label:"AI 消费能力判断",group:"AI 分析"},{id:"ai_confidence",label:"AI 可信度",group:"AI 分析"},
  {id:"error_message",label:"失败原因",group:"异常信息"},
] as const;

export type ExportFieldId=(typeof EXPORT_BASE_FIELDS)[number]["id"];
export type ExportSelection={jobIds:number[];storeIds:number[];fields:string[];radii:number[];categories:string[];includePoiDetails:boolean;includeFailures:boolean;includeNotes:boolean};

export function sanitizeExcelText(value:unknown){
  const text=String(value??"");
  return /^[=+\-@]/.test(text)?`'${text}`:text;
}

export function radiusLabel(radius:number){return radius>=1000&&radius%1000===0?`${radius/1000}公里`:`${radius}米`}
export function poiColumnLabel(radius:number,category:string){return `${radiusLabel(radius)}${category}数量`}
export function countPois(pois:Poi[],radius:number,category:string){return pois.filter(poi=>poi.category===category&&Number(poi.distance)<=radius).length}

function text(value:unknown){return sanitizeExcelText(value)}
function join(values:unknown,separator="、"){return Array.isArray(values)?values.map(value=>typeof value==="object"&&value?String((value as Row).label||(value as Row).age_range||""):String(value??"")).filter(Boolean).join(separator):""}
function storeName(row:Row){return text(row.standard_name||row.input_name||"")}
function storeAddress(row:Row){return text(row.address||"")}
function recognitionValues(analysis:Row){
  const recognition=(analysis.business_district_recognition||{}) as Row,byRadius=(recognition.by_radius||{}) as Record<string,Row>,primary=byRadius[String(recognition.primary_radius)]||{},all=Object.values(byRadius).sort((a,b)=>Number(a.radius)-Number(b.radius));
  return {summary:all.map(item=>`${radiusLabel(Number(item.radius))}：${item.is_business_district==null?"暂无法判断":item.is_business_district?"是":"否"}（${item.strength||item.status||""}）`).join("；"),score:primary.score==null?"":Number(primary.score),confidence:primary.confidence||"",evidence:join(primary.evidence,"；")};
}

function optionalValue(id:string,row:Row,ai:Row){
  const analysis=(row.analysis_json||{}) as Row,audience=(analysis.audience_profile||{}) as Row,groups=Array.isArray(audience.primary_groups)?audience.primary_groups as Row[]:[],aiResult=(ai.result_json||{}) as Row,recognition=recognitionValues(analysis);
  const values:Record<string,unknown>={
    province:row.province,city:row.city,district:row.district,longitude:row.longitude==null?"":Number(row.longitude),latitude:row.latitude==null?"":Number(row.latitude),amap_poi_id:row.amap_poi_id,
    user_code:row.user_code,brand:row.brand,status:row.status,match_score:row.match_score==null?"":Number(row.match_score),poi_total:Array.isArray(row.pois_json)?row.pois_json.length:0,
    analysis_time:row.updated_at?new Date(row.updated_at):"",business_district_type:analysis.business_district_type?.type,business_area:analysis.business_area?.name,business_level:analysis.level?.level,
    business_district_recognition:recognition.summary,business_district_score:recognition.score,business_district_confidence:recognition.confidence,business_district_evidence:recognition.evidence,
    main_audience:groups[0]?.label,secondary_audience:groups[1]?.label,age_ranges:groups.map(group=>group.age_range).filter(Boolean).join("、"),consumption_level:audience.consumption_power?.level,
    consumption_index:audience.consumption_power?.index==null?"":Number(audience.consumption_power.index),mall_profile:audience.mall_profile?.level,analysis_confidence:analysis.confidence_level||audience.confidence,
    analysis_evidence:join(audience.evidence,"；"),analysis_limitations:join(audience.limitations,"；"),ai_summary:aiResult.summary,ai_audience:join(aiResult.primary_users),
    ai_consumption:aiResult.consumption_power?.level,ai_confidence:aiResult.confidence?.level,error_message:row.error_message,
  };
  const value=values[id];return typeof value==="string"?text(value):value??"";
}

function styleHeader(row:ExcelJS.Row){row.height=25;row.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF08745B"}};cell.alignment={vertical:"middle",horizontal:"center",wrapText:true};cell.border={bottom:{style:"thin",color:{argb:"FFB8D8CD"}}}})}
function fitColumns(sheet:ExcelJS.Worksheet,min=12,max=36){sheet.columns.forEach(column=>{let width=min;column.eachCell?.({includeEmpty:true},cell=>{const length=cell.value instanceof Date?19:String(cell.value??"").length;width=Math.max(width,Math.min(max,length+3))});column.width=width})}
function prepareSheet(sheet:ExcelJS.Worksheet){sheet.views=[{state:"frozen",ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:Math.max(1,sheet.columnCount)}};styleHeader(sheet.getRow(1));sheet.eachRow((row,index)=>{if(index>1&&index%2===1)row.eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF4F8F6"}}})})}

export async function buildBatchExportWorkbook(rows:Row[],aiRows:Row[],selection:ExportSelection,meta:{userEmail:string;jobNames:string[]}){
  const workbook=new ExcelJS.Workbook();workbook.creator="店界 POI";workbook.created=new Date();workbook.modified=new Date();
  const selectedFields=EXPORT_BASE_FIELDS.filter(field=>selection.fields.includes(field.id));
  const poiColumns=selection.radii.flatMap(radius=>selection.categories.map(category=>({radius,category,label:poiColumnLabel(radius,category)})));
  const main=workbook.addWorksheet("门店汇总",{properties:{defaultRowHeight:20}});main.addRow(["门店名称","门店地址",...selectedFields.map(field=>field.label),...poiColumns.map(field=>field.label)]);
  const aiByStore=new Map(aiRows.map(row=>[Number(row.store_id),row]));
  for(const row of rows){const pois=Array.isArray(row.pois_json)?row.pois_json as Poi[]:[],ai=aiByStore.get(Number(row.id))||{},config=(row.job_config||{}) as Row,availableRadii=(Array.isArray(config.radii)?config.radii:[]).map(Number),availableCategories=Array.isArray(config.categories)?config.categories.map(String):[];main.addRow([storeName(row),storeAddress(row),...selectedFields.map(field=>optionalValue(field.id,row,ai)),...poiColumns.map(column=>availableRadii.includes(column.radius)&&availableCategories.includes(column.category)?countPois(pois,column.radius,column.category):"")])}
  prepareSheet(main);fitColumns(main);main.getColumn(1).width=Math.max(20,main.getColumn(1).width||0);main.getColumn(2).width=Math.max(32,main.getColumn(2).width||0);
  if(selection.includePoiDetails){const detail=workbook.addWorksheet("POI明细");detail.addRow(["门店名称","门店地址","POI名称","POI分类","POI地址","直线距离（米）","经度","纬度"]);for(const row of rows)for(const poi of (Array.isArray(row.pois_json)?row.pois_json as Poi[]:[]))detail.addRow([storeName(row),storeAddress(row),text(poi.name),text(poi.category),text(poi.address),Number(poi.distance),Number(poi.location?.[0]),Number(poi.location?.[1])]);prepareSheet(detail);fitColumns(detail)}
  if(selection.includeFailures){const failed=workbook.addWorksheet("失败与未完成门店");failed.addRow(["门店名称","门店地址","状态","失败原因"]);for(const row of rows.filter(item=>item.status!=="分析完成"))failed.addRow([storeName(row),storeAddress(row),text(row.status),text(row.error_message)]);prepareSheet(failed);fitColumns(failed)}
  if(selection.includeNotes){const notes=workbook.addWorksheet("导出说明");notes.columns=[{width:24},{width:90}];notes.addRows([["项目","内容"],["导出账号",text(meta.userEmail)],["导出时间",new Date()],["来源任务",text(meta.jobNames.join("、"))],["选择的分析半径",selection.radii.map(radiusLabel).join("、")],["选择的 POI 分类",selection.categories.join("、")],["统计口径","各 POI 数量按门店坐标为圆心、POI 直线距离小于或等于所选半径进行累计统计。"],["数据说明","POI 来自高德地图查询结果；潜在人群、消费能力、商圈类型均属于基于 POI 结构的代理推断，并非人口、收入、客流、订单或会员事实。"],["空值说明","未生成画像、未生成 AI 分析或原始数据缺失时保留空白，不补造数据。"]]);styleHeader(notes.getRow(1));notes.getColumn(2).alignment={wrapText:true,vertical:"top"}}
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
