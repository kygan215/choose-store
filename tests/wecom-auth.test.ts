import assert from "node:assert/strict";
import test from "node:test";
import { buildWeComLoginUrl, readWeComConfig, safeNextPath } from "../server/wecom-auth.js";

const config={corpId:"ww-test",agentId:"1000058",secret:"server-only",callbackUrl:"https://example.com/api/auth/wecom/callback",tenantId:null};

test("企业微信扫码登录链接使用自建应用并精确携带回调参数",()=>{
  const url=new URL(buildWeComLoginUrl(config,"csrf-state","qr"));
  assert.equal(url.origin,"https://login.work.weixin.qq.com");
  assert.equal(url.searchParams.get("login_type"),"CorpApp");
  assert.equal(url.searchParams.get("appid"),config.corpId);
  assert.equal(url.searchParams.get("agentid"),config.agentId);
  assert.equal(url.searchParams.get("redirect_uri"),config.callbackUrl);
  assert.equal(url.searchParams.get("state"),"csrf-state");
  assert.doesNotMatch(url.toString(),/server-only/);
});

test("企业微信内授权链接使用静默授权",()=>{
  const url=buildWeComLoginUrl(config,"csrf-state","oauth");
  assert.match(url,/open\.weixin\.qq\.com\/connect\/oauth2\/authorize/);
  assert.match(url,/scope=snsapi_base/);
  assert.match(url,/#wechat_redirect$/);
});

test("仅允许站内相对路径作为登录后去向",()=>{
  assert.equal(safeNextPath("/jobs?focus=2"),"/jobs?focus=2");
  assert.equal(safeNextPath("https://evil.example"),"/");
  assert.equal(safeNextPath("//evil.example"),"/");
  assert.equal(safeNextPath("/\\evil"),"/");
});

test("缺少Secret时企业微信登录保持关闭",()=>{
  assert.equal(readWeComConfig({WECOM_CORP_ID:"ww-test",WECOM_AGENT_ID:"1000058",APP_ORIGIN:"https://example.com"}),null);
  assert.deepEqual(readWeComConfig({WECOM_CORP_ID:"ww-test",WECOM_AGENT_ID:"1000058",WECOM_CORP_SECRET:"server-only",APP_ORIGIN:"https://example.com"}),config);
});
