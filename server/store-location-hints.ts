/** Location hints are user supplied clues, never verified store identity. */
export type StoreLocationHintInput={locationShare?:unknown;address?:unknown;longitude?:unknown;latitude?:unknown;poiId?:unknown;name?:unknown};
export type StoreLocationHints={poiId:string;name:string;address:string;longitude:number|null;latitude:number|null;source:"manual"|"amap_share"|null;warnings:string[];shareUrl:string|null};
const clean=(value:unknown)=>String(value??"").trim();
const hosts=new Set(["surl.amap.com","uri.amap.com","amap.com","www.amap.com","ditu.amap.com","m.amap.com"]);
const poi=(value:unknown)=>/^B[A-Z0-9]{9}$/i.test(clean(value))?clean(value).toUpperCase():"";
const coordinate=(value:unknown,min:number,max:number)=>{if(value==null||clean(value)==="")return null;const number=Number(value);return Number.isFinite(number)&&number>=min&&number<=max?number:null};
function allowedUrl(value:string){try{const url=new URL(value);return url.protocol==="https:"&&hosts.has(url.hostname)&&!url.username&&!url.password&&(!url.port||url.port==="443")?url:null}catch{return null}}
function linkFrom(value:unknown){return clean(value).match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[，。；）)]+$/u,"")||""}
// Observed official short-share redirect format: POI ID, latitude, longitude,
// name, address, administrative code. HTTP here is data only, never requested.
function canonicalWbShareUrl(value:string,allowHttpData=false){
 try{
  const url=new URL(value);
  if(url.hostname!=="wb.amap.com"||url.pathname!=="/"||url.username||url.password||url.port||(url.protocol!=="https:"&&!(allowHttpData&&url.protocol==="http:"))||url.searchParams.getAll("p").length!==1)return null;
  const parts=(url.searchParams.get("p")||"").split(",");if(parts.length!==6)return null;
  const [id,rawLatitude,rawLongitude,name,address,adcode]=parts,latitude=coordinate(rawLatitude,3,54),longitude=coordinate(rawLongitude,73,136);
  if(!poi(id)||latitude==null||longitude==null||!name||name.length>200||!address||address.length>500||!/^\d{6}$/.test(adcode))return null;
  const canonical=new URL("https://uri.amap.com/marker");canonical.searchParams.set("poiid",poi(id));canonical.searchParams.set("position",`${longitude},${latitude}`);canonical.searchParams.set("name",name);canonical.searchParams.set("address",address);canonical.searchParams.set("coordinate","gaode");return canonical;
 }catch{return null}
}

export function parseStoreLocationHints(input:StoreLocationHintInput):StoreLocationHints{
 const rawShare=clean(input.locationShare)||(/^https?:\/\//.test(clean(input.name))?clean(input.name):""),rawUrl=linkFrom(rawShare);
 const result:StoreLocationHints={poiId:poi(input.poiId),name:rawShare===clean(input.name)?"":clean(input.name).slice(0,200),address:clean(input.address).slice(0,500),longitude:coordinate(input.longitude,73,136),latitude:coordinate(input.latitude,3,54),source:null,warnings:[],shareUrl:null};
 if(result.poiId||result.name||result.address||result.longitude!=null||result.latitude!=null)result.source="manual";
 if((result.longitude==null)!==(result.latitude==null)){result.longitude=null;result.latitude=null;result.warnings.push("经纬度须成对填写，且须为有效的高德经纬度");}
 if(!rawShare)return result;
 const url=rawUrl.length<=4096?(canonicalWbShareUrl(rawUrl)||allowedUrl(rawUrl)):null;
 if(!url){result.warnings.push("位置链接仅支持 HTTPS 高德官方地址，请补充门店地址或高德坐标");return result}
 result.shareUrl=url.href;
 const marker=url.hostname==="uri.amap.com"&&url.pathname==="/marker",navigation=url.hostname==="uri.amap.com"&&url.pathname==="/navigation",detail=/^\/detail(?:\/|$)/.test(url.pathname);
 if(!marker&&!navigation&&!detail){result.warnings.push("该高德链接未直接提供可解析的位置线索，可解析官方跳转后再核对，或补充地址和坐标");return result}
 const sharedPoi=poi(url.searchParams.get("poiid")||url.searchParams.get("poiId")||url.searchParams.get("id")||url.pathname.match(/^\/detail\/(B[A-Z0-9]{9})(?:\/|$)/i)?.[1]);
 const position=clean(marker?url.searchParams.get("position"):navigation?url.searchParams.get("to"):url.searchParams.get("position")),parts=position.split(",");
 const longitude=coordinate(parts[0],73,136),latitude=coordinate(parts[1],3,54),system=url.searchParams.get("coordinate")||"gaode";
 if(sharedPoi&&result.poiId&&result.poiId!==sharedPoi)result.warnings.push("手填 POI ID 与分享链接不同，优先使用手填 ID，请核对");
 result.poiId ||= sharedPoi;result.name ||= clean(url.searchParams.get("name")||parts.slice(2).join(",")).slice(0,200);result.address ||= clean(url.searchParams.get("address")).slice(0,500);
 if(system!=="gaode"&&position)result.warnings.push("分享链接不是高德 GCJ-02 坐标，未将其直接用于检索，请提供高德坐标或详细地址");
 else if(longitude!=null&&latitude!=null){if(result.longitude==null||result.latitude==null){result.longitude=longitude;result.latitude=latitude}}
 else if(position)result.warnings.push("分享链接中的坐标无效，请补充地址或有效高德坐标");
 result.source="amap_share";
 if(!sharedPoi)result.warnings.push("分享位置未提供真实 POI ID，名称和坐标仅作搜索线索，仍需核对候选");
 return result;
}

/** Only follows HTTP redirects on fixed official hosts; never reads or executes page HTML. */
export async function resolveStoreLocationHints(input:StoreLocationHintInput,fetchImpl:typeof fetch=fetch):Promise<StoreLocationHints>{
 const initial=parseStoreLocationHints(input);if(!initial.shareUrl||initial.poiId||(initial.longitude!=null&&initial.latitude!=null))return initial;
 let current=initial.shareUrl;const controller=new AbortController(),visited=new Set<string>();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("timeout"))},5000)});
 try{
  const resolve=async()=>{for(let redirect=0;redirect<=4;redirect++){
   const url=allowedUrl(current);if(!url)throw new Error("unsafe");if(visited.has(url.href))throw new Error("loop");visited.add(url.href);
   const response=await fetchImpl(url.href,{redirect:"manual",signal:controller.signal,headers:{Accept:"text/html"}});
   void response.body?.cancel().catch(()=>{});
   if(![301,302,303,307,308].includes(response.status))return null;
   const target=response.headers.get("location");if(!target)return null;if(redirect===4)throw new Error("limit");const nextValue=new URL(target,url).href,next=canonicalWbShareUrl(nextValue,true)||allowedUrl(nextValue);if(!next)throw new Error("unsafe");
   current=next.href;const parsed=parseStoreLocationHints({...input,locationShare:current});
   if(parsed.poiId||(parsed.longitude!=null&&parsed.latitude!=null))return parsed;
  }return null};
  const parsed=await Promise.race([resolve(),timeout]);
  if(parsed)return {...parsed,shareUrl:initial.shareUrl,warnings:[...new Set(parsed.warnings)]};
  return {...initial,warnings:["高德分享跳转未提供可用 POI ID 或坐标，请在 APP 中复制地址或地图坐标后补充"]};
 }catch(error){const code=error instanceof Error?error.message:"failed";return {...initial,warnings:[code==="unsafe"?"分享链接跳转到未允许的地址，已停止解析，请补充地址或坐标":code==="timeout"?"高德分享链接解析超过 5 秒，请补充地址或坐标":code==="limit"||code==="loop"?"高德分享链接跳转过多或循环，请补充地址或坐标":"高德分享链接暂时无法解析，请补充地址或坐标"]}}
 finally{if(timer)clearTimeout(timer);controller.abort()}
}
