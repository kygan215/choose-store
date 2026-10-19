import test from "node:test";
import assert from "node:assert/strict";
import {analysisHistoryIdentityIssues,parseHistoryLocationInput,realHistoryPoiId,historyLocationRegionIssues} from "../server/history-location.js";

test("verified history location requires a real address, valid China GCJ02 coordinates and evidence reason",()=>{
 const input=parseHistoryLocationInput({address:"湖北省孝感市孝南区环城路",longitude:"113.914087",latitude:30.914736,reason:"核对高德分享位置与门店招牌"});
 assert.equal(input.longitude,113.914087);assert.equal(input.source,"manual");
 for(const input of [{address:"地址",longitude:true,latitude:30,reason:"人工核实"},{address:"地址",longitude:114,latitude:NaN,reason:"人工核实"},{address:"地址",longitude:0,latitude:30,reason:"人工核实"},{address:"",longitude:114,latitude:30,reason:"人工核实"},{address:"地址",longitude:114,latitude:30,reason:""}])assert.throws(()=>parseHistoryLocationInput(input));
});
test("manual GCJ02 region must agree with imported history, including municipality aliases",()=>{
 assert.deepEqual(historyLocationRegionIssues({province:"湖北省",city:"孝感市"},{province:"湖北省",city:"孝感市"}),[]);
 assert.ok(historyLocationRegionIssues({province:"湖北省",city:"孝感市"},{province:"湖北省",city:"武汉市"}).length);
 assert.ok(historyLocationRegionIssues({province:"湖北省",city:"孝感市"},{province:"湖南省",city:"长沙市"}).length);
 assert.deepEqual(historyLocationRegionIssues({province:"北京市",city:"北京市"},{province:"北京",city:"北京"}),[]);
});
test("address coordinates never become fabricated POI identity",()=>{
 assert.equal(realHistoryPoiId("B0ABCD1234"),"B0ABCD1234");
 for(const id of ["GEO-0","COORD-114-30","GEOCODE-0",null,""])assert.equal(realHistoryPoiId(id),null);
});
test("manual analysis association protects brand, region, existing links and real POI while allowing a checked coordinate record",()=>{
 const h={id:1,brand_name:"零食很忙",province:"湖北省",city:"孝感市",poi_id:null,brand_store_id:null};
 const s={input_name:"零食很忙湖北孝感实验小学店",brand:"零食很忙",province:"湖北省",city:"孝感市",amap_poi_id:"GEO-0",history_store_id:null,brand_store_id:null};
 assert.deepEqual(analysisHistoryIdentityIssues(h,s),[]);
 assert.ok(analysisHistoryIdentityIssues(h,{...s,brand:"好想来"}).length);
 assert.ok(analysisHistoryIdentityIssues(h,{...s,city:"武汉市"}).length);
 assert.ok(analysisHistoryIdentityIssues(h,{...s,history_store_id:2}).length);
 assert.ok(analysisHistoryIdentityIssues({...h,poi_id:"B0ABCD1234"},{...s,amap_poi_id:"B0ABCD9999"}).length);
 assert.ok(analysisHistoryIdentityIssues({...h,poi_id:null,brand_store_id:7,history_library_poi_id:"B0ABCD1234",history_library_brand:"零食很忙"},{...s,amap_poi_id:"B0ABCD9999"}).length,"library POI is authoritative even when original history poi_id is empty");
 assert.ok(analysisHistoryIdentityIssues({...h,poi_id:"B0ABCD1234",history_library_poi_id:"B0ABCD9999"},{...s,amap_poi_id:"B0ABCD1234"}).length,"an internally contradictory history identity cannot be used");
 assert.ok(analysisHistoryIdentityIssues(h,{...s,brand:null,input_name:"同名分店"}).length);
});
