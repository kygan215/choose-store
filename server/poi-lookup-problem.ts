import type {StoreSearchDiagnostics} from './store-search.js';
export function exactPoiLookupProblem(diagnostics:StoreSearchDiagnostics){
 const lookup=diagnostics.poi_lookup;
 if(lookup?.detail_status==='missing_location')return {status:422,code:'HISTORY_POI_LOCATION_MISSING',message:'高德返回了该 POI ID，但缺少可用坐标，暂不能关联。请补充高德分享位置或人工核实地址与坐标。'};
 if(lookup?.detail_status==='filtered')return {status:422,code:'HISTORY_POI_FILTERED',message:'高德返回了该 POI ID，但门店信息未通过当前名称或业态核对。请核对对应门店，不能用附近其他门店替代。'};
 if(diagnostics.failed_stages.length)return {status:503,code:'HISTORY_POI_LOOKUP_UNAVAILABLE',message:'部分高德查询接口暂时失败，同 ID 核验尚未完成，请稍后重试或补充地址、分享位置。'};
 return {status:404,code:'HISTORY_POI_NOT_FOUND',message:'高德详情未返回该 ID，按店名或地址回查输入提示也未取得同 ID 的有效候选。请补充地址或高德分享位置后重试。'};
}
