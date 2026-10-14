type ReviewRow={amap_name:string;name_decision:string;name_decision_reason:string};
export type BrandReviewResult={accepted:number;excluded:number;pending:number;rows?:ReviewRow[];blocked?:ReviewRow[]};
export function brandReviewFeedback(action:"accept"|"exclude"|"reset",result:BrandReviewResult){
 const counts=`已接受 ${result.accepted} 家，已排除 ${result.excluded} 家，仍待核验 ${result.pending} 家。`;
 if(action==="reset")return `已恢复自动判断：${counts}`;
 if(action==="exclude")return `人工排除已保存：${counts}`;
 const blocked=result.blocked||result.rows?.filter(row=>row.name_decision!=="接受")||[];
 const reason=blocked[0]?.name_decision_reason;
 return `${result.accepted?"人工纳入已生效":"人工核验已保存，当前仍未纳入"}：${counts}${reason?` 未纳入原因：${reason}。`:""}`;
}
