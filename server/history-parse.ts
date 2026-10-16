import crypto from "node:crypto";
import ExcelJS from "exceljs";
export {calendarTags} from "./history-calendar.js";

export type HistoryColumn={index:number;header:string;start_date:string;end_date:string;activity_name:string};
export type HistorySourceRow={row_number:number;name:string;brand:string;province:string;city:string;region_source:"column"|"name_prefix"|"missing";address:string;poi_id:string;values:Record<string,string>;issues:string[]};
export type HistoryParsed={sheet:string;columns:HistoryColumn[];rows:HistorySourceRow[];issues:string[]};

export const textValue=(value:unknown):string=>{
  if(value==null)return "";
  if(typeof value==="object"){
    const v=value as {result?:unknown;text?:unknown;richText?:Array<{text:string}>};
    if(v.result!=null)return textValue(v.result);
    if(v.text!=null)return textValue(v.text);
    if(v.richText)return v.richText.map(item=>item.text).join("").trim();
    if(value instanceof Date)return value.toISOString().slice(0,10);
  }
  return String(value).trim();
};
const pad=(n:number)=>String(n).padStart(2,"0");
export function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value}
export function dateRangeHeader(header:string,defaultYear:number):Pick<HistoryColumn,"start_date"|"end_date">|null{
  const h=header.replace(/[－—–~～至到]/g,"-").replace(/号/g,"日").replace(/\s+/g,"");
  const full=h.match(/^(\d{4})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?-(\d{4})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?$/);
  if(full){const start_date=`${full[1]}-${pad(+full[2])}-${pad(+full[3])}`,end_date=`${full[4]}-${pad(+full[5])}-${pad(+full[6])}`;return validDate(start_date)&&validDate(end_date)&&end_date>=start_date?{start_date,end_date}:null}
  const short=h.match(/^(\d{1,2})月(\d{1,2})日?-(\d{1,2})月(\d{1,2})日?$/);
  if(!short||defaultYear<1900||defaultYear>2100)return null;
  const start_date=`${defaultYear}-${pad(+short[1])}-${pad(+short[2])}`,endYear=+short[3]<+short[1]?defaultYear+1:defaultYear,end_date=`${endYear}-${pad(+short[3])}-${pad(+short[4])}`;
  return validDate(start_date)&&validDate(end_date)&&end_date>=start_date?{start_date,end_date}:null;
}
export function salesAmount(value:string):string|null{
  const v=value.replace(/[,，\s￥¥]/g,"");
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(v))return null;
  const [whole,fraction=""]=v.split(".");
  if(whole.length>14)return null;
  return `${whole}.${fraction.padEnd(2,"0")}`;
}
export function guessRegion(name:string,locations:Array<{province:string;city:string}>,cityHint=""){
  const normalized=name.replace(/\s+/g,"").replace(/^(?:零食很忙|赵一鸣零食|赵一鸣)/,"");
  for(const pair of locations){const province=pair.province.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/,""),city=pair.city.replace(/(市|地区|自治州)$/,'');if(province&&city&&normalized.startsWith(province+city))return {province:pair.province,city:pair.city}}
  const cityOnly=cityHint.replace(/\s+/g,"").replace(/市$/,"")||normalized;
  const matches=locations.filter(pair=>{const city=pair.city.replace(/(市|地区|自治州)$/,'');return city.length>=2&&cityOnly.startsWith(city)});
  if(matches.length===1)return {province:matches[0].province,city:matches[0].city};
  return {province:"",city:""};
}
function brandFromStoreName(name:string){
  const normalized=name.normalize("NFKC").replace(/\s+/g,"");
  if(normalized.startsWith("零食很忙"))return "零食很忙";
  if(normalized.startsWith("赵一鸣零食")||normalized.endsWith("(赵一鸣)"))return "赵一鸣零食";
  return "";
}
export function historyIdentity(brand:string,name:string,province:string,city:string,address:string,ordinal=1){
  return crypto.createHash("sha256").update([brand,name,province,city,address,ordinal].map(v=>String(v).normalize("NFKC").trim().toLowerCase()).join("\0")).digest("hex");
}
const nameHeader=/^(门店名称|店名|门店名|活动门店)$/;
const headerTypes:Record<string,RegExp>={brand:/^(品牌|品牌名称|门店系统)$/,province:/^省(份)?$/,city:/^市(区)?$/,address:/^(地址|门店地址)$/,poi_id:/^(高德)?POI\s*ID$/i};
const summaryHeader=/^(?:总计|合计|汇总|总额)$/;
function sourceSheet(workbook:ExcelJS.Workbook,defaultYear:number){
  const candidates:Array<{sheet:ExcelJS.Worksheet;headerRow:number;headers:Map<number,string>;dateCount:number}>=[];
  for(const sheet of workbook.worksheets){
    if(sheet.rowCount<2||sheet.columnCount>120)continue;
    for(let headerRow=1;headerRow<=Math.min(10,sheet.rowCount-1);headerRow++){
      const headers=new Map<number,string>();for(let index=1;index<=sheet.columnCount;index++)headers.set(index,textValue(sheet.getRow(headerRow).getCell(index).value));
      if(![...headers.values()].some(value=>nameHeader.test(value)))continue;
      const dateCount=[...headers.values()].filter(value=>dateRangeHeader(value,defaultYear)).length;
      candidates.push({sheet,headerRow,headers,dateCount});
    }
  }
  return candidates.sort((a,b)=>b.dateCount-a.dateCount)[0];
}
function cityHints(workbook:ExcelJS.Workbook,source:ExcelJS.Worksheet){
  const hints=new Map<string,Set<string>>();
  for(const sheet of workbook.worksheets){
    if(sheet===source||sheet.rowCount<2)continue;
    const headers=new Map<number,string>();for(let index=1;index<=sheet.columnCount;index++)headers.set(index,textValue(sheet.getRow(1).getCell(index).value));
    const nameColumn=[...headers].find(([,value])=>nameHeader.test(value))?.[0],cityColumn=[...headers].find(([,value])=>value==="城市")?.[0];
    if(!nameColumn||!cityColumn)continue;
    for(let n=2;n<=sheet.rowCount;n++){
      const name=textValue(sheet.getRow(n).getCell(nameColumn).value),city=textValue(sheet.getRow(n).getCell(cityColumn).value);
      if(!name||!city)continue;const options=hints.get(name)||new Set<string>();options.add(city);hints.set(name,options);
    }
  }
  return hints;
}
export async function parseHistoryWorkbook(buffer:Buffer,defaultYear:number,locations:Array<{province:string;city:string}>=[]):Promise<HistoryParsed>{
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as never);
  const source=sourceSheet(workbook,defaultYear);if(!source)throw new Error("缺少“门店名称”列，或找不到可读取的宽表表头");
  const {sheet,headerRow,headers}=source;
  if(sheet.rowCount>10001||sheet.columnCount>120)throw new Error("一次最多导入 10000 家门店、120 列数据");
  const nameColumn=[...headers].find(([,v])=>nameHeader.test(v))?.[0];if(!nameColumn)throw new Error("缺少“门店名称”列");
  const typeIndex=Object.fromEntries(Object.entries(headerTypes).map(([key,re])=>[key,[...headers].find(([,v])=>re.test(v))?.[0]||0])) as Record<string,number>;
  const columns:HistoryColumn[]=[],issues:string[]=[];
  for(const [index,header] of headers){if(index===nameColumn||Object.values(typeIndex).includes(index)||summaryHeader.test(header))continue;if(!header&&!Array.from({length:sheet.rowCount-headerRow},(_,offset)=>textValue(sheet.getRow(offset+headerRow+1).getCell(index).value)).some(Boolean))continue;const range=dateRangeHeader(header,defaultYear),label=header||`第 ${index} 列（无表头）`;columns.push({index,header:label,start_date:range?.start_date||"",end_date:range?.end_date||"",activity_name:label});if(!range)issues.push(`第 ${index} 列“${label}”不是可识别的日期段，请在预览中指定起止年月日或明确忽略`)}
  if(!columns.length)throw new Error("没有活动日期列；请提供日期段表头");
  const rows:HistorySourceRow[]=[],hints=cityHints(workbook,sheet);let inferredBrands=0;
  for(let n=headerRow+1;n<=sheet.rowCount;n++){
    const row=sheet.getRow(n),name=textValue(row.getCell(nameColumn).value);if(summaryHeader.test(name))continue;if(!name&&!columns.some(col=>textValue(row.getCell(col.index).value)))continue;
    const cityOptions=hints.get(name),cityHint=cityOptions?.size===1?[...cityOptions][0]:"",inferred=guessRegion(name,locations,cityHint),values:Record<string,string>={},rowIssues:string[]=[];if(!name)rowIssues.push("缺少门店名称，请在预览中补全");
    for(const col of columns){const raw=textValue(row.getCell(col.index).value);if(!raw)continue;values[String(col.index)]=raw;if(salesAmount(raw)===null)rowIssues.push(`第 ${col.index} 列销售额“${raw}”无效`)}
    const optional=(key:string)=>typeIndex[key]?textValue(row.getCell(typeIndex[key]).value):"",explicitProvince=optional("province"),explicitCity=optional("city"),nameBrand=optional("brand")?"":brandFromStoreName(name);if(nameBrand)inferredBrands++;
    rows.push({row_number:n,name,brand:optional("brand")||nameBrand,province:explicitProvince||inferred.province,city:explicitCity||inferred.city,region_source:explicitProvince&&explicitCity?"column":inferred.province&&inferred.city?"name_prefix":"missing",address:optional("address"),poi_id:optional("poi_id"),values,issues:rowIssues});
  }
  if(inferredBrands)issues.push(`${inferredBrands} 家门店依据名称中的“零食很忙”前缀或“赵一鸣”标记暂填品牌，请在提交前核对；这不等于已验证品牌归属`);
  if(rows.length>10000||columns.length>100)throw new Error("一次最多导入 10000 家门店、100 个活动日期列");
  return {sheet:sheet.name,columns,rows,issues};
}
