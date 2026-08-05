from __future__ import annotations

import math
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Iterable

MATCH_WEIGHTS = {
    "name": 40, "brand": 10, "city": 15, "district": 15,
    "address": 10, "poi_type": 5, "unique_candidate": 5,
}
HIGH_THRESHOLD = 85
REVIEW_THRESHOLD = 65
AUTO_MARGIN = 15
ALIASES = {
    "赵一鸣零食": ["赵一鸣"], "零食很忙": ["很忙零食"],
    "好想来": [], "来优品": [], "老婆大人": [], "良品铺子": [],
}
STORE_SUFFIXES = ("旗舰店", "门店", "店")
ADMIN_SUFFIXES = (
    "维吾尔自治区", "壮族自治区", "回族自治区", "自治区", "特别行政区",
    "自治州", "市辖区", "地区", "盟", "省", "市", "区", "县",
)
DEFAULT_RADII = [500, 1000, 2000]
MAX_RADII = 5
MAX_AMAP_RADIUS = 50000


def normalize_store_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip().lower()
    value = re.sub(r"[（(\[【]", "(", value)
    value = re.sub(r"[）)\]】]", ")", value)
    value = re.sub(r"[\s_\-—·,，。.!！?？、;；:：]+", "", value)
    value = re.sub(r"([()])\1+", r"\1", value)
    return value


def scalar_text(value: Any) -> str:
    """Normalize Amap fields that may be empty, scalar, or a one-item array."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = next((x for x in value if x not in (None, "")), "")
    return unicodedata.normalize("NFKC", str(value)).strip()


def normalize_admin_name(value: Any) -> str:
    text = scalar_text(value)
    text = re.sub(r"[（）()\s]", "", text)
    changed = True
    while changed and text:
        changed = False
        for suffix in ADMIN_SUFFIXES:
            if text.endswith(suffix) and len(text) > len(suffix):
                text = text[: -len(suffix)]
                changed = True
                break
    return text.lower()


def admin_match(left: Any, right: Any) -> bool | None:
    a, b = normalize_admin_name(left), normalize_admin_name(right)
    if not a or not b:
        return None
    return a == b


def split_store_name(value: str) -> tuple[str, str]:
    name = normalize_store_name(value)
    for brand, variants in ALIASES.items():
        for token in (brand, *variants):
            token_norm = normalize_store_name(token)
            if name.startswith(token_norm):
                branch = name[len(token_norm):].strip("()")
                return brand, branch
    match = re.match(r"(.+?)(?:\((.+)\)|(.+?(?:店|门店|旗舰店)))$", name)
    return (match.group(1), match.group(2) or match.group(3)) if match else (name, "")


def _keywords(value: str) -> set[str]:
    return {x for x in re.split(r"[\s,，路街道号区县市()]+", value or "") if len(x) > 1}


def _address_score(query_address: str, candidate_address: str) -> tuple[int, str, bool]:
    query_address, candidate_address = scalar_text(query_address), scalar_text(candidate_address)
    if not query_address:
        return 0, "详细地址未填写：不加分、不扣分", False
    qn, cn = normalize_store_name(query_address), normalize_store_name(candidate_address)
    ratio = SequenceMatcher(None, qn, cn).ratio() if qn and cn else 0
    overlap = _keywords(query_address) & _keywords(candidate_address)
    if ratio >= .72 or len(overlap) >= 2:
        return 10, "详细地址高度一致", False
    if ratio >= .35 or overlap:
        return max(3, min(9, round(ratio * 10))), "详细地址部分一致", False
    return 0, "警告：候选地址与用户输入地址缺少共同关键词", True


def _branch_marker(value: str) -> str:
    _, branch = split_store_name(value)
    match = re.search(r"([一二三四五六七八九十百\d]+)(?:号)?店$", branch)
    return match.group(1) if match else ""


def evaluate_candidate(
    query: dict[str, Any],
    candidate: dict[str, Any],
    *,
    unique_high_match: bool = False,
) -> dict[str, Any]:
    score, breakdown, conflicts, warnings = 0, [], [], []

    def add(label: str, points: int, kind: str = "match") -> None:
        nonlocal score
        score += points
        breakdown.append({"label": label, "points": points, "kind": kind})

    qn = normalize_store_name(query.get("name", ""))
    cn = normalize_store_name(candidate.get("name", ""))
    qcompact, ccompact = qn.replace("(", "").replace(")", ""), cn.replace("(", "").replace(")", "")
    qb, qbranch = split_store_name(query.get("name", ""))
    cb, cbranch = split_store_name(candidate.get("name", ""))
    name_ratio = SequenceMatcher(None, qcompact, ccompact).ratio() if qcompact and ccompact else 0
    branch_ratio = SequenceMatcher(None, qbranch, cbranch).ratio() if qbranch and cbranch else 0
    if qcompact and qcompact == ccompact:
        add("标准化名称完全一致", 40)
        name_level = "exact"
    elif name_ratio >= .86 and (not qbranch or branch_ratio >= .72):
        add("名称高度相似且分店关键词一致", 35)
        name_level = "high"
    elif qb and qb == cb and name_ratio >= .58:
        points = max(25, min(34, round(25 + max(0, branch_ratio - .45) * 16)))
        add("品牌一致，分店名称部分一致", points)
        name_level = "partial"
    else:
        breakdown.append({"label": "门店名称相似度不足", "points": 0, "kind": "warning"})
        name_level = "low"

    if qb and cb and qb == cb:
        add("品牌一致", 10)
    elif qb and cb and qb != cb:
        conflicts.append("候选品牌与用户输入品牌不一致")

    query_city = query.get("city")
    candidate_city = candidate.get("city") or candidate.get("province")
    city_equal = admin_match(query_city, candidate_city)
    if city_equal is True:
        add("城市一致", 15)
    elif city_equal is False:
        conflicts.append("候选城市与用户输入城市不一致")
    else:
        breakdown.append({"label": "城市未提供或高德未返回：不加分、不扣分", "points": 0, "kind": "neutral"})

    query_adcode = scalar_text(query.get("adcode"))
    candidate_adcode = scalar_text(candidate.get("adcode"))
    district_equal: bool | None
    if query_adcode and candidate_adcode:
        district_equal = query_adcode == candidate_adcode
    else:
        district_equal = admin_match(query.get("district"), candidate.get("district"))
    if district_equal is True:
        add("区县或 adcode 一致", 15)
    elif district_equal is False:
        conflicts.append("候选区县与用户输入区县不一致")
    else:
        breakdown.append({"label": "区县未提供或高德未返回：不加分、不扣分", "points": 0, "kind": "neutral"})

    address_points, address_label, address_conflict = _address_score(query.get("address", ""), candidate.get("address", ""))
    add(address_label, address_points, "match" if address_points else "neutral")
    if address_conflict:
        warnings.append(address_label.replace("警告：", ""))

    if any(x in scalar_text(candidate.get("type")) for x in ("购物", "零售", "便利", "餐饮", "高德输入提示")):
        add("POI 类型合理", 5)

    qmarker, cmarker = _branch_marker(query.get("name", "")), _branch_marker(candidate.get("name", ""))
    if qmarker != cmarker and (qmarker or cmarker):
        conflicts.append("分店编号或二店、三店等标识不一致")

    if unique_high_match and query_city and name_level in {"exact", "high"} and qb == cb and not conflicts:
        add("城市限制后只有一个高匹配候选", 5)

    score = min(100, score)
    auto_confirm = (
        score >= HIGH_THRESHOLD
        and name_level in {"exact", "high"}
        and city_equal is True
        and district_equal is not False
        and not conflicts
    )
    return {
        "score": score,
        "breakdown": breakdown,
        "reasons": [x["label"] for x in breakdown if x["points"] > 0],
        "conflicts": conflicts,
        "warnings": warnings,
        "name_level": name_level,
        "auto_confirm": auto_confirm,
    }


def score_candidate(query: dict[str, Any], candidate: dict[str, Any]) -> tuple[int, list[str]]:
    result = evaluate_candidate(query, candidate)
    return result["score"], result["reasons"]


def confidence_status(score: int, margin: int = 0, city_provided: bool = True) -> str:
    if score >= HIGH_THRESHOLD and margin >= AUTO_MARGIN and city_provided:
        return "高置信度"
    if score >= REVIEW_THRESHOLD:
        return "需要确认"
    return "低置信度"


def distance_bucket(distance: float, radii: Iterable[int]) -> str:
    lower = 0
    for upper in sorted(set(radii)):
        if distance <= upper:
            return f"{lower if lower == 0 else lower + 1}–{upper}米"
        lower = upper
    return f">{lower}米"


def parse_radius(value: Any, unit: str, selected: Iterable[int] = ()) -> list[int]:
    text = scalar_text(value)
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", text):
        raise ValueError("请输入大于 0 的数字；公里最多保留两位小数")
    number = float(text)
    if number <= 0:
        raise ValueError("搜索半径必须大于 0")
    if unit == "米":
        if not number.is_integer():
            raise ValueError("以米为单位时请输入正整数")
        meters = int(number)
    elif unit == "公里":
        meters = round(number * 1000)
    else:
        raise ValueError("半径单位只能是米或公里")
    if meters > MAX_AMAP_RADIUS:
        raise ValueError("搜索半径不能超过高德接口上限 50 公里")
    result = sorted(set([*map(int, selected), meters]))
    if len(result) > MAX_RADII:
        raise ValueError("最多同时选择 5 个搜索半径")
    return result


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> int:
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    x = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lng2-lng1)/2)**2
    return round(6371000 * 2 * math.asin(math.sqrt(x)))


def deduplicate_pois(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, result = set(), []
    for item in items:
        location = item.get("location") or [None, None]
        key = item.get("id") or (
            normalize_store_name(item.get("name", "")),
            tuple(location),
            normalize_store_name(item.get("address", "")),
        )
        if key not in seen:
            seen.add(key); result.append(item)
    return result


def safe_excel(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


HEADER_ALIASES = {
    "name": {"门店名称", "店名", "门店", "门店全称", "客户门店"},
    "province": {"省份", "省"},
    "city": {"城市", "市"},
    "district": {"区县", "区", "县"},
    "address": {"详细地址", "门店地址", "收货地址"},
    "code": {"门店编号", "门店编码", "编号"},
    "brand": {"品牌"},
    "remark": {"备注"},
}


def map_headers(headers: list[str]) -> dict[str, str]:
    result = {}
    normalized = {normalize_store_name(h): h for h in headers}
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if normalize_store_name(alias) in normalized:
                result[field] = normalized[normalize_store_name(alias)]
                break
    return result


AMAP_ERRORS = {
    "10001": ("AMAP_INVALID_KEY", "高德地图 Key 无效，请检查 Web 服务 Key"),
    "10003": ("AMAP_DAILY_LIMIT", "高德地图接口当日调用量已达上限"),
    "10004": ("AMAP_RATE_LIMIT", "高德地图接口调用频率受限，请稍后重试"),
    "10009": ("AMAP_KEY_TYPE_ERROR", "高德 Key 类型不正确，请使用 Web 服务 Key"),
}


def amap_error(infocode: str, info: str = "") -> tuple[str, str]:
    return AMAP_ERRORS.get(str(infocode), ("AMAP_ERROR", f"高德地图服务暂时不可用：{info or infocode}"))
