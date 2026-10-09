export type ExplorerPoi = {
  id:string; name:string; category:string; type:string; address:string;
  typecode?:string; distance:number; location:[number,number]; distance_bucket?:string;
  brand?:string; competitor_relation?:"同品牌竞品"|"异品牌竞品";
  cost?:number; rating?:number; tel?:string|null;
};

export const POI_CATEGORIES = ["住宅小区","幼儿园","小学","中学","购物中心","超市","便利店","餐饮服务","咖啡茶饮","酒店","医院","药店","公园","地铁站","公交站","竞品门店"];
export type PoiFilters = {categories:string[]|null; keyword:string; radius:string};
export const emptyPoiFilters = ():PoiFilters => ({categories:null,keyword:"",radius:""});
export function poiCategoryOptions(pois:ExplorerPoi[]){
  const names=[...new Set([...POI_CATEGORIES,...pois.map(p=>p.category)])];
  return names.map(name=>({name,count:pois.filter(p=>p.category===name).length}));
}
export function filterPois(pois:ExplorerPoi[],filter:PoiFilters){
  const keyword=filter.keyword.trim().toLocaleLowerCase();
  return pois.filter(p=>(filter.categories===null||filter.categories.includes(p.category))
    &&(!keyword||[p.name,p.address,p.brand,p.type,p.id].some(value=>value?.toLocaleLowerCase().includes(keyword)))
    &&(!filter.radius||(Number.isFinite(p.distance)&&p.distance<=Number(filter.radius))))
    .sort((a,b)=>a.distance-b.distance);
}
export const poiKey=(p:ExplorerPoi)=>JSON.stringify([p.id,p.category,p.location,p.name]);
