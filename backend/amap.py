from __future__ import annotations

import asyncio
import os
import random
import re
from typing import Any

import httpx

from .core import amap_error, deduplicate_pois
from .business_district import FEATURE_PACK

CATEGORIES = {
    "住宅小区": ("120302", ""), "幼儿园": ("141204", ""), "小学": ("141203", ""),
    "购物中心": ("060101", ""), "超市": ("060400", ""), "便利店": ("060200", ""),
    "医院": ("090100", ""), "药店": ("090601", ""), "公园": ("110101", ""),
    "地铁站": ("150500", ""), "公交站": ("150700", ""), "竞品门店": ("", "零食很忙|赵一鸣零食|来伊份"),
}
CATEGORIES.update({name: (config["types"], config["keywords"]) for name, config in FEATURE_PACK.items()})


class AmapClient:
    def __init__(self) -> None:
        self.key = os.getenv("AMAP_WEB_SERVICE_KEY", "")
        self.mock = os.getenv("ENABLE_MOCK_AMAP", "true").lower() == "true" or not self.key
        self.base = os.getenv("AMAP_API_BASE_URL", "https://restapi.amap.com").rstrip("/")
        if self.base != "https://restapi.amap.com":
            raise RuntimeError("AMAP_API_BASE_URL 仅允许高德官方域名")
        self.timeout = float(os.getenv("AMAP_REQUEST_TIMEOUT", "15"))
        self.interval = int(os.getenv("AMAP_REQUEST_INTERVAL_MS", "300")) / 1000

    async def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        safe = {k: v for k, v in params.items() if k != "key"}
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(self.base + path, params={**params, "key": self.key})
                    response.raise_for_status()
                    data = response.json()
                if data.get("status") != "1":
                    code, message = amap_error(data.get("infocode", ""), data.get("info", ""))
                    if code == "AMAP_RATE_LIMIT" and attempt < 2:
                        await asyncio.sleep((attempt + 1) * .8)
                        continue
                    raise AmapServiceError(code, message)
                await asyncio.sleep(self.interval)
                return data
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt == 2:
                    raise AmapServiceError("AMAP_TIMEOUT", "高德地图服务连接超时，请稍后重试") from exc
                await asyncio.sleep((attempt + 1) * .6)
        return {"pois": []}

    async def search_store(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        if self.mock:
            return self._mock_candidates(query)

        # Input tips and place text search use different Amap indexes. Store names
        # that are visible in the Amap client are sometimes only recalled by the
        # input-tips index, so resolve those POI IDs before merging text results.
        candidates: list[dict[str, Any]] = []
        city = query.get("city") or ""
        common = {"city": city, "citylimit": "true" if city else "false"}
        try:
            tips = await self._get("/v3/assistant/inputtips", {
                "keywords": query["name"][:80],
                **common,
                "datatype": "poi",
                "output": "JSON",
            })
            tip_ids = [
                str(tip.get("id"))
                for tip in tips.get("tips", [])
                if isinstance(tip, dict) and isinstance(tip.get("id"), str) and tip.get("id")
            ][:10]
            tip_candidates = [
                self._parse_tip(tip)
                for tip in tips.get("tips", [])
                if isinstance(tip, dict)
                and isinstance(tip.get("id"), str)
                and tip.get("id")
                and isinstance(tip.get("location"), str)
                and "," in tip["location"]
            ]
            if tip_ids:
                details = await self._get("/v5/place/detail", {
                    "id": "|".join(tip_ids),
                    "show_fields": "business,navi",
                })
                candidates.extend(self._parse_poi(p) for p in details.get("pois", []))
            candidates.extend(tip_candidates)
        except AmapServiceError:
            # Some keys do not have the advanced input-tips quota. The regular
            # text-search path below remains a functional fallback.
            pass

        try:
            data = await self._get("/v5/place/text", {
                "keywords": query["name"][:80],
                "region": city,
                "city_limit": "true" if city else "false",
                "show_fields": "business,navi",
                "page_size": 25,
                "page_num": 1,
            })
            candidates.extend(self._parse_poi(p) for p in data.get("pois", []))
        except AmapServiceError:
            if not candidates:
                raise
        return deduplicate_pois(candidates)

    @staticmethod
    def _parse_tip(tip: dict[str, Any]) -> dict[str, Any]:
        region = str(tip.get("district") or "")
        province = city = district = ""
        province_match = re.match(r"^(.+?(?:省|自治区|特别行政区))", region)
        if province_match:
            province = province_match.group(1)
            region = region[len(province):]
        city_match = re.match(r"^(.+?(?:市|自治州|地区|盟))", region)
        if city_match:
            city = city_match.group(1)
            district = region[len(city):]
        elif region:
            district = region
        loc = [float(x) for x in str(tip["location"]).split(",")[:2]]
        return {
            "id": tip.get("id") or "",
            "name": tip.get("name") or "",
            "parent": "",
            "location": loc,
            "type": "高德输入提示",
            "typecode": "",
            "province": province,
            "city": city,
            "district": district,
            "adcode": tip.get("adcode") or "",
            "address": tip.get("address") or "",
            "distance": 0,
            "tel": None,
            "alias": None,
        }

    async def around(self, location: tuple[float, float], category: str, radius: int) -> tuple[list[dict[str, Any]], bool]:
        if self.mock:
            return self._mock_pois(location, category, radius), False
        types, keywords = CATEGORIES.get(category, ("", category))
        if not types and not keywords:
            raise AmapServiceError("EMPTY_SEARCH_CONDITION", "POI 分类缺少 typecode 或关键词，已阻止默认类别搜索")
        result, page = [], 1
        while page <= 8:
            params = {
                "location": f"{location[0]:.6f},{location[1]:.6f}", "radius": radius,
                "sortrule": "distance", "page_size": 25, "page_num": page,
                "show_fields": "business,navi",
            }
            if types: params["types"] = types
            if keywords: params["keywords"] = keywords[:80]
            data = await self._get("/v5/place/around", params)
            pois = [self._parse_poi(p) for p in data.get("pois", [])]
            result.extend(pois)
            if len(pois) < 25: break
            page += 1
        return deduplicate_pois(result), len(result) >= 200

    async def geocode(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        address = "".join(str(query.get(key) or "") for key in ("province", "city", "district", "address"))
        if not address.strip():
            return []
        if self.mock:
            return [{
                "formatted_address": address,
                "province": query.get("province") or "湖北省",
                "city": query.get("city") or "武汉市",
                "district": query.get("district") or "洪山区",
                "adcode": "420111",
                "location": [114.3237, 30.50634],
                "level": "门牌号" if any(ch.isdigit() for ch in address) else "道路",
                "source": "mock",
            }]
        data = await self._get("/v3/geocode/geo", {"address": address[:200], "city": query.get("city") or ""})
        result = []
        for item in data.get("geocodes", []):
            location = str(item.get("location") or "")
            if "," not in location:
                continue
            result.append({
                "formatted_address": item.get("formatted_address") or address,
                "province": item.get("province") or "",
                "city": item.get("city") or query.get("city") or "",
                "district": item.get("district") or "",
                "adcode": item.get("adcode") or "",
                "location": [float(x) for x in location.split(",")[:2]],
                "level": item.get("level") or "未知",
                "source": "amap_geocode",
            })
        unique, seen = [], set()
        for item in result:
            key = (
                item["formatted_address"], item["adcode"],
                round(item["location"][0], 6), round(item["location"][1], 6), item["level"],
            )
            if key not in seen:
                seen.add(key)
                unique.append(item)
        return unique

    @staticmethod
    def _parse_poi(p: dict[str, Any]) -> dict[str, Any]:
        loc = [float(x) for x in str(p.get("location", "0,0")).split(",")[:2]]
        business = p.get("business") if isinstance(p.get("business"), dict) else {}
        return {
            "id": p.get("id") or "", "name": p.get("name") or "", "parent": p.get("parent") or "",
            "location": loc, "type": p.get("type") or "", "typecode": p.get("typecode") or "",
            "province": p.get("pname") or "", "city": p.get("cityname") or "", "district": p.get("adname") or "",
            "adcode": p.get("adcode") or "", "address": p.get("address") or "",
            "distance": int(float(p.get("distance") or 0)), "tel": business.get("tel"), "alias": business.get("alias"),
            "business_area": business.get("business_area") or "",
        }

    @staticmethod
    def _mock_candidates(query: dict[str, Any]) -> list[dict[str, Any]]:
        city, district = query.get("city") or "武汉市", query.get("district") or "洪山区"
        name = query["name"]
        return [
            {"id":"MOCK-S-001","name":name,"type":"购物服务;专卖店","typecode":"061200","province":"湖北省","city":city,"district":district,"adcode":"420111","address":query.get("address") or "南湖街道文治街32号","location":[114.32370,30.50634]},
            {"id":"MOCK-S-002","name":name.replace("南湖店","南湖二店"),"type":"购物服务;专卖店","typecode":"061200","province":"湖北省","city":city,"district":district,"adcode":"420111","address":"珞狮南路451号","location":[114.32692,30.51012]},
            {"id":"MOCK-S-003","name":name.replace("武汉",""),"type":"购物服务","typecode":"060000","province":"湖北省","city":city,"district":"武昌区","adcode":"420106","address":"南湖花园城建安街","location":[114.31528,30.49876]},
        ]

    @staticmethod
    def _mock_pois(location: tuple[float,float], category: str, radius: int) -> list[dict[str, Any]]:
        seed = sum(ord(c) for c in category)
        rng = random.Random(seed)
        count = 4 + seed % 6
        items = []
        for i in range(count):
            distance = 90 + int(rng.random() * max(100, radius - 90))
            angle = rng.random() * 6.283
            lng = location[0] + (distance / 96000) * __import__("math").cos(angle)
            lat = location[1] + (distance / 111000) * __import__("math").sin(angle)
            items.append({"id":f"MOCK-{seed}-{i}","name":f"{category}示例点 {i+1}","parent":"","location":[round(lng,6),round(lat,6)],"type":category,"typecode":CATEGORIES.get(category,("", ""))[0],"province":"湖北省","city":"武汉市","district":"洪山区","adcode":"420111","address":f"演示路 {18+i*7} 号","distance":distance,"business_area":"南湖商圈" if i < max(1, count - 2) else "街道口商圈"})
        return items


class AmapServiceError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)
