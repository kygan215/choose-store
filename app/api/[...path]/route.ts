import { env } from "cloudflare:workers";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import { callDeepSeek, type AggregateStore } from "../deepseek";
import { searchStoreCandidates, type StoreCandidate } from "../../../server/store-search.js";

export const runtime = "edge";

type Row = Record<string, unknown>;
type D1Statement = { bind: (...values: unknown[]) => D1Statement; run: () => Promise<{meta?:{last_row_id?:number}}> ; first: <T=Row>() => Promise<T|null>; all: <T=Row>() => Promise<{results:T[]}> };
type D1 = { prepare: (sql:string) => D1Statement; batch: (statements:D1Statement[]) => Promise<unknown> };
type RuntimeEnv = { DB:D1; AMAP_WEB_SERVICE_KEY?:string; AMAP_REQUEST_INTERVAL_MS?:string; DEEPSEEK_API_KEY?:string; DEEPSEEK_API_BASE_URL?:string; DEEPSEEK_MODEL?:string; ADMIN_EMAIL?:string; ADMIN_PASSWORD?:string; ADMIN_NAME?:string; SESSION_HOURS?:string };
type Candidate = StoreCandidate;
type Poi = {id:string;name:string;category:string;type:string;typecode:string;address:string;distance:number;location:[number,number];distance_bucket:string};
type CloudUser = {id:number;email:string;display_name:string;role:"admin"|"member"};

const runtimeEnv = env as unknown as RuntimeEnv;
const CATEGORY_TYPES:Record<string,string> = {
  "住宅小区":"120302","幼儿园":"141204","小学":"141203","中学":"141202","购物中心":"060101","超市":"060400",
  "便利店":"060200","医院":"090100","药店":"090601","公园":"110101","地铁站":"150500","公交站":"150700",
};
const FIELD_ALIASES:Record<string,string[]> = {
  name:["门店名称","店名","名称","门店"],province:["省份","省"],city:["城市","市"],district:["区县","区","县"],
  address:["详细地址","地址","门店地址"],code:["门店编号","编号","编码"],brand:["品牌"],remark:["备注"],
};
let lastAmapRequestAt = 0;
let limiter = Promise.resolve();

function json(data:unknown,status=200,message="操作成功",headers?:HeadersInit) { return Response.json({success:status<400,data:status<400?data:null,message,...(status>=400?{error:data}:{})},{status,headers}); }
function fail(message:string,status=400,code="REQUEST_ERROR",headers?:HeadersInit) { return Response.json({success:false,data:null,message,error:{code,message}},{status,headers}); }
function now(){return new Date().toISOString()}
function parseJson<T>(value:unknown,fallback:T):T { try{return value?JSON.parse(String(value)) as T:fallback}catch{return fallback} }
function clean(value:unknown){return String(value??"").trim()}
function normalize(value:string){return value.toLowerCase().replace(/[\s（）()·\-_]/g,"").replace(/分店|门店|店$/g,"")}
function distanceBucket(distance:number,radii:number[]){const sorted=[...radii].sort((a,b)=>a-b);const hit=sorted.find(radius=>distance<=radius);return hit?`≤${hit}米`:`>${sorted.at(-1)??500}米`}
function haversine(a:[number,number],b:[number,number]){const r=6371000,toRad=(n:number)=>n*Math.PI/180;const dLat=toRad(b[1]-a[1]),dLng=toRad(b[0]-a[0]);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dLng/2)**2;return Math.round(2*r*Math.asin(Math.sqrt(x)))}

async function ensureDb(){
  await runtimeEnv.DB.batch([
    runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)"),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)"),
    runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT NOT NULL DEFAULT '等待开始匹配', total_stores INTEGER NOT NULL DEFAULT 0, processed_stores INTEGER NOT NULL DEFAULT 0, matched_stores INTEGER NOT NULL DEFAULT 0, success_stores INTEGER NOT NULL DEFAULT 0, failed_stores INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL DEFAULT '{}', stage TEXT NOT NULL DEFAULT 'match', control TEXT NOT NULL DEFAULT 'idle', current_store TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE, input_name TEXT NOT NULL, standard_name TEXT, amap_poi_id TEXT, longitude REAL, latitude REAL, province TEXT DEFAULT '', city TEXT DEFAULT '', district TEXT DEFAULT '', address TEXT DEFAULT '', user_code TEXT, brand TEXT, match_score REAL, match_status TEXT DEFAULT '', status TEXT NOT NULL DEFAULT '等待匹配', error_message TEXT, pois_json TEXT NOT NULL DEFAULT '[]', analysis_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)"),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stores_job_id ON stores(job_id)"),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status)"),
    runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_analyses (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE, store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE, store_ids_json TEXT NOT NULL DEFAULT '[]', input_json TEXT NOT NULL, result_json TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_analyses_store_created ON ai_analyses(store_id,created_at)"),
    runtimeEnv.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_analyses_job_scope_created ON ai_analyses(job_id,scope,created_at)"),
  ]);
}


const SESSION_COOKIE="storemap_session";
const sessionHours=()=>Math.max(1,Math.min(168,Number(runtimeEnv.SESSION_HOURS||12)));
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
function randomToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function cookieValue(request:Request,name:string){const raw=request.headers.get("cookie")||"";for(const item of raw.split(";")){const [key,...parts]=item.trim().split("=");if(key===name)return decodeURIComponent(parts.join("="))}return ""}
function sessionCookie(token:string,maxAge:number){return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
function clearSessionCookie(){return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}
function publicUser(user:CloudUser){return {id:Number(user.id),tenantId:1,email:user.email,displayName:user.display_name,display_name:user.display_name,role:user.role}}

async function ensureAdmin(){
  const email=clean(runtimeEnv.ADMIN_EMAIL).toLowerCase(),password=String(runtimeEnv.ADMIN_PASSWORD||""),displayName=clean(runtimeEnv.ADMIN_NAME)||"系统管理员";
  if(!email||password.length<10)throw new Error("线上管理员账号尚未配置");
  const existing=await runtimeEnv.DB.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(email).first<Row>();if(existing)return;
  const stamp=now(),passwordHash=await bcrypt.hash(password,10);await runtimeEnv.DB.prepare("INSERT INTO users(email,display_name,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,'admin',1,?,?)").bind(email,displayName,passwordHash,stamp,stamp).run();
}

async function currentUser(request:Request):Promise<CloudUser|null>{
  const token=cookieValue(request,SESSION_COOKIE);if(!token)return null;const tokenHash=await sha256(token),user=await runtimeEnv.DB.prepare("SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 LIMIT 1").bind(tokenHash,now()).first<CloudUser>();if(!user)return null;
  await runtimeEnv.DB.prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?").bind(now(),tokenHash).run();return user;
}

async function login(request:Request){
  await ensureAdmin();const body=await bodyJson(request),email=clean(body.email).toLowerCase(),password=String(body.password||""),user=await runtimeEnv.DB.prepare("SELECT id,email,display_name,password_hash,role,active FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(email).first<Row>();
  if(!user||!user.active||!await bcrypt.compare(password,String(user.password_hash||"")))return fail("邮箱或密码错误",401,"AUTH_INVALID");
  const token=randomToken(),tokenHash=await sha256(token),stamp=now(),maxAge=sessionHours()*3600,expires=new Date(Date.now()+maxAge*1000).toISOString();await runtimeEnv.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(stamp).run();await runtimeEnv.DB.prepare("INSERT INTO sessions(user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)").bind(user.id,tokenHash,expires,stamp,stamp).run();
  return json(publicUser(user as unknown as CloudUser),200,"登录成功",{"Set-Cookie":sessionCookie(token,maxAge)});
}

async function logout(request:Request){const token=cookieValue(request,SESSION_COOKIE);if(token)await runtimeEnv.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();return json({},200,"已退出登录",{"Set-Cookie":clearSessionCookie()})}

async function changePassword(request:Request,user:CloudUser){
  const body=await bodyJson(request),current=String(body.current_password||""),next=String(body.new_password||"");if(next.length<12)return fail("新密码至少 12 位");const saved=await runtimeEnv.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.id).first<Row>();if(!saved||!await bcrypt.compare(current,String(saved.password_hash||"")))return fail("当前密码错误",401);
  const passwordHash=await bcrypt.hash(next,10);await runtimeEnv.DB.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(passwordHash,now(),user.id).run();await runtimeEnv.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id).run();return json({},200,"密码已修改，请重新登录",{"Set-Cookie":clearSessionCookie()});
}

async function amap(path:string,params:Record<string,string|number|boolean>){
  const key=runtimeEnv.AMAP_WEB_SERVICE_KEY;
  if(!key) throw new Error("线上高德 Web Service Key 尚未配置");
  const interval=Math.max(400,Number(runtimeEnv.AMAP_REQUEST_INTERVAL_MS||400));
  for(let attempt=0;attempt<3;attempt++){
    let release:()=>void=()=>{};
    const previous=limiter;limiter=new Promise<void>(resolve=>{release=resolve});await previous;
    const wait=interval-(Date.now()-lastAmapRequestAt);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastAmapRequestAt=Date.now();release();
    const url=new URL(`https://restapi.amap.com${path}`);Object.entries({...params,key}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    const response=await fetch(url);const data=await response.json() as Row;
    if(String(data.status)==="1")return data;
    const info=clean(data.info),infocode=clean(data.infocode);
    if(["10014","10015","10019","10020","10021","10022","10023"].includes(infocode)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1200));continue}
    throw new Error(infocode==="10003"?"高德地图当月调用额度已用完":`高德地图服务不可用：${info||infocode}`);
  }
  throw new Error("高德地图请求失败");
}

function parseLocation(value:unknown):[number,number]|null{const parts=clean(value).split(",").map(Number);return parts.length>=2&&parts.every(Number.isFinite)?[parts[0],parts[1]]:null}
async function searchCandidates(input:string,city="",district="",address=""){
  return searchStoreCandidates(amap,input,city,district,address);
}

async function geocode(body:Row){
  const address=[body.province,body.city,body.district,body.address||body.name].map(clean).join("");
  const data=await amap("/v3/geocode/geo",{address,city:clean(body.city)});const geocodes=Array.isArray(data.geocodes)?data.geocodes as Row[]:[];
  return geocodes.map((item,index)=>{const location=parseLocation(item.location);return location?{id:`geo-${index}`,name:clean(body.name)||clean(item.formatted_address),formatted_address:clean(item.formatted_address),address:clean(item.formatted_address),province:clean(item.province),city:clean(item.city)||clean(body.city),district:clean(item.district),adcode:clean(item.adcode),location,type:"地址定位",typecode:"",score:70,status:"地址候选",reasons:["根据详细地址完成地理编码"],source:"amap_geocode"}:null}).filter(Boolean);
}

function mapHeaders(headers:string[]){const mapping:Record<string,string>={};for(const [field,aliases] of Object.entries(FIELD_ALIASES)){const found=headers.find(header=>aliases.some(alias=>normalize(header)===normalize(alias)));if(found)mapping[field]=found}return mapping}
async function parseUpload(request:Request){
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File))throw new Error("请选择 Excel 或 CSV 文件");
  const buffer=await file.arrayBuffer();let rows:Row[]=[];
  if(file.name.toLowerCase().endsWith(".csv")){const text=new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/,"");const workbook=XLSX.read(text,{type:"string"});rows=XLSX.utils.sheet_to_json<Row>(workbook.Sheets[workbook.SheetNames[0]],{defval:""})}
  else {const workbook=XLSX.read(buffer,{type:"array"});rows=XLSX.utils.sheet_to_json<Row>(workbook.Sheets[workbook.SheetNames[0]],{defval:""})}
  const headers=rows.length?Object.keys(rows[0]):[];const mapping=mapHeaders(headers);const seen=new Set<string>();let duplicates=0;
  const selectable=rows.slice(0,5000).map((row,index)=>{const name=clean(row[mapping.name]),address=clean(row[mapping.address]);const issues:string[]=[];if(!name&&!address)issues.push("缺少门店名称或详细地址");const key=normalize(`${name}|${address}`);if(key&&seen.has(key)){issues.push("重复门店");duplicates++}if(key)seen.add(key);return {...row,_row_number:index+2,_valid:issues.length===0,_issues:issues}});
  const valid=selectable.filter(row=>row._valid);
  return {filename:file.name,file_size:file.size,headers,mapping,rows:selectable.slice(0,100),all_rows:rows,selectable_rows:selectable,total_rows:rows.length,valid_rows:valid.length,invalid_rows:selectable.length-valid.length,duplicate_rows:duplicates,warnings:rows.length>5000?["仅处理前 5000 行"]:[]};
}

function serializeJob(row:Row){const config=parseJson<Record<string,unknown>>(row.config_json,{});const total=Number(row.total_stores||0),stage=clean(row.stage)||"match",processed=Number(row.processed_stores||0);return {id:Number(row.id),filename:row.filename,status:row.status,total_stores:total,processed_stores:processed,matched_stores:Number(row.matched_stores||0),pending_stores:Math.max(0,total-processed),success_stores:Number(row.success_stores||0),failed_stores:Number(row.failed_stores||0),truncated:false,config,stage,control:row.control||"idle",stage_total:stage==="analysis"?Number(row.matched_stores||total):total,stage_processed:processed,progress_percent:Math.round(processed/Math.max(1,stage==="analysis"?Number(row.matched_stores||total):total)*100),current_store:row.current_store||"",created_at:row.created_at,updated_at:row.updated_at};}
function serializeStore(row:Row){return {id:Number(row.id),input_name:row.input_name,standard_name:row.standard_name,amap_poi_id:row.amap_poi_id,longitude:row.longitude==null?null:Number(row.longitude),latitude:row.latitude==null?null:Number(row.latitude),province:row.province||"",city:row.city||"",district:row.district||"",address:row.address||"",match_score:row.match_score==null?null:Number(row.match_score),match_status:row.match_status||"",location_source:row.amap_poi_id?"高德POI":"待定位"};}

async function refreshJob(jobId:number,stage:"match"|"analysis"){
  const {results}=await runtimeEnv.DB.prepare("SELECT status FROM stores WHERE job_id=?").bind(jobId).all<Row>();const total=results.length;
  if(stage==="match"){
    const processed=results.filter(row=>row.status!=="等待匹配").length,matched=results.filter(row=>["已确认","分析完成","分析失败"].includes(clean(row.status))).length,failed=results.filter(row=>row.status==="匹配失败").length;
    await runtimeEnv.DB.prepare("UPDATE jobs SET processed_stores=?, matched_stores=?, failed_stores=?, updated_at=? WHERE id=?").bind(processed,matched,failed,now(),jobId).run();return {processed,matched,failed,total};
  }
  const processed=results.filter(row=>["分析完成","分析失败"].includes(clean(row.status))).length,success=results.filter(row=>row.status==="分析完成").length,failed=results.filter(row=>["匹配失败","分析失败"].includes(clean(row.status))).length;
  await runtimeEnv.DB.prepare("UPDATE jobs SET processed_stores=?, success_stores=?, failed_stores=?, updated_at=? WHERE id=?").bind(processed,success,failed,now(),jobId).run();return {processed,success,failed,total};
}

async function runMatching(jobId:number){
  await runtimeEnv.DB.prepare("UPDATE jobs SET status='正在匹配门店',stage='match',control='run',processed_stores=0,current_store='',updated_at=? WHERE id=?").bind(now(),jobId).run();
  const {results}=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE job_id=? AND status IN ('等待匹配','匹配失败') ORDER BY id").bind(jobId).all<Row>();
  for(const store of results){
    const job=await runtimeEnv.DB.prepare("SELECT control FROM jobs WHERE id=?").bind(jobId).first<Row>();if(job?.control!=="run")break;
    await runtimeEnv.DB.prepare("UPDATE jobs SET current_store=?,updated_at=? WHERE id=?").bind(store.input_name,now(),jobId).run();
    try{const candidates=await searchCandidates(clean(store.input_name),clean(store.city),clean(store.district),clean(store.address));const top=candidates.find(candidate=>candidate.auto_confirm);if(!top)throw new Error(candidates.length?"候选门店置信度不足，需要人工确认":"高德未返回有效候选");
      await runtimeEnv.DB.prepare("UPDATE stores SET standard_name=?,amap_poi_id=?,longitude=?,latitude=?,province=?,city=?,district=?,address=?,match_score=?,match_status=?,status='已确认',error_message=NULL,updated_at=? WHERE id=?").bind(top.name,top.id,top.location[0],top.location[1],top.province||store.province,top.city||store.city,top.district||store.district,top.address||store.address,top.score,top.status,now(),store.id).run();
    }catch(error){await runtimeEnv.DB.prepare("UPDATE stores SET status='匹配失败',error_message=?,updated_at=? WHERE id=?").bind(error instanceof Error?error.message:"匹配失败",now(),store.id).run()}
    await refreshJob(jobId,"match");
  }
  const counts=await refreshJob(jobId,"match");const state=await runtimeEnv.DB.prepare("SELECT control FROM jobs WHERE id=?").bind(jobId).first<Row>();
  if(state?.control==="run")await runtimeEnv.DB.prepare("UPDATE jobs SET status=?,control='idle',current_store='',updated_at=? WHERE id=?").bind(counts.failed?"匹配部分失败":"匹配完成",now(),jobId).run();
}

async function searchPois(store:Row,categories:string[],radii:number[]){const maxRadius=Math.max(...radii),origin:[number,number]=[Number(store.longitude),Number(store.latitude)],items:Poi[]=[];for(const category of categories){const types=CATEGORY_TYPES[category]||"";const params:Record<string,string|number|boolean>={location:origin.join(","),radius:maxRadius,sortrule:"distance",page_size:25,page_num:1,show_fields:"business,navi"};if(types)params.types=types;else params.keywords=category==="竞品门店"?"零食很忙|赵一鸣零食|来伊份|良品铺子":category;const data=await amap("/v5/place/around",params);for(const raw of (Array.isArray(data.pois)?data.pois as Row[]:[])){const location=parseLocation(raw.location);if(!location)continue;const distance=Number(raw.distance)||haversine(origin,location);items.push({id:clean(raw.id),name:clean(raw.name),category,type:clean(raw.type),typecode:clean(raw.typecode),address:clean(raw.address),distance,location,distance_bucket:distanceBucket(distance,radii)})}}
  const unique=new Map<string,Poi>();for(const item of items){const key=item.id||`${item.name}|${item.location.join(",")}`;if(!unique.has(key))unique.set(key,item)}return [...unique.values()].sort((a,b)=>a.distance-b.distance)}

function createAnalysis(store:Row,pois:Poi[],radii:number[]){
  const counts:Record<string,number>={};for(const poi of pois)counts[poi.category]=(counts[poi.category]||0)+1;
  const residential=counts["住宅小区"]||0,education=(counts["幼儿园"]||0)+(counts["小学"]||0),commercial=(counts["购物中心"]||0)+(counts["超市"]||0)+(counts["便利店"]||0),traffic=(counts["地铁站"]||0)+(counts["公交站"]||0),competitors=counts["竞品门店"]||0;
  const total=pois.length,levelScore=Math.min(100,Math.round(total*2.2+commercial*3+traffic*2)),fitScore=Math.min(100,Math.round(residential*5+education*6+commercial*3+traffic*2-Math.min(20,competitors*4)));
  const type=education>=Math.max(commercial,traffic)?"社区家庭型":commercial>=education?"商业消费型":traffic>2?"交通通勤型":"综合生活型";
  const ageSegments=[{label:"学生与青少年",age_range:"6–18岁",index:Math.min(100,education*16),basis:`教育设施 ${education} 个`},{label:"青年与年轻家庭",age_range:"19–35岁",index:Math.min(100,35+commercial*7+traffic*5),basis:`商业设施 ${commercial} 个、交通设施 ${traffic} 个`},{label:"家庭消费人群",age_range:"30–45岁",index:Math.min(100,30+residential*10+education*5),basis:`住宅小区 ${residential} 个`},{label:"中老年常住人群",age_range:"46岁以上",index:Math.min(100,20+residential*7),basis:`住宅设施 ${residential} 个`}].sort((a,b)=>b.index-a.index);
  const consumptionIndex=Math.min(100,Math.round(35+commercial*7+traffic*3));const created=now();
  return {id:Number(store.id),analysis_version:"cloud-v1",radius_config:radii,confidence_level:total>=15?"中":total>=5?"较低":"低",business_area:{name:clean(store.district)||clean(store.city)||"门店周边",source:"高德POI代理判断",confidence:total>=15?"中":"低"},business_district_type:{type,scores:{社区:residential*10+education*6,商业:commercial*10,交通:traffic*12},confidence:total>=15?"中":"低"},level:{level:levelScore>=70?"成熟":levelScore>=45?"成长":"基础",score:levelScore,mode:"POI代理评分"},fit:{score:fitScore,level:fitScore>=70?"较高":fitScore>=45?"中等":"较低"},competition:{score:Math.min(100,competitors*18),level:competitors>=4?"较高":competitors>=2?"中等":"较低"},feature_vector:{layers:{"500m":{total,density:total,counts,nearest:{}}},level_indicators:{poi_total:total},fit_components:{residential,education,commercial,traffic}},audience_profile:{method:"基于周边设施结构的代理推断",confidence:total>=15?"中":"低",primary_groups:ageSegments.slice(0,2),age_segments:ageSegments,consumption_power:{level:consumptionIndex>=70?"中高":consumptionIndex>=45?"中等":"偏基础",index:consumptionIndex,confidence:total>=15?"中":"低",basis:`商业 ${commercial} 个、交通 ${traffic} 个；不等同于真实收入统计`},mall_profile:{level:(counts["购物中心"]||0)>=2?"区域商业较集中":(counts["购物中心"]||0)?"存在商场辐射":"社区商业为主",confidence:"低",sample_count:counts["购物中心"]||0,sample_names:pois.filter(p=>p.category==="购物中心").slice(0,5).map(p=>p.name),basis:"依据购物中心POI数量和名称推断，不代表官方商场评级"},summary:[`周边更可能以${ageSegments[0].label}和${ageSegments[1].label}为主要潜在人群。`,`消费环境代理指数 ${consumptionIndex}/100。`],evidence:[`共获取 ${total} 个有效 POI`,`住宅 ${residential} 个、教育 ${education} 个、商业 ${commercial} 个、交通 ${traffic} 个`],limitations:["结果是POI环境代理推断，不是人口普查、客流或收入数据。","高德POI可能存在更新延迟和分类偏差。"]},strengths:[total>=15?"周边设施样本较充足":"已形成基础设施样本"],weaknesses:[total<15?"POI样本较少，画像可信度有限":"缺少真实订单和会员数据"],warning_messages:["请勿将画像直接解释为实际人口比例或消费收入"],disclaimer:"本分析仅反映高德POI设施分布及其代理推断，不等同于人口、客流、消费能力或销售预测。",created_at:created,poi_summary:{total,by_category:counts,by_distance:Object.fromEntries(radii.map(radius=>[`≤${radius}米`,pois.filter(p=>p.distance<=radius).length]))}};
}

async function runAnalysis(jobId:number){
  const job=await runtimeEnv.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<Row>();if(!job)return;const config=parseJson<{categories?:string[];radii?:number[]}>(job.config_json,{}),categories=config.categories?.length?config.categories:["住宅小区","幼儿园","小学"],radii=config.radii?.length?config.radii:[500];
  await runtimeEnv.DB.prepare("UPDATE jobs SET status='正在完整分析',stage='analysis',control='run',processed_stores=0,success_stores=0,current_store='',updated_at=? WHERE id=?").bind(now(),jobId).run();
  const {results}=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE job_id=? AND longitude IS NOT NULL AND status IN ('已确认','分析失败','分析完成') ORDER BY id").bind(jobId).all<Row>();
  for(const store of results){const state=await runtimeEnv.DB.prepare("SELECT control FROM jobs WHERE id=?").bind(jobId).first<Row>();if(state?.control!=="run")break;await runtimeEnv.DB.prepare("UPDATE jobs SET current_store=?,updated_at=? WHERE id=?").bind(store.input_name,now(),jobId).run();try{const pois=await searchPois(store,categories,radii);const analysis=createAnalysis(store,pois,radii);await runtimeEnv.DB.prepare("UPDATE stores SET pois_json=?,analysis_json=?,status='分析完成',error_message=NULL,updated_at=? WHERE id=?").bind(JSON.stringify(pois),JSON.stringify(analysis),now(),store.id).run()}catch(error){await runtimeEnv.DB.prepare("UPDATE stores SET status='分析失败',error_message=?,updated_at=? WHERE id=?").bind(error instanceof Error?error.message:"分析失败",now(),store.id).run()}await refreshJob(jobId,"analysis")}
  const counts=await refreshJob(jobId,"analysis");const state=await runtimeEnv.DB.prepare("SELECT control FROM jobs WHERE id=?").bind(jobId).first<Row>();if(state?.control==="run")await runtimeEnv.DB.prepare("UPDATE jobs SET status=?,control='idle',current_store='',updated_at=? WHERE id=?").bind(counts.failed?"部分完成":"已完成",now(),jobId).run();
}

function schedule(task:Promise<void>){const context=getRequestExecutionContext();if(context)context.waitUntil(task);else void task}
async function getJob(id:number){const row=await runtimeEnv.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<Row>();return row?serializeJob(row):null}
async function bodyJson(request:Request){try{return await request.json() as Row}catch{return {}}}

function aggregateStore(label:string,pois:Poi[],radii:number[]):AggregateStore{
  const normalized=[...new Set(radii.filter(radius=>Number.isFinite(radius)&&radius>0))].sort((a,b)=>a-b);
  return {label,circles:normalized.map(radius=>{const inside=pois.filter(poi=>poi.distance<=radius),counts:Record<string,number>={};for(const poi of inside)counts[poi.category]=(counts[poi.category]||0)+1;return {radius,total:inside.length,counts}})};
}

function serializeAi(row:Row){return {id:Number(row.id),scope:row.scope,job_id:row.job_id==null?null:Number(row.job_id),store_id:row.store_id==null?null:Number(row.store_id),store_ids:parseJson<number[]>(row.store_ids_json,[]),result:parseJson(row.result_json,{}),model:row.model,prompt_version:row.prompt_version,usage:{input_tokens:Number(row.input_tokens||0),output_tokens:Number(row.output_tokens||0),total_tokens:Number(row.total_tokens||0)},created_at:row.created_at}}

async function generateAi(scope:"single"|"comparison",stores:AggregateStore[],jobId:number|null,storeId:number|null,storeIds:number[]){
  const apiKey=clean(runtimeEnv.DEEPSEEK_API_KEY);if(!apiKey)throw new Error("DeepSeek API Key 尚未配置");
  const model=clean(runtimeEnv.DEEPSEEK_MODEL)||"deepseek-v4-flash",apiBaseUrl=clean(runtimeEnv.DEEPSEEK_API_BASE_URL)||"https://api.deepseek.com";
  const generated=await callDeepSeek({apiKey,apiBaseUrl,model,scope,stores}),stamp=now(),usage=generated.usage;
  const saved=await runtimeEnv.DB.prepare("INSERT INTO ai_analyses(scope,job_id,store_id,store_ids_json,input_json,result_json,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(scope,jobId,storeId,JSON.stringify(storeIds),JSON.stringify({scope,stores}),JSON.stringify(generated.result),model,generated.promptVersion,Number(usage.prompt_tokens||0),Number(usage.completion_tokens||0),Number(usage.total_tokens||0),stamp).run();
  return {id:Number(saved.meta?.last_row_id),scope,job_id:jobId,store_id:storeId,store_ids:storeIds,result:generated.result,model,prompt_version:generated.promptVersion,usage:{input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),total_tokens:Number(usage.total_tokens||0)},created_at:stamp};
}

async function handle(request:Request,path:string[]){
  await ensureDb();const method=request.method,id=Number(path[1]);
  if(path[0]==="health"&&method==="GET")return json({mock:false,web_key:Boolean(runtimeEnv.AMAP_WEB_SERVICE_KEY),js_key:true,coordinate_system:"GCJ-02",runtime:"cloud"});

  if(path[0]==="auth"&&path[1]==="login"&&method==="POST")return login(request);
  if(path[0]==="auth"&&path[1]==="logout"&&method==="POST")return logout(request);
  const user=await currentUser(request);
  if(path[0]==="auth"&&path[1]==="me"&&method==="GET")return user?json(publicUser(user)):fail("请先登录",401,"AUTH_REQUIRED");
  if(!user)return fail("请先登录",401,"AUTH_REQUIRED");
  if(path[0]==="auth"&&path[1]==="change-password"&&method==="POST")return changePassword(request,user);
  if(path[0]==="admin"&&path[1]==="users"&&method==="GET"){if(user.role!=="admin")return fail("需要管理员权限",403);const {results}=await runtimeEnv.DB.prepare("SELECT id,email,display_name,role,active,created_at FROM users ORDER BY id").all<Row>();return json(results)}
  if(path[0]==="admin"&&path[1]==="users"&&method==="POST"){if(user.role!=="admin")return fail("需要管理员权限",403);const body=await bodyJson(request),email=clean(body.email).toLowerCase(),displayName=clean(body.display_name),password=String(body.password||""),role=body.role==="admin"?"admin":"member";if(!email||!displayName||password.length<10)return fail("姓名、邮箱必填，密码至少 10 位");const existing=await runtimeEnv.DB.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(email).first<Row>();if(existing)return fail("邮箱已存在",409);const stamp=now(),passwordHash=await bcrypt.hash(password,10),saved=await runtimeEnv.DB.prepare("INSERT INTO users(email,display_name,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").bind(email,displayName,passwordHash,role,stamp,stamp).run();return json({id:Number(saved.meta?.last_row_id),email,display_name:displayName,role,active:true,created_at:stamp},201,"用户已创建")}
  if(path[0]==="poi-categories"&&method==="GET")return json(Object.keys(CATEGORY_TYPES).concat("竞品门店").map((name,index)=>({id:index+1,name,display_name:name,search_mode:"typecode",typecodes:CATEGORY_TYPES[name]||"",keywords:"",color:"#08745b"})));
  if(path[0]==="geocode"&&method==="POST")return json({candidates:await geocode(await bodyJson(request))});
  if(path[0]==="stores"&&path[1]==="search"&&method==="POST"){const body=await bodyJson(request);return json({candidates:await searchCandidates(clean(body.name),clean(body.city),clean(body.district),clean(body.address))})}
  if(path[0]==="stores"&&path[1]==="from-geocode"&&method==="POST"){const body=await bodyJson(request),candidate=body.candidate as Row,location=Array.isArray(candidate?.location)?candidate.location:[null,null],stamp=now();const result=await runtimeEnv.DB.prepare("INSERT INTO stores(input_name,standard_name,longitude,latitude,province,city,district,address,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(clean(body.name)||clean(candidate.name),clean(candidate.name),location[0],location[1],clean(candidate.province),clean(candidate.city),clean(candidate.district),clean(candidate.address),"已确认",stamp,stamp).run();return json({id:Number(result.meta?.last_row_id)})}
  if(path[0]==="stores"&&path.length===1&&method==="POST"){const body=await bodyJson(request),candidate=body.candidate as Row,location=Array.isArray(candidate?.location)?candidate.location:[null,null],stamp=now();const result=await runtimeEnv.DB.prepare("INSERT INTO stores(input_name,standard_name,amap_poi_id,longitude,latitude,province,city,district,address,match_score,match_status,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(clean(body.name),clean(candidate.name),clean(candidate.id),location[0],location[1],clean(candidate.province),clean(candidate.city),clean(candidate.district),clean(candidate.address),Number(candidate.score||0),clean(candidate.status),"已确认",stamp,stamp).run();return json({id:Number(result.meta?.last_row_id)})}
  if(path[0]==="stores"&&path[2]==="confirm"&&method==="POST")return json({id});
  if(path[0]==="stores"&&path[2]==="poi-search"&&method==="POST"){const body=await bodyJson(request),store=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE id=?").bind(id).first<Row>();if(!store||store.longitude==null)return fail("请先确认门店位置");const categories=Array.isArray(body.categories)?body.categories.map(clean):["住宅小区","幼儿园","小学"],radii=Array.isArray(body.radii)?body.radii.map(Number):[500],stamp=now();const jobResult=await runtimeEnv.DB.prepare("INSERT INTO jobs(status,total_stores,matched_stores,config_json,stage,control,created_at,updated_at) VALUES('正在查询POI',1,1,?,'analysis','run',?,?)").bind(JSON.stringify({categories,radii}),stamp,stamp).run();const jobId=Number(jobResult.meta?.last_row_id);await runtimeEnv.DB.prepare("UPDATE stores SET job_id=? WHERE id=?").bind(jobId,id).run();try{const pois=await searchPois(store,categories,radii);await runtimeEnv.DB.prepare("UPDATE stores SET pois_json=?,status='分析完成',updated_at=? WHERE id=?").bind(JSON.stringify(pois),now(),id).run();await runtimeEnv.DB.prepare("UPDATE jobs SET status='已完成',processed_stores=1,success_stores=1,control='idle',updated_at=? WHERE id=?").bind(now(),jobId).run();return json({job_id:jobId,pois})}catch(error){return fail(error instanceof Error?error.message:"POI查询失败",503)}}
  if(path[0]==="stores"&&path[2]==="business-district-analysis"&&method==="POST"){const body=await bodyJson(request),store=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE id=?").bind(id).first<Row>();if(!store)return fail("门店不存在",404);const pois=parseJson<Poi[]>(store.pois_json,[]),analysis=createAnalysis(store,pois,Array.isArray(body.radii)?body.radii.map(Number):[500]);await runtimeEnv.DB.prepare("UPDATE stores SET analysis_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(analysis),now(),id).run();return json(analysis)}
  if(path[0]==="stores"&&path[2]==="ai-analysis"&&method==="POST"){const body=await bodyJson(request),store=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE id=?").bind(id).first<Row>();if(!store)return fail("门店不存在",404);const pois=parseJson<Poi[]>(store.pois_json,[]);if(!pois.length)return fail("请先完成该门店的 POI 分析");const jobId=store.job_id==null?null:Number(store.job_id),job=jobId?await runtimeEnv.DB.prepare("SELECT config_json FROM jobs WHERE id=?").bind(jobId).first<Row>():null,config=parseJson<{radii?:number[]}>(job?.config_json,{}),radii=Array.isArray(body.radii)&&body.radii.length?body.radii.map(Number):config.radii?.length?config.radii:[500];return json(await generateAi("single",[aggregateStore("门店A",pois,radii)],jobId,id,[id]),200,"AI 人群画像已生成")}
  if(path[0]==="stores"&&path[2]==="ai-analyses"&&method==="GET"){const {results}=await runtimeEnv.DB.prepare("SELECT * FROM ai_analyses WHERE scope='single' AND store_id=? ORDER BY id DESC LIMIT 30").bind(id).all<Row>();return json(results.map(serializeAi))}
  if(path[0]==="import"&&path[1]==="preview"&&method==="POST"){try{return json(await parseUpload(request),200,"文件解析成功")}catch(error){return fail(error instanceof Error?error.message:"文件解析失败")}}
  if(path[0]==="import"&&path[1]==="confirm"&&method==="POST"){const body=await bodyJson(request),rows=Array.isArray(body.rows)?body.rows as Row[]:[],mapping=(body.mapping||{}) as Record<string,string>,config=(body.config||{}) as Row;if(!rows.length)return fail("请至少选择一家门店");const stamp=now(),jobResult=await runtimeEnv.DB.prepare("INSERT INTO jobs(filename,status,total_stores,config_json,stage,control,created_at,updated_at) VALUES(?,'等待开始匹配',?,?,'match','idle',?,?)").bind(clean(body.filename),rows.length,JSON.stringify(config),stamp,stamp).run(),jobId=Number(jobResult.meta?.last_row_id);for(const row of rows){await runtimeEnv.DB.prepare("INSERT INTO stores(job_id,input_name,province,city,district,address,user_code,brand,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(jobId,clean(row[mapping.name]),clean(row[mapping.province]),clean(row[mapping.city]),clean(row[mapping.district]),clean(row[mapping.address]),clean(row[mapping.code]),clean(row[mapping.brand]),"等待匹配",stamp,stamp).run()}return json({job_id:jobId,status:"等待开始匹配"},200,"批量任务创建成功")}
  if(path[0]==="analysis-jobs"&&path.length===1&&method==="GET"){const {results}=await runtimeEnv.DB.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 100").all<Row>();return json(results.map(serializeJob))}
  if(path[0]==="analysis-jobs"&&path.length===2&&method==="GET"){const job=await getJob(id);return job?json(job):fail("任务不存在",404)}
  if(path[0]==="analysis-jobs"&&path[2]==="stores"&&path.length===3&&method==="GET"){const {results}=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE job_id=? ORDER BY id").bind(id).all<Row>();return json(results.map(row=>({store:serializeStore(row),status:row.status,poi_summary:createSummary(parseJson<Poi[]>(row.pois_json,[])),has_profile:Boolean(row.analysis_json),error_message:row.error_message||""})))}
  if(path[0]==="analysis-jobs"&&path[2]==="stores"&&path.length===4&&method==="GET"){const storeId=Number(path[3]),job=await getJob(id),store=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE id=? AND job_id=?").bind(storeId,id).first<Row>();if(!job||!store)return fail("门店不存在",404);const pois=parseJson<Poi[]>(store.pois_json,[]);return json({job,store:serializeStore(store),status:store.status,pois,poi_summary:createSummary(pois),analysis:parseJson(store.analysis_json,null),disclaimer:"本分析仅反映高德POI设施分布及其代理推断。"})}
  if(path[0]==="analysis-jobs"&&path[2]==="business-district-results"&&method==="GET"){const {results}=await runtimeEnv.DB.prepare("SELECT * FROM stores WHERE job_id=? AND analysis_json IS NOT NULL ORDER BY id").bind(id).all<Row>();return json(results.map(row=>({...parseJson<Row>(row.analysis_json,{}),store:serializeStore(row),poi_summary:createSummary(parseJson<Poi[]>(row.pois_json,[]))})))}
  if(path[0]==="analysis-jobs"&&path[2]==="ai-comparison"&&method==="POST"){const body=await bodyJson(request),storeIds=[...new Set((Array.isArray(body.store_ids)?body.store_ids:[]).map(Number).filter(Number.isFinite))];if(storeIds.length<2||storeIds.length>10)return fail("请选择 2–10 家门店进行 AI 对比");const placeholders=storeIds.map(()=>"?").join(","),{results}=await runtimeEnv.DB.prepare(`SELECT * FROM stores WHERE job_id=? AND id IN (${placeholders})`).bind(id,...storeIds).all<Row>();if(results.length!==storeIds.length)return fail("部分门店不属于当前任务或已不存在");const ordered=storeIds.map(storeId=>results.find(row=>Number(row.id)===storeId) as Row),job=await runtimeEnv.DB.prepare("SELECT config_json FROM jobs WHERE id=?").bind(id).first<Row>(),config=parseJson<{radii?:number[]}>(job?.config_json,{}),radii=config.radii?.length?config.radii:[500],labels=ordered.map((row,index)=>({store_id:Number(row.id),label:`门店${String.fromCharCode(65+index)}`,name:clean(row.input_name)})),aggregates=ordered.map((row,index)=>{const pois=parseJson<Poi[]>(row.pois_json,[]);if(!pois.length)throw new Error(`${labels[index].label}尚无 POI 分析结果`);return aggregateStore(labels[index].label,pois,radii)});const generated=await generateAi("comparison",aggregates,id,null,storeIds);return json({...generated,store_labels:labels},200,"多店 AI 对比已生成")}
  if(path[0]==="analysis-jobs"&&path[2]==="ai-comparisons"&&method==="GET"){const {results}=await runtimeEnv.DB.prepare("SELECT * FROM ai_analyses WHERE scope='comparison' AND job_id=? ORDER BY id DESC LIMIT 30").bind(id).all<Row>();return json(results.map(serializeAi))}
  if(path[0]==="analysis-jobs"&&path[2]==="start-matching"&&method==="POST"){const task=runMatching(id);schedule(task);return json(await getJob(id),200,"已开始连续匹配全部门店")}
  if(path[0]==="analysis-jobs"&&path[2]==="start-analysis"&&method==="POST"){const task=runAnalysis(id);schedule(task);return json(await getJob(id),200,"已开始连续分析全部门店")}
  if(path[0]==="analysis-jobs"&&["pause","end"].includes(path[2])&&method==="POST"){const pause=path[2]==="pause";await runtimeEnv.DB.prepare("UPDATE jobs SET status=?,control=?,updated_at=? WHERE id=?").bind(pause?"已暂停":"已结束",pause?"pause":"end",now(),id).run();return json(await getJob(id))}
  if(path[0]==="analysis-jobs"&&path[2]==="resume"&&method==="POST"){const job=await runtimeEnv.DB.prepare("SELECT stage FROM jobs WHERE id=?").bind(id).first<Row>();if(!job)return fail("任务不存在",404);const task=job.stage==="analysis"?runAnalysis(id):runMatching(id);schedule(task);return json(await getJob(id),200,"任务已继续")}
  if(path[0]==="analysis-jobs"&&path[2]==="retry"&&method==="POST"){await runtimeEnv.DB.prepare("UPDATE stores SET status=CASE WHEN longitude IS NULL THEN '等待匹配' ELSE '已确认' END,error_message=NULL WHERE job_id=? AND status IN ('匹配失败','分析失败')").bind(id).run();await runtimeEnv.DB.prepare("UPDATE jobs SET status='等待继续匹配',control='idle',updated_at=? WHERE id=?").bind(now(),id).run();return json(await getJob(id))}
  if(path[0]==="analysis-jobs"&&path[2]==="export"&&method==="GET")return exportJob(id);
  if(path[0]==="analysis-jobs"&&path[2]==="business-district-export"&&method==="GET")return exportJob(id);
  if(path[0]==="analysis-jobs"&&path[2]==="stores"&&path[4]==="export"&&method==="GET")return exportJob(id,Number(path[3]));
  return fail("接口不存在",404);
}

function createSummary(pois:Poi[]){const by_category:Record<string,number>={},by_distance:Record<string,number>={};for(const poi of pois){by_category[poi.category]=(by_category[poi.category]||0)+1;by_distance[poi.distance_bucket]=(by_distance[poi.distance_bucket]||0)+1}return {total:pois.length,by_category,by_distance}}
function csvCell(value:unknown){const text=clean(value);return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}
async function exportJob(jobId:number,storeId?:number){
  const sql=storeId?"SELECT * FROM stores WHERE job_id=? AND id=?":"SELECT * FROM stores WHERE job_id=? ORDER BY id",statement=runtimeEnv.DB.prepare(sql).bind(...(storeId?[jobId,storeId]:[jobId])),{results}=await statement.all<Row>();
  const lines=[["门店名称","高德标准名称","状态","城市","区县","地址","匹配分","POI数量","商圈类型","主要年龄","消费指数","AI人群画像","AI可信度","AI版本时间","错误说明"].join(",")];
  for(const row of results){
    const analysis=parseJson<Row>(row.analysis_json,{}),audience=(analysis.audience_profile||{}) as Row,groups=Array.isArray(audience.primary_groups)?audience.primary_groups as Row[]:[],consumption=(audience.consumption_power||{}) as Row,business=(analysis.business_district_type||{}) as Row,ai=await runtimeEnv.DB.prepare("SELECT * FROM ai_analyses WHERE scope='single' AND store_id=? ORDER BY id DESC LIMIT 1").bind(row.id).first<Row>(),aiResult=parseJson<Row>(ai?.result_json,{}),confidence=(aiResult.confidence||{}) as Row;
    lines.push([row.input_name,row.standard_name,row.status,row.city,row.district,row.address,row.match_score,parseJson<Poi[]>(row.pois_json,[]).length,business.type,groups.map(group=>group.age_range).join("、"),consumption.index,aiResult.summary,confidence.level,ai?.created_at,row.error_message].map(csvCell).join(","));
  }
  if(!storeId){const comparison=await runtimeEnv.DB.prepare("SELECT * FROM ai_analyses WHERE scope='comparison' AND job_id=? ORDER BY id DESC LIMIT 1").bind(jobId).first<Row>();if(comparison){const aiResult=parseJson<Row>(comparison.result_json,{}),confidence=(aiResult.confidence||{}) as Row;lines.push("",["最新多店AI对比","参与门店ID","AI对比结论","可信度","生成时间"].join(","),["多店对比",parseJson<number[]>(comparison.store_ids_json,[]).join("、"),aiResult.summary,confidence.level,comparison.created_at].map(csvCell).join(","))}}
  return new Response(`\uFEFF${lines.join("\r\n")}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="store-poi-report-${jobId}.csv"`}});
}

export async function GET(request:Request,context:{params:Promise<{path:string[]}>}){try{return await handle(request,(await context.params).path)}catch(error){return fail(error instanceof Error?error.message:"服务器错误",500)}}
export async function POST(request:Request,context:{params:Promise<{path:string[]}>}){try{return await handle(request,(await context.params).path)}catch(error){return fail(error instanceof Error?error.message:"服务器错误",500)}}
