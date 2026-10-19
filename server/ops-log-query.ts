export function logFilters(input:Record<string,unknown>,tenantId:number){
  const values:unknown[]=[tenantId];const clauses=["(tenant_id=$1 OR tenant_id IS NULL)"];
  const add=(sql:string,value:unknown)=>{values.push(value);clauses.push(sql.replace("?",`$${values.length}`))};
  const now=Date.now(),parse=(v:unknown,fallback:number)=>Number.isFinite(Date.parse(String(v)))?Date.parse(String(v)):fallback;
  const from=Math.max(now-30*86400000,parse(input.from,now-86400000)),to=parse(input.to,now);
  add("created_at>=?",new Date(from).toISOString());add("created_at<=?",new Date(to).toISOString());
  for(const field of ["service","level","module","task_type","task_id","request_id"]){if(input[field])add(`${field}=?`,String(input[field]).slice(0,100))}
  if(input.q)add("(message || ' ' || details_json::text) ILIKE ?",`%${String(input.q).slice(0,100).replace(/[\\%_]/g,"\\$&")}%`);
  if(input.cursor){const [at,id]=String(input.cursor).split("|");if(Number.isFinite(Date.parse(at))&&id){values.push(at,id.slice(0,100));clauses.push(`(created_at,id)<($${values.length-1}::timestamptz,$${values.length})`)}}
  return {where:clauses.join(" AND "),values};
}
