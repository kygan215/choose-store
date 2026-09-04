import * as XLSX from "xlsx";

export type ImportRow=Record<string,unknown>;

export const IMPORT_FIELD_ALIASES:Record<string,string[]>={
  name:["门店名称","报名门店","活动门店","参与门店","渠道门店","门店全称","商户名称","店名","名称","门店"],
  province:["省份","所在省份","所属省份","省"],city:["城市","所在城市","所属城市","地市","市"],district:["区县","所在区县","所属区县","区","县"],
  address:["详细地址","门店地址","活动地址","所在地址","终端地址","具体地址","地址"],code:["门店编号","门店编码","编号","编码"],brand:["门店品牌","渠道品牌","品牌"],remark:["备注","说明","补充信息"],
  poi_id:["高德POI ID","高德POIID","POI ID","POIID","高德编号"],longitude:["经度","longitude","lng","lon"],latitude:["纬度","latitude","lat"],
};

const normalizeHeader=(value:string)=>value.trim().replace(/^\uFEFF/,"").replace(/[\s_*＊:：()（）【】\[\]]/g,"").toLowerCase();
export type ImportFieldDetection={field:string;header:string;score:number;confidence:"高"|"中"|"低";reasons:string[];samples:string[]};
const text=(value:unknown)=>String(value??"").trim();
const ratio=(values:string[],predicate:(value:string)=>boolean)=>values.length?values.filter(predicate).length/values.length:0;
const storePattern=/(?:零食很忙|零食有鸣|赵一鸣|好[想像]来|来伊份|良品铺子|爱零食|老婆大人|来优品|戴永红|糖巢|恰货铺子|门店|店(?:$|[（(]))/;
const addressPattern=/(?:省|市|区|县|镇|乡|街道|大道|大街|公路|路|街|巷|号|小区|广场|商场|购物中心|附近|东门|西门|南门|北门)/;
function contentScore(field:string,values:string[]){
  const nonempty=values.filter(Boolean),average=nonempty.reduce((sum,value)=>sum+value.length,0)/Math.max(1,nonempty.length);
  if(!nonempty.length)return {score:0,reasons:[] as string[]};
  let score=0;const reasons:string[]=[];
  const add=(points:number,reason:string)=>{if(points>0){score+=points;reasons.push(reason)}};
  if(field==="name")add(Math.round(ratio(nonempty,value=>storePattern.test(value))*68),"样例内容具有品牌或门店名称特征");
  if(field==="address"){add(Math.round(ratio(nonempty,value=>addressPattern.test(value))*58),"样例内容具有道路、门牌或地标特征");if(average>=8)add(8,"内容长度符合详细地址特征")}
  if(field==="province")add(Math.round(ratio(nonempty,value=>/^(?:.{2,8})(?:省|自治区|特别行政区|市)$/.test(value))*65),"样例符合省级行政区格式");
  if(field==="city")add(Math.round(ratio(nonempty,value=>/^(?:.{2,10})(?:市|地区|自治州|盟)$/.test(value))*65),"样例符合城市格式");
  if(field==="district")add(Math.round(ratio(nonempty,value=>/^(?:.{2,10})(?:区|县|旗|市)$/.test(value))*58),"样例符合区县格式");
  if(field==="brand")add(Math.round(ratio(nonempty,value=>storePattern.test(value)&&value.length<=12)*55),"样例符合短品牌名称特征");
  if(field==="poi_id")add(Math.round(ratio(nonempty,value=>/^[A-Z][A-Z0-9]{7,}$/.test(value))*75),"样例符合高德POI编号格式");
  if(field==="longitude")add(Math.round(ratio(nonempty,value=>{const number=Number(value);return number>=73&&number<=136})*70),"样例符合中国境内经度范围");
  if(field==="latitude")add(Math.round(ratio(nonempty,value=>{const number=Number(value);return number>=3&&number<=54})*70),"样例符合中国境内纬度范围");
  return {score:Math.min(79,score),reasons};
}

export function analyzeImportMapping(headers:string[],rows:ImportRow[]=[],sampleLimit=10){
  const proposals:ImportFieldDetection[]=[];
  for(const [field,names] of Object.entries(IMPORT_FIELD_ALIASES))for(const header of headers){
    const normalized=normalizeHeader(header),aliases=names.map(normalizeHeader),samples=rows.slice(0,sampleLimit).map(row=>text(row[header])).filter(Boolean),reasons:string[]=[];
    let headerScore=0;
    if(aliases.includes(normalized)){headerScore=100;reasons.push(`表头“${header}”与${names[0]}别名一致`)}
    else if(aliases.some(alias=>normalized.includes(alias)||alias.includes(normalized))){headerScore=68;reasons.push(`表头“${header}”与${names[0]}含义相近`)}
    const content=contentScore(field,samples),combined=headerScore&&content.score?Math.round(headerScore*.78+content.score*.22):0,score=Math.min(100,Math.max(headerScore,content.score,combined));
    if(score>=45)proposals.push({field,header,score,confidence:score>=80?"高":score>=55?"中":"低",reasons:[...reasons,...content.reasons],samples:samples.slice(0,3)});
  }
  const mapping:Record<string,string>={},detections:ImportFieldDetection[]=[],used=new Set<string>();
  for(const proposal of proposals.sort((a,b)=>b.score-a.score||a.field.localeCompare(b.field))){if(mapping[proposal.field]||used.has(proposal.header)||proposal.score<55)continue;mapping[proposal.field]=proposal.header;used.add(proposal.header);detections.push(proposal)}
  const conflicts=proposals.filter(item=>item.score>=55&&mapping[item.field]!==item.header&&used.has(item.header)).map(item=>`“${item.header}”也可能是${IMPORT_FIELD_ALIASES[item.field][0]}，已避免重复映射`);
  return {mapping,detections,conflicts:[...new Set(conflicts)]};
}

export function detectImportMapping(headers:string[],rows:ImportRow[]=[]){
  return analyzeImportMapping(headers,rows).mapping;
}

function cellText(value:unknown){
  if(value==null)return "";
  if(value instanceof Date)return value.toISOString();
  return String(value).trim();
}

export function parseImportRows(buffer:Buffer,filename:string):ImportRow[]{
  try{
    const lowerName=filename.toLowerCase(),isCsv=lowerName.endsWith(".csv");
    if(lowerName.endsWith(".xlsx")&&(buffer[0]!==0x50||buffer[1]!==0x4b))throw new Error("文件内容不是有效的 XLSX 工作簿");
    if(lowerName.endsWith(".xls")&&!(buffer[0]===0xd0&&buffer[1]===0xcf&&buffer[2]===0x11&&buffer[3]===0xe0))throw new Error("文件内容不是有效的 XLS 工作簿");
    const source=isCsv?new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/,""):buffer;
    const workbook=XLSX.read(source,{type:isCsv?"string":"buffer",cellDates:true,raw:false});
    const sheetName=workbook.SheetNames[0],sheet=sheetName?workbook.Sheets[sheetName]:undefined;
    if(!sheet)throw new Error("工作簿中没有可读取的工作表");
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false,blankrows:false});
    if(!matrix.length)return [];
    const headers=(matrix[0]||[]).map(cellText),rows:ImportRow[]=[];
    for(const values of matrix.slice(1)){
      const row:ImportRow={};
      headers.forEach((header,index)=>{if(header)row[header]=values[index]??""});
      if(Object.values(row).some(value=>cellText(value)))rows.push(row);
    }
    return rows;
  }catch(error){
    throw new Error("无法读取该表格，请确认文件未加密、未损坏，并另存为 .xlsx、.xls 或 UTF-8 CSV 后重试。",{cause:error});
  }
}
