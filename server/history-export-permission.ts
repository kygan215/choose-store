import {query} from "./db.js";
import {canAccessHistory} from "./history-export-data.js";

/** Queued exports recheck permissions when generated, not only when requested. */
export async function assertHistoryExportPermission(tenantId:number,userId:number){
  const user=(await query<{role:"admin"|"member"}>("SELECT role FROM users WHERE id=$1 AND tenant_id=$2 AND active=TRUE",[userId,tenantId])).rows[0];
  if(!user||!await canAccessHistory(tenantId,userId,user.role,"export"))throw new Error("历史销售数据导出权限已失效");
}
