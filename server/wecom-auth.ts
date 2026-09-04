import crypto from "node:crypto";
import type Redis from "ioredis";

export type WeComConfig={
  corpId:string;
  agentId:string;
  secret:string;
  callbackUrl:string;
  tenantId:number|null;
};

type WeComResponse={errcode?:number;errmsg?:string;[key:string]:unknown};
export type WeComIdentity={userid:string};
export type WeComMember={userid:string;name:string;email:string;avatar:string};

const apiBase="https://qyapi.weixin.qq.com";

export function readWeComConfig(env:Record<string,string|undefined>=process.env):WeComConfig|null{
  const corpId=String(env.WECOM_CORP_ID||"").trim();
  const agentId=String(env.WECOM_AGENT_ID||"").trim();
  const secret=String(env.WECOM_CORP_SECRET||"").trim();
  const origin=String(env.APP_ORIGIN||"").trim().replace(/\/$/,"");
  const callbackUrl=String(env.WECOM_CALLBACK_URL||"").trim()||(origin?`${origin}/api/auth/wecom/callback`:"");
  const configuredTenant=Number(env.WECOM_TENANT_ID||0);
  if(!corpId||!agentId||!secret||!callbackUrl)return null;
  return {corpId,agentId,secret,callbackUrl,tenantId:Number.isInteger(configuredTenant)&&configuredTenant>0?configuredTenant:null};
}

export function safeNextPath(value:unknown){
  const path=typeof value==="string"?value.trim():"";
  return path.startsWith("/")&&!path.startsWith("//")&&!path.includes("\\")?path:"/";
}

export function buildWeComLoginUrl(config:WeComConfig,state:string,mode:"qr"|"oauth"){
  if(mode==="oauth"){
    const params=new URLSearchParams({appid:config.corpId,redirect_uri:config.callbackUrl,response_type:"code",scope:"snsapi_base",state,agentid:config.agentId});
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
  }
  const params=new URLSearchParams({login_type:"CorpApp",appid:config.corpId,agentid:config.agentId,redirect_uri:config.callbackUrl,state});
  return `https://login.work.weixin.qq.com/wwlogin/sso/login?${params.toString()}`;
}

async function fetchJson(url:string):Promise<WeComResponse>{
  const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error(`企业微信接口暂时不可用（HTTP ${response.status}）`);
  const data=await response.json() as WeComResponse;
  return data;
}

function assertSuccess(data:WeComResponse,operation:string){
  if(Number(data.errcode||0)!==0)throw new Error(`${operation}失败（${Number(data.errcode)}：${String(data.errmsg||"未知错误")}）`);
}

export async function getWeComAccessToken(config:WeComConfig,redis:Redis){
  const cacheKey=`wecom:token:${crypto.createHash("sha256").update(config.corpId).digest("hex").slice(0,20)}`;
  const cached=await redis.get(cacheKey);if(cached)return cached;
  const params=new URLSearchParams({corpid:config.corpId,corpsecret:config.secret});
  const data=await fetchJson(`${apiBase}/cgi-bin/gettoken?${params.toString()}`);assertSuccess(data,"获取企业微信凭证");
  const token=String(data.access_token||"");if(!token)throw new Error("企业微信未返回访问凭证");
  const ttl=Math.max(60,Number(data.expires_in||7200)-300);await redis.set(cacheKey,token,"EX",ttl);return token;
}

export async function getWeComIdentity(accessToken:string,code:string):Promise<WeComIdentity>{
  const params=new URLSearchParams({access_token:accessToken,code});
  const data=await fetchJson(`${apiBase}/cgi-bin/auth/getuserinfo?${params.toString()}`);assertSuccess(data,"验证企业微信身份");
  const userid=String(data.userid||data.UserId||"").trim();
  if(!userid)throw new Error("仅允许当前企业的内部成员登录");
  return {userid};
}

export async function getWeComMember(accessToken:string,userid:string):Promise<WeComMember>{
  const params=new URLSearchParams({access_token:accessToken,userid});
  const data=await fetchJson(`${apiBase}/cgi-bin/user/get?${params.toString()}`);assertSuccess(data,"读取企业微信成员信息");
  const resolvedId=String(data.userid||data.UserId||userid).trim();
  const name=String(data.name||resolvedId).trim();
  const email=String(data.biz_mail||data.email||"").trim().toLowerCase();
  const avatar=String(data.avatar||data.thumb_avatar||"").trim();
  return {userid:resolvedId,name,email,avatar};
}

export function createWeComState(){return crypto.randomBytes(32).toString("base64url")}
