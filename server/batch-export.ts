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
  {id:"residential_activity_level",label:"住宅活跃度",group:"环境代理指标"},{id:"residential_activity_index",label:"住宅活跃度指数",group:"环境代理指标"},{id:"residential_activity_confidence",label:"住宅活跃度置信度",group:"环境代理指标"},{id:"residential_activity_evidence",label:"住宅活跃度依据",group:"环境代理指标"},
  {id:"consumption_level",label:"消费环境等级",group:"环境代理指标"},{id:"consumption_index",label:"消费环境指数",group:"环境代理指标"},{id:"consumption_confidence",label:"消费环境置信度",group:"环境代理指标"},{id:"consumption_evidence",label:"消费环境依据",group:"环境代理指标"},{id:"mall_profile",label:"商场环境判断",group:"环境代理指标"},
  {id:"competitor_total",label:"主半径竞品总数",group:"竞品看板"},{id:"competitor_same_brand",label:"主半径同品牌竞品数",group:"竞品看板"},{id:"competitor_other_brand",label:"主半径异品牌竞品数",group:"竞品看板"},{id:"nearest_competitor",label:"最近竞品",group:"竞品看板"},{id:"nearest_competitor_brand",label:"最近竞品品牌",group:"竞品看板"},{id:"nearest_competitor_distance",label:"最近竞品距离（米）",group:"竞品看板"},{id:"competition_score",label:"竞争强度分",group:"竞品看板"},{id:"competition_level",label:"竞争强度等级",group:"竞品看板"},{id:"competition_by_radius",label:"各半径竞品统计",group:"竞品看板"},{id:"competition_evidence",label:"竞争强度依据",group:"竞品看板"},
  {id:"analysis_confidence",label:"分析可信度",group:"可信度与依据"},{id:"analysis_evidence",label:"分析依据",group:"可信度与依据"},{id:"analysis_limitations",label:"数据限制",group:"可信度与依据"},
  {id:"ai_summary",label:"AI 活动摘要",group:"AI 分析"},{id:"ai_activity_fit",label:"AI 活动适配度",group:"AI 分析"},{id:"ai_activity_fit_score",label:"AI 活动适配分",group:"AI 分析"},
  {id:"ai_parent_child_strength",label:"AI 亲子客群强度",group:"AI 分析"},{id:"ai_parent_child_index",label:"AI 亲子客群指数",group:"AI 分析"},{id:"ai_core_child_age",label:"AI 核心儿童年龄段",group:"AI 分析"},
  {id:"ai_touch_scenes",label:"AI 活动触达场景",group:"AI 分析"},{id:"ai_audience",label:"AI 主要潜在人群",group:"AI 分析"},{id:"ai_consumption",label:"AI 消费环境判断",group:"AI 分析"},
  {id:"ai_evidence",label:"AI 判断依据",group:"AI 分析"},{id:"ai_confidence",label:"AI 可信度",group:"AI 分析"},{id:"ai_limitations",label:"AI 数据限制",group:"AI 分析"},
  {id:"ai_activity_theme",label:"AI 活动主题建议",group:"AI 分析"},{id:"ai_activity_steps",label:"AI 活动形式与执行步骤",group:"AI 分析"},{id:"ai_activity_timing",label:"AI 建议触达时间",group:"AI 分析"},{id:"ai_activity_resources",label:"AI 所需资源与注意事项",group:"AI 分析"},
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
function storeName(row:Row){return text(row.input_name||row.standard_name||"")}
function storeAddress(row:Row){return text(row.address||"")}
function recognitionValues(analysis:Row){
  const recognition=(analysis.business_district_recognition||{}) as Row,byRadius=(recognition.by_radius||{}) as Record<string,Row>,primary=byRadius[String(recognition.primary_radius)]||{},all=Object.values(byRadius).sort((a,b)=>Number(a.radius)-Number(b.radius));
  return {summary:all.map(item=>`${radiusLabel(Number(item.radius))}：${item.is_business_district==null?"暂无法判断":item.is_business_district?"是":"否"}（${item.strength||item.status||""}）`).join("；"),score:primary.score==null?"":Number(primary.score),confidence:primary.confidence||"",evidence:join(primary.evidence,"；")};
}

function proxyValues(analysis:Row){
  const proxies=(analysis.environment_proxies||{}) as Row,primary=String(proxies.primary_radius||500),residential=(((proxies.residential_activity||{}) as Row).by_radius||{})[primary]||{},consumption=(((proxies.consumption_environment||{}) as Row).by_radius||{})[primary]||{},competition=(((proxies.competition_dashboard||{}) as Row).by_radius||{})[primary]||{},competitionRows=Object.values((((proxies.competition_dashboard||{}) as Row).by_radius||{}) as Record<string,Row>).sort((a,b)=>Number(a.radius)-Number(b.radius));
  return {residential:residential as Row,consumption:consumption as Row,competition:competition as Row,competitionSummary:competitionRows.map(item=>`${radiusLabel(Number(item.radius))}：${Number(item.total||0)}家（同品牌${Number(item.same_brand||0)}、异品牌${Number(item.other_brand||0)}），${item.level||"—"}${item.nearest?`，最近${(item.nearest as Row).name}${(item.nearest as Row).distance}米`:""}`).join("；")};
}

function optionalValue(id:string,row:Row,ai:Row){
  const analysis=(row.analysis_json||{}) as Row,audience=(analysis.audience_profile||{}) as Row,groups=Array.isArray(audience.primary_groups)?audience.primary_groups as Row[]:[],aiResult=(ai.result_json||{}) as Row,recognition=recognitionValues(analysis),proxies=proxyValues(analysis),nearest=(proxies.competition.nearest||{}) as Row;
  const aiError=String(aiResult.summary||"");if(id.startsWith("ai_")&&/^(AI生成失败|未生成：)/.test(aiError))return text(aiError);
  const values:Record<string,unknown>={
    province:row.province,city:row.city,district:row.district,longitude:row.longitude==null?"":Number(row.longitude),latitude:row.latitude==null?"":Number(row.latitude),amap_poi_id:row.amap_poi_id,
    user_code:row.user_code,brand:row.brand,status:row.status,match_score:row.match_score==null?"":Number(row.match_score),poi_total:Array.isArray(row.pois_json)?row.pois_json.length:0,
    analysis_time:row.updated_at?new Date(row.updated_at):"",business_district_type:analysis.business_district_type?.type,business_area:analysis.business_area?.name,business_level:analysis.level?.level,
    business_district_recognition:recognition.summary,business_district_score:recognition.score,business_district_confidence:recognition.confidence,business_district_evidence:recognition.evidence,
    main_audience:groups[0]?.label,secondary_audience:groups[1]?.label,age_ranges:groups.map(group=>group.age_range).filter(Boolean).join("、"),residential_activity_level:proxies.residential.level,residential_activity_index:proxies.residential.score==null?"":Number(proxies.residential.score),residential_activity_confidence:proxies.residential.confidence,residential_activity_evidence:join(proxies.residential.evidence,"；"),consumption_level:proxies.consumption.level||audience.consumption_power?.level,
    consumption_index:proxies.consumption.score==null?(audience.consumption_power?.index==null?"":Number(audience.consumption_power.index)):Number(proxies.consumption.score),consumption_confidence:proxies.consumption.confidence,consumption_evidence:join(proxies.consumption.evidence,"；"),mall_profile:audience.mall_profile?.level,competitor_total:proxies.competition.total==null?"":Number(proxies.competition.total),competitor_same_brand:proxies.competition.same_brand==null?"":Number(proxies.competition.same_brand),competitor_other_brand:proxies.competition.other_brand==null?"":Number(proxies.competition.other_brand),nearest_competitor:nearest.name,nearest_competitor_brand:nearest.brand,nearest_competitor_distance:nearest.distance==null?"":Number(nearest.distance),competition_score:proxies.competition.score==null?"":Number(proxies.competition.score),competition_level:proxies.competition.level,competition_by_radius:proxies.competitionSummary,competition_evidence:join(proxies.competition.evidence,"；"),analysis_confidence:analysis.confidence_level||audience.confidence,
    analysis_evidence:join(audience.evidence,"；"),analysis_limitations:join(audience.limitations,"；"),ai_summary:aiResult.summary,ai_activity_fit:aiResult.parent_child_activity?.fit_level,ai_activity_fit_score:aiResult.parent_child_activity?.fit_score,
    ai_parent_child_strength:aiResult.parent_child_activity?.audience_level,ai_parent_child_index:aiResult.parent_child_activity?.audience_score,ai_core_child_age:aiResult.parent_child_activity?.core_child_age,ai_touch_scenes:join(aiResult.parent_child_activity?.touch_scenes,"；"),ai_audience:join(aiResult.primary_users),
    ai_consumption:aiResult.consumption_power?.level,ai_evidence:join(aiResult.parent_child_activity?.evidence?.length?aiResult.parent_child_activity.evidence:aiResult.evidence,"；"),ai_confidence:aiResult.confidence?.level,ai_limitations:join(aiResult.limitations,"；"),
    ai_activity_theme:aiResult.activity_plan?.theme,ai_activity_steps:join(aiResult.activity_plan?.format_steps,"；"),ai_activity_timing:aiResult.activity_plan?.suggested_timing,ai_activity_resources:join(aiResult.activity_plan?.resources_notes,"；"),error_message:row.error_message,
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
  if(selection.includePoiDetails){const detail=workbook.addWorksheet("POI明细");detail.addRow(["门店名称","门店地址","POI名称","POI分类","竞品品牌","竞品关系","POI地址","直线距离（米）","高德人均消费","经度","纬度"]);for(const row of rows)for(const poi of (Array.isArray(row.pois_json)?row.pois_json as Poi[]:[]))detail.addRow([storeName(row),storeAddress(row),text(poi.name),text(poi.category),text(poi.brand),text(poi.competitor_relation),text(poi.address),Number(poi.distance),poi.cost==null?"":Number(poi.cost),Number(poi.location?.[0]),Number(poi.location?.[1])]);prepareSheet(detail);fitColumns(detail)}
  if(selection.includeFailures){const failed=workbook.addWorksheet("失败与未完成门店");failed.addRow(["门店名称","门店地址","状态","失败原因"]);for(const row of rows){const aiSummary=String((aiByStore.get(Number(row.id))?.result_json||{}).summary||""),aiFailed=/^(AI生成失败|未生成：)/.test(aiSummary);if(row.status!=="分析完成"||aiFailed)failed.addRow([storeName(row),storeAddress(row),text(aiFailed?"AI未完成":row.status),text(aiFailed?aiSummary:row.error_message)])}prepareSheet(failed);fitColumns(failed)}
  if(selection.includeNotes){const notes=workbook.addWorksheet("导出说明");notes.columns=[{width:24},{width:90}];notes.addRows([["项目","内容"],["导出账号",text(meta.userEmail)],["导出时间",new Date()],["来源任务",text(meta.jobNames.join("、"))],["选择的分析半径",selection.radii.map(radiusLabel).join("、")],["选择的 POI 分类",selection.categories.join("、")],["统计口径","各 POI 数量按门店坐标为圆心、POI 直线距离小于或等于所选半径进行累计统计；代理评分按搜索面积归一化。"],["产品定位","儿童健康饮品；业务方提供卖点为清热下火、口感好喝；核心活动触达人群为妈妈带孩子家庭。该表述不是医学结论，不得扩展为治疗、治愈或疾病预防承诺。"],["数据说明","POI 来自高德地图查询结果；住宅活跃度、消费环境、潜在人群、商圈类型均属于基于 POI 结构的代理推断，并非入住率、人口、收入、房价、租金、客流、订单或会员事实。"],["竞品说明","周边可检索到的折扣零食门店用于描述活动渠道竞争环境；它们不等同于儿童饮品产品竞品，同品牌和异品牌分别标注。门店面积不在高德返回字段中，因此不展示。"],["空值说明","未生成画像、未生成 AI 分析或原始数据缺失时保留空白，不补造数据。"]]);styleHeader(notes.getRow(1));notes.getColumn(2).alignment={wrapText:true,vertical:"top"}}
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
