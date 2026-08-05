import io
import os

os.environ["ENABLE_MOCK_AMAP"]="true"
os.environ["DATABASE_URL"]="sqlite://"
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from backend.main import app


def test_full_mock_flow():
    with TestClient(app) as client:
        r=client.post("/api/stores/search",json={"name":"零食很忙武汉南湖店","city":"武汉市","district":"洪山区","address":""})
        assert r.status_code==200 and len(r.json()["data"]["candidates"])>=2
        c=r.json()["data"]["candidates"][0]
        store=client.post("/api/stores",json={"name":"零食很忙武汉南湖店","city":"武汉市","district":"洪山区","address":"","candidate":c}).json()["data"]
        assert client.post(f"/api/stores/{store['id']}/confirm",json={"candidate":c}).status_code==200
        analysis=client.post(f"/api/stores/{store['id']}/poi-search",json={"categories":["住宅小区","幼儿园","竞品门店"],"radii":[500,1000,2000],"max_radius":2000})
        assert analysis.status_code==200
        body=analysis.json()["data"]
        assert body["pois"] and len({p["id"] for p in body["pois"]})==len(body["pois"])

        profile = client.post(
            f"/api/stores/{store['id']}/business-district-analysis",
            json={"radii": [500, 1000, 2000]},
        )
        assert profile.status_code == 200
        profile_data = profile.json()["data"]
        assert profile_data["business_area"]["name"] == "南湖商圈"
        assert profile_data["business_district_type"]
        assert profile_data["level"]["level"] in {"S", "A", "B", "C", "D"}
        assert profile_data["analysis_version"]

        batch_profile = client.post(
            f"/api/analysis-jobs/{body['job_id']}/business-district-analysis",
            json={"radii": [500, 1000, 2000]},
        )
        assert batch_profile.status_code == 200
        compared = client.get(f"/api/analysis-jobs/{body['job_id']}/business-district-results")
        assert compared.status_code == 200 and len(compared.json()["data"]) == 1

        export=client.get(f"/api/analysis-jobs/{body['job_id']}/export")
        assert export.status_code==200
        wb=load_workbook(io.BytesIO(export.content))
        assert {"门店汇总","POI明细","待确认门店","失败记录","搜索配置","商圈汇总","商圈特征明细","商圈评分配置"}<=set(wb.sheetnames)

        business_export = client.get(f"/api/analysis-jobs/{body['job_id']}/business-district-export")
        business_wb = load_workbook(io.BytesIO(business_export.content))
        assert {"商圈汇总", "商圈特征明细", "商圈评分配置"} == set(business_wb.sheetnames)


def test_import_preview_and_errors():
    with TestClient(app) as client:
        data="门店名称,城市,区县\n测试门店,武汉市,洪山区\n".encode("utf-8-sig")
        r=client.post("/api/import/preview",files={"file":("stores.csv",data,"text/csv")})
        assert r.status_code==200 and r.json()["data"]["mapping"]["name"]=="门店名称"
        r=client.post("/api/import/preview",files={"file":("bad.exe",b"x","application/octet-stream")})
        assert r.status_code==400 and r.json()["success"] is False

        address_only = "详细地址,城市\n武汉市洪山区文治街32号,武汉市\n".encode("utf-8-sig")
        r = client.post("/api/import/preview", files={"file": ("addresses.csv", address_only, "text/csv")})
        assert r.status_code == 200 and r.json()["data"]["mapping"]["address"] == "详细地址"


def test_address_geocode_and_config_roundtrip():
    with TestClient(app) as client:
        matched = client.post(
            "/api/stores/search",
            json={"name": "零食很忙武汉南湖店", "city": "武汉市", "district": "洪山区", "address": "文治街32号"},
        )
        assert matched.status_code == 200
        assert matched.json()["data"]["candidates"][0]["address_geocode_distance_m"] == 0

        response = client.post(
            "/api/geocode",
            json={"address": "文治街32号", "province": "湖北省", "city": "武汉市", "district": "洪山区"},
        )
        assert response.status_code == 200
        candidate = response.json()["data"]["candidates"][0]
        assert candidate["level"] == "门牌号"
        assert candidate["requires_confirmation"] is False

        created = client.post(
            "/api/stores/from-geocode",
            json={"name": "地址定位测试店", "address": "文治街32号", "city": "武汉市", "candidate": candidate},
        )
        assert created.status_code == 200
        store = created.json()["data"]
        assert store["raw_address"] == "文治街32号"
        assert store["location_source"] == "高德地址解析"

        config = client.get("/api/business-district-config")
        assert config.status_code == 200
        assert config.json()["data"]["analysis_version"]
        saved = client.put("/api/business-district-config", json={"version": "test-v1", "note": "测试配置"})
        assert saved.status_code == 200 and saved.json()["data"]["version"] == "test-v1"


def test_ipv6_local_frontend_origin_is_allowed():
    with TestClient(app) as client:
        r = client.options(
            "/api/health",
            headers={
                "Origin": "http://[::1]:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == "http://[::1]:3000"
