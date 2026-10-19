export class ApiProblem extends Error{
  details:unknown;
  status:number;code:string;requestId:string;
  constructor(message:string,details:unknown,meta:{status?:number;code?:string;requestId?:string}={}){super(message);this.details=details;this.status=meta.status||0;this.code=meta.code||"REQUEST_FAILED";this.requestId=meta.requestId||""}
}

export async function callHistory<T>(api:string,path:string,init?:RequestInit&{timeoutMs?:number}):Promise<T>{
  const headers=new Headers(init?.headers);
  if(init?.body&&!(init.body instanceof FormData))headers.set("Content-Type","application/json");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),init?.timeoutMs??(path.includes("amap-candidates")?120000:30000));
  const abort=()=>controller.abort();init?.signal?.addEventListener("abort",abort,{once:true});if(init?.signal?.aborted)controller.abort();
  try{const response=await fetch(`${api}${path}`,{...init,headers,signal:controller.signal});
   let body:{success?:boolean;message?:string;data?:T;error?:{code?:string;message?:string}};
   const requestId=response.headers.get("X-Request-ID")||"";
   try{body=await response.json()}catch{throw new ApiProblem(`服务返回的数据无法读取（${response.status}），请稍后重试`,null,{status:response.status,code:"INVALID_RESPONSE",requestId})}
   if(!response.ok||!body.success)throw new ApiProblem(body.message||body.error?.message||`请求失败（${response.status}）`,body.data,{status:response.status,code:body.error?.code,requestId});
   return body.data as T;
  }catch(error){if(controller.signal.aborted&&!init?.signal?.aborted)throw new ApiProblem("请求超时，请刷新关联状态后重试",null,{code:"REQUEST_TIMEOUT"});if(error instanceof TypeError&&/fetch|network|load failed/i.test(error.message))throw new ApiProblem("网络连接中断，请先刷新关联状态，再重试操作",null,{code:"NETWORK_ERROR"});throw error}
  finally{clearTimeout(timer);init?.signal?.removeEventListener("abort",abort)}
}

export const errorText=(error:unknown)=>error instanceof ApiProblem&&error.requestId&&error.status>=500?`${error.message}（请求编号：${error.requestId}）`:error instanceof Error?error.message:"操作失败，请稍后重试";
export function historyProblemDetails(error:unknown){
 if(!(error instanceof ApiProblem)||!error.details||typeof error.details!=="object")return [];
 const details=error.details as {issues?:Array<{reason?:string;store_name?:string}>;store_conflicts?:Array<{reason?:string}>};
 return [...(details.issues||[]).map(r=>`${r.store_name?r.store_name+"：":""}${r.reason||"关联信息需核对"}`),...(details.store_conflicts||[]).map(r=>r.reason||"存在重复活动")];
}
