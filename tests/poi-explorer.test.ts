import test from "node:test";
import assert from "node:assert/strict";
import {emptyPoiFilters,filterPois,poiCategoryOptions,type ExplorerPoi} from "../app/poi-explorer";
import {POI_CATEGORY_TYPES} from "../server/services";

const poi=(id:string,category:string,distance:number,name=id):ExplorerPoi=>({id,category,distance,name,address:"青菱路99号",type:category,location:[114,30]});
const rows=[poi("B000000001","小学",500,"实验小学"),poi("B000000002","药店",100),poi("B000000003","小学",800,"中心小学"),poi("B000000004","历史自定义分类",200)];
test("POI 下拉框包含所有系统分类、零结果分类和历史自定义分类",()=>{
 const options=poiCategoryOptions(rows);
 for(const category of [...Object.keys(POI_CATEGORY_TYPES),"竞品门店","历史自定义分类"])assert.ok(options.some(item=>item.name===category));
 assert.equal(options.find(item=>item.name==="小学")?.count,2);assert.equal(options.find(item=>item.name==="中学")?.count,0);
});
test("分类、名称/地址搜索与距离叠加，边界距离包含，不修改原数据",()=>{
 const before=JSON.stringify(rows);
 assert.deepEqual(filterPois(rows,{categories:["小学"],keyword:" 实验 ",radius:"500"}).map(p=>p.id),["B000000001"]);
 assert.equal(filterPois(rows,{categories:["小学"],keyword:"青菱路",radius:"500"}).length,1);
 assert.equal(filterPois(rows,{categories:["药店"],keyword:"小学",radius:""}).length,0);
 assert.equal(JSON.stringify(rows),before);
});
test("地图分类清空不等于全部，重置恢复全部，结果按距离排序",()=>{
 assert.equal(filterPois(rows,{categories:[],keyword:"",radius:""}).length,0);
 assert.deepEqual(filterPois(rows,emptyPoiFilters()).map(p=>p.distance),[100,200,500,800]);
 assert.equal(filterPois(rows,{categories:["中学"],keyword:"",radius:""}).length,0);
});
