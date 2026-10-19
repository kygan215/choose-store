import assert from 'node:assert/strict';
import test from 'node:test';
import {exactPoiLookupProblem} from '../server/poi-lookup-problem.js';
import type {StoreSearchDiagnostics} from '../server/store-search.js';
const diagnostics:StoreSearchDiagnostics={requests:3,max_requests:10,budget_exhausted:false,failed_stages:[],warnings:[]};
test('POI详情无结果、缺坐标、规则过滤和查询失败分别说明',()=>{
 const make=(detail_status:NonNullable<StoreSearchDiagnostics['poi_lookup']>['detail_status'])=>({...diagnostics,poi_lookup:{requested_id:'B0M1A9HM30',detail_status,recovery_attempted:true}});
 assert.equal(exactPoiLookupProblem(make('empty')).status,404);
 assert.equal(exactPoiLookupProblem(make('missing_location')).code,'HISTORY_POI_LOCATION_MISSING');
 assert.equal(exactPoiLookupProblem(make('filtered')).code,'HISTORY_POI_FILTERED');
 assert.equal(exactPoiLookupProblem({...make('failed'),failed_stages:['新版详情核验']}).status,503);
});
