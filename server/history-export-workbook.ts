import ExcelJS from "exceljs";

export type HistoricalExportSummary={activity_count:number;latest_activity_start:string|null;sales_amount:string|null;known_amount_count:number;missing_amount_count:number};
export type HistoricalExportDetail={
  brand_store_id:number;history_store_id:number;activity_id:number;
  brand_name:string;store_name:string;province:string;city:string;address?:string;
  start_date:string;end_date:string;activity_name:string;sales_amount:string|null;
  refund_basis:string;calendar_tags:string[];
  source_import_id?:number|null;source_sheet?:string|null;source_cell?:string|null;
};

export const HISTORY_SUMMARY_HEADERS=["历史活动次数","最近活动开始日","活动商品原始上报销售额（元）","销售额缺失场次","退款口径","历史数据状态"] as const;

function safeText(value:unknown){const text=String(value??"");return /^[=+\-@]/.test(text)?`'${text}`:text}
function money(value:string|null){if(value==null)return "";const number=Number(value);return Number.isFinite(number)?number:""}
export function refundBasisLabel(value:string){return value==="refunded"?"已扣退款":value==="not_refunded"?"未扣退款":"未知"}
export function historyRefundBasisByStore(details:HistoricalExportDetail[]){
  const result=new Map<number,string[]>();
  for(const detail of details){const id=Number(detail.brand_store_id),labels=result.get(id)||[],label=refundBasisLabel(detail.refund_basis);if(!labels.includes(label))labels.push(label);result.set(id,labels)}
  return result;
}

/** An absent summary is unknown/no activity, never the numeric zero-sale result. */
export function historySummaryCells(summary:HistoricalExportSummary|undefined,matched:boolean,hasDateRange=false,refundBasis:string[]=[]){
  if(!matched)return ["","","","","","历史数据未匹配"] as const;
  if(!summary)return ["","","","","",hasDateRange?"所选期间无已关联历史活动":"未找到已关联历史活动"] as const;
  const missing=Number(summary.missing_amount_count||0);
  const status=missing?summary.sales_amount==null?"已匹配（销售额缺失）":"已匹配（有缺失金额，合计仅含已填金额）":"已匹配";
  const basis=refundBasis.length>1?`口径混合：${refundBasis.join("、")}`:refundBasis[0]||"未知";
  return [Number(summary.activity_count),safeText(summary.latest_activity_start||""),money(summary.sales_amount),missing,safeText(basis),status] as const;
}

export function addHistoricalDetailSheet(workbook:ExcelJS.Workbook,details:HistoricalExportDetail[]){
  const sheet=workbook.addWorksheet("历史活动明细");
  const headers=["当前品牌库门店ID","历史门店档案ID","活动记录ID","活动时品牌","活动时门店名称","活动时省份","活动时城市","活动时地址","活动名称","活动开始日","活动结束日","活动商品原始上报销售额（元）","退款口径","日期标签","来源导入ID","来源工作表","来源单元格"];
  sheet.addRow(headers);
  for(const item of details)sheet.addRow([
    item.brand_store_id,item.history_store_id,item.activity_id,
    safeText(item.brand_name),safeText(item.store_name),safeText(item.province),safeText(item.city),safeText(item.address),
    safeText(item.activity_name),safeText(item.start_date),safeText(item.end_date),money(item.sales_amount),
    refundBasisLabel(item.refund_basis),safeText((item.calendar_tags||[]).join("、")),item.source_import_id??"",safeText(item.source_sheet),safeText(item.source_cell),
  ]);
  sheet.views=[{state:"frozen",ySplit:1}];
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};
  const header=sheet.getRow(1);header.height=25;header.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF08745B"}};cell.alignment={vertical:"middle",wrapText:true}});
  sheet.columns=headers.map((_,index)=>({width:[4,7,8,9,13].includes(index)?30:18}));
  return sheet;
}
