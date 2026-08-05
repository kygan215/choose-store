import asyncio

from backend.amap import AmapClient


def test_store_search_merges_input_tips_details_and_text(monkeypatch):
    monkeypatch.setenv("ENABLE_MOCK_AMAP", "false")
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY", "test-key")
    client = AmapClient()
    calls = []

    async def fake_get(path, params):
        calls.append((path, params))
        if path.endswith("inputtips"):
            return {"tips": [{
                "id": "TIP-1",
                "name": "零食很忙(湖北武汉武昌中南三路店)",
                "district": "湖北省武汉市武昌区",
                "adcode": "420106",
                "address": "中南三路",
                "location": "114.30,30.53",
            }, {"id": []}, {"name": "no id"}]}
        if path.endswith("detail"):
            return {"pois": []}
        return {"pois": [{
            "id": "TIP-1",
            "name": "重复结果",
            "location": "114.30,30.53",
        }, {
            "id": "TEXT-2",
            "name": "其他候选",
            "location": "114.31,30.54",
        }]}

    client._get = fake_get
    result = asyncio.run(client.search_store({
        "name": "零食很忙湖北武汉武昌中南三路店",
        "city": "",
        "district": "",
        "address": "",
    }))

    assert [item["id"] for item in result] == ["TIP-1", "TEXT-2"]
    assert result[0]["province"] == "湖北省"
    assert result[0]["city"] == "武汉市"
    assert result[0]["district"] == "武昌区"
    assert [path for path, _ in calls] == [
        "/v3/assistant/inputtips",
        "/v5/place/detail",
        "/v5/place/text",
    ]
    assert calls[0][1]["city"] == ""
    assert calls[0][1]["citylimit"] == "false"


def test_geocode_deduplicates_identical_results(monkeypatch):
    monkeypatch.setenv("ENABLE_MOCK_AMAP", "false")
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY", "test-key")
    client = AmapClient()

    async def fake_get(path, params):
        assert path == "/v3/geocode/geo"
        item = {
            "formatted_address": "湖北省武汉市武昌区中南三路",
            "province": "湖北省", "city": "武汉市", "district": "武昌区",
            "adcode": "420106", "location": "114.338316,30.540269", "level": "道路",
        }
        return {"geocodes": [item, dict(item), dict(item)]}

    client._get = fake_get
    result = asyncio.run(client.geocode({"address": "中南三路", "city": "武汉市"}))
    assert len(result) == 1
    assert result[0]["formatted_address"] == "湖北省武汉市武昌区中南三路"
