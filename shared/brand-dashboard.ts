export const DASHBOARD_PROVINCES = ["北京市","天津市","河北省","山西省","内蒙古自治区","辽宁省","吉林省","黑龙江省","上海市","江苏省","浙江省","安徽省","福建省","江西省","山东省","河南省","湖北省","湖南省","广东省","广西壮族自治区","海南省","重庆市","四川省","贵州省","云南省","西藏自治区","陕西省","甘肃省","青海省","宁夏回族自治区","新疆维吾尔自治区","台湾省","香港特别行政区","澳门特别行政区"];
export const UNKNOWN_PROVINCE="省份待补全";
export const shortProvince=(value:string)=>value.replace(/壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市/g,"");
export type DashboardGroup={province:string;brand_name:string;count:number|string};
export type DashboardMatrixRow={province:string;total:number;brands:Record<string,number>};
export type BrandDashboardData={brands:string[];provinces:string[];matrix:DashboardMatrixRow[];total:number;unknownProvinceCount:number};
export type BrandDashboardSnapshot=BrandDashboardData&{generatedAt:string;nextRefreshAt:string;stale:boolean;message?:string};

export function aggregateDashboard(groups:DashboardGroup[]):BrandDashboardData{
  const aliases=new Map(DASHBOARD_PROVINCES.flatMap(name=>[[name,name],[shortProvince(name),name]]));
  const brands=[...new Set(groups.map(row=>row.brand_name))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const matrix:DashboardMatrixRow[]=DASHBOARD_PROVINCES.map(province=>({province,total:0,brands:Object.create(null) as Record<string,number>}));
  const unknown:DashboardMatrixRow={province:UNKNOWN_PROVINCE,total:0,brands:Object.create(null) as Record<string,number>};
  for(const row of groups){
    const count=Number(row.count);
    if(!Number.isSafeInteger(count)||count<0)throw new Error("门店统计数量无效");
    const province=aliases.get(row.province.trim()),target=matrix.find(item=>item.province===province)||unknown;
    target.brands[row.brand_name]=(target.brands[row.brand_name]||0)+count;target.total+=count;
  }
  if(unknown.total)matrix.push(unknown);
  return {brands,provinces:matrix.map(row=>row.province),matrix,total:matrix.reduce((sum,row)=>sum+row.total,0),unknownProvinceCount:unknown.total};
}

export function filterDashboard(data:BrandDashboardData,brands:string[],provinces:string[]){
  const selected=new Set(brands),regions=new Set(provinces);
  const matrix=data.matrix.filter(row=>regions.has(row.province)).map(row=>({province:row.province,brands:Object.fromEntries(Object.entries(row.brands).filter(([brand])=>selected.has(brand))),total:Object.entries(row.brands).reduce((sum,[brand,count])=>sum+(selected.has(brand)?count:0),0)}));
  return {matrix,total:matrix.reduce((sum,row)=>sum+row.total,0),covered:matrix.filter(row=>row.total>0&&row.province!==UNKNOWN_PROVINCE).length,brandCount:brands.filter(brand=>matrix.some(row=>(row.brands[brand]||0)>0)).length,unknown:matrix.find(row=>row.province===UNKNOWN_PROVINCE)?.total||0};
}

export function nextDashboardRefresh(now=new Date()){
  const beijing=new Date(now.getTime()+8*3600_000);
  let next=Date.UTC(beijing.getUTCFullYear(),beijing.getUTCMonth(),beijing.getUTCDate(),2)-8*3600_000;
  if(next<=now.getTime())next+=86400_000;
  return new Date(next);
}
