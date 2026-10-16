import {query} from "./db.js";
import type {AuthUser} from "./auth.js";

export async function canAccessHistory(tenantId:number,userId:number,role:AuthUser["role"],kind:"view"|"export"){
  if(role==="admin")return true;
  const row=(await query<{can_view:boolean;can_export:boolean}>("SELECT can_view,can_export FROM history_permissions WHERE tenant_id=$1 AND user_id=$2",[tenantId,userId])).rows[0];
  return kind==="view"?Boolean(row?.can_view):Boolean(row?.can_view&&row?.can_export);
}
export type HistorySummary={activity_count:number;latest_activity_start:string|null;sales_amount:string|null;known_amount_count:number;missing_amount_count:number;refund_basis_values:string[]};
export type HistoryDetail={brand_store_id:number;history_store_id:number;activity_id:number;brand_name:string;store_name:string;province:string;city:string;address:string;start_date:string;end_date:string;activity_name:string;sales_amount:string|null;refund_basis:string;calendar_tags:string[];source_import_id:number|null;source_sheet:string|null;source_cell:string|null};
export async function getHistoricalExportData(tenantId:number,brandStoreIds:number[],startDate?:string,endDate?:string):Promise<{summaries:Map<number,HistorySummary>;details:HistoryDetail[]}>{
  const ids=[...new Set(brandStoreIds.filter(Number.isSafeInteger).filter(n=>n>0))];
  if(!ids.length)return {summaries:new Map(),details:[]};
  const rows=(await query<{brand_store_id:number;history_store_id:number;activity_id:number;brand_name:string;store_name:string;province:string;city:string;address:string;start_date:string;end_date:string;activity_name:string;sales_amount:string|null;refund_basis:string;calendar_tags:string[];source_import_id:number|null;source_sheet:string|null;source_cell:string|null}>(
    `SELECT hs.brand_store_id,hs.id history_store_id,a.id activity_id,a.brand_name,a.store_name,a.province,a.city,a.address,a.start_date::text,a.end_date::text,a.activity_name,a.sales_amount::text,a.refund_basis,a.calendar_tags,a.source_import_id,a.source_sheet,a.source_cell
     FROM history_activities a JOIN history_stores hs ON hs.id=a.history_store_id AND hs.tenant_id=a.tenant_id
     WHERE a.tenant_id=$1 AND hs.brand_store_id=ANY($2::bigint[]) AND a.revoked_at IS NULL
       AND ($3::date IS NULL OR a.start_date >= $3::date) AND ($4::date IS NULL OR a.start_date <= $4::date)
     ORDER BY hs.brand_store_id,a.start_date,a.id`,[tenantId,ids,startDate||null,endDate||null])).rows;
  const summaries=new Map<number,HistorySummary>();
  const cents=(v:string)=>{const [whole,fraction=""]=v.split(".");return BigInt(whole)*BigInt(100)+BigInt((fraction+"00").slice(0,2))};
  const decimal=(v:bigint)=>`${v/BigInt(100)}.${String(v%BigInt(100)).padStart(2,"0")}`;
  for(const row of rows){const id=Number(row.brand_store_id),existing=summaries.get(id)||{activity_count:0,latest_activity_start:null,sales_amount:null,known_amount_count:0,missing_amount_count:0,refund_basis_values:[]};existing.activity_count++;if(!existing.latest_activity_start||existing.latest_activity_start<row.start_date)existing.latest_activity_start=row.start_date;if(row.sales_amount===null)existing.missing_amount_count++;else{existing.known_amount_count++;existing.sales_amount=decimal(cents(existing.sales_amount||"0.00")+cents(row.sales_amount))}if(!existing.refund_basis_values.includes(row.refund_basis))existing.refund_basis_values.push(row.refund_basis);summaries.set(id,existing)}
  return {summaries,details:rows.map(row=>({...row,brand_store_id:Number(row.brand_store_id),history_store_id:Number(row.history_store_id),activity_id:Number(row.activity_id),source_import_id:row.source_import_id==null?null:Number(row.source_import_id)}))};
}
