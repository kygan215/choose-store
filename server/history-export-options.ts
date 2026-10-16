export type HistoryExportOptions={
  includeHistory:boolean;
  historyStartDate?:string;
  historyEndDate?:string;
};

function validDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function parseHistoryExportOptions(value:unknown):HistoryExportOptions{
  const input=value&&typeof value==="object"?value as Record<string,unknown>:{};
  const includeHistory=input.include_history===true||input.includeHistory===true;
  if(!includeHistory)return {includeHistory:false};
  const start=String(input.history_start_date??input.historyStartDate??"").trim();
  const end=String(input.history_end_date??input.historyEndDate??"").trim();
  if(start&&!validDate(start))throw new Error("历史活动开始日期无效，请使用 YYYY-MM-DD");
  if(end&&!validDate(end))throw new Error("历史活动结束日期无效，请使用 YYYY-MM-DD");
  if(start&&end&&start>end)throw new Error("历史活动开始日期不能晚于结束日期");
  return {includeHistory:true,...(start?{historyStartDate:start}:{}),...(end?{historyEndDate:end}:{})};
}
