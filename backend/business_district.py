from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

ALGORITHM_VERSION = "business-district-1.1.0"
POI_CONFIG_VERSION = "amap-feature-pack-2026-08"
WEIGHT_VERSION = "snack-family-fit-1.0"
DEFAULT_BUSINESS_RADII = [500, 1000, 2000]
DISCLAIMER = (
    "本分析基于高德POI点位、分类、距离和商圈字段生成，仅反映周边设施与商业配套分布，"
    "不等同于真实人口、客流、居民收入、消费能力或销售预测。POI可能存在遗漏、更新延迟或查询上限。"
)

AUDIENCE_DISCLAIMER = (
    "潜在人群画像由周边POI环境代理推断，不是手机信令、人口普查、会员或订单数据。"
    "年龄段指数不代表人数占比，消费能力等级不代表居民真实收入或实际客单价。"
)

FEATURE_PACK = {
    "住宅": {"types": "120300", "keywords": ""},
    "教育": {"types": "141200", "keywords": ""},
    "商业": {"types": "060100", "keywords": ""},
    "零售生活": {"types": "060200|060400|060700|090601", "keywords": ""},
    "餐饮娱乐": {"types": "050000|080000", "keywords": ""},
    "商务办公": {"types": "120200|170000|160000|100000", "keywords": ""},
    "产业园区": {"types": "", "keywords": "产业园|工业园|科技园|工厂"},
    "交通": {"types": "150000", "keywords": ""},
    "医疗休闲": {"types": "090000|110000", "keywords": ""},
    "竞品": {"types": "", "keywords": "零食很忙|赵一鸣零食|好想来|来优品|老婆大人|良品铺子"},
}

TYPE_RULES = {
    "社区生活型": {"住宅": 35, "教育": 20, "零售生活": 25, "医疗休闲": 10, "商业": 10},
    "城市商业中心型": {"商业": 30, "餐饮娱乐": 25, "交通": 15, "商务办公": 10, "商圈集中度": 20},
    "区域商业型": {"商业": 25, "餐饮娱乐": 25, "零售生活": 20, "住宅": 15, "交通": 15},
    "写字楼商务型": {"商务办公": 45, "餐饮娱乐": 20, "交通": 20, "商业": 15},
    "校园学生型": {"教育": 45, "餐饮娱乐": 20, "零售生活": 20, "交通": 15},
    "交通枢纽型": {"交通": 55, "餐饮娱乐": 15, "零售生活": 15, "商务办公": 15},
    "文旅休闲型": {"医疗休闲": 45, "餐饮娱乐": 25, "商业": 15, "交通": 15},
    "产业园区型": {"产业园区": 60, "商务办公": 20, "交通": 20},
}

FEATURE_TARGETS_1KM = {
    "住宅": 24, "教育": 16, "商业": 8, "零售生活": 35,
    "餐饮娱乐": 60, "商务办公": 35, "产业园区": 8, "交通": 25, "医疗休闲": 18, "竞品": 8,
}

LEVEL_WEIGHTS = {
    "商业设施密度": 25, "大型商业设施数量": 20, "餐饮和零售丰富度": 15,
    "交通便利程度": 15, "住宅及客群基础": 10, "教育医疗休闲配套": 10, "商圈名称集中程度": 5,
}

FIT_WEIGHTS = {"住宅": 30, "幼儿园": 20, "小学": 20, "商业": 10, "零售生活": 10, "交通": 10}


def _cap(value: float, target: float) -> float:
    return round(min(100.0, max(0.0, value / max(target, .001) * 100)), 2)


def _circle_area_km2(radius: int) -> float:
    return math.pi * (radius / 1000) ** 2


def _cumulative(items: Iterable[dict[str, Any]], category: str, radius: int) -> list[dict[str, Any]]:
    return [x for x in items if x.get("category") == category and float(x.get("distance") or 0) <= radius]


def build_feature_vector(items: list[dict[str, Any]], radii: list[int] | None = None) -> dict[str, Any]:
    radii = sorted(set(radii or DEFAULT_BUSINESS_RADII))
    layers: dict[str, dict[str, Any]] = {}
    for radius in radii:
        counts = {category: len(_cumulative(items, category, radius)) for category in FEATURE_PACK}
        total = sum(counts.values())
        layers[str(radius)] = {
            "radius": radius,
            "total": total,
            "density": round(total / _circle_area_km2(radius), 2),
            "counts": counts,
            "shares": {key: round(value / total * 100, 2) if total else 0 for key, value in counts.items()},
            "nearest": {
                category: min((int(x.get("distance") or 0) for x in _cumulative(items, category, radius)), default=None)
                for category in FEATURE_PACK
            },
        }
    return {"radii": radii, "layers": layers}


def identify_business_area(items: list[dict[str, Any]]) -> dict[str, Any]:
    weights: dict[str, float] = defaultdict(float)
    counts: Counter[str] = Counter()
    valid = 0
    for item in items:
        name = str(item.get("business_area") or "").strip()
        if not name:
            continue
        valid += 1
        distance = max(0, float(item.get("distance") or 0))
        weights[name] += 1 / (1 + distance / 500)
        counts[name] += 1
    if not valid:
        return {"name": "高德暂无明确商圈名称", "source": "高德 business_area", "valid": 0, "count": 0, "share": 0, "confidence": "低"}
    name = max(weights, key=weights.get)
    share = round(weights[name] / sum(weights.values()) * 100, 1)
    confidence = "高" if share >= 60 and valid >= 20 else "中" if share >= 35 and valid >= 8 else "低"
    return {"name": name, "source": "高德 business_area", "valid": valid, "count": counts[name], "share": share, "confidence": confidence}


def _normalized_features(vector: dict[str, Any], business_share: float) -> dict[str, float]:
    layers = vector["layers"]
    one_key = str(min(vector["radii"], key=lambda x: abs(x - 1000)))
    counts = layers[one_key]["counts"]
    result = {name: _cap(counts.get(name, 0), target) for name, target in FEATURE_TARGETS_1KM.items()}
    result["商圈集中度"] = float(business_share)
    return result


def classify_business_type(normalized: dict[str, float], total_1km: int) -> dict[str, Any]:
    if total_1km < 8:
        return {"type": "配套不足型", "scores": {"配套不足型": 100}, "confidence": "低", "margin": 100}
    scores = {
        name: round(sum(normalized.get(feature, 0) * weight / 100 for feature, weight in weights.items()), 2)
        for name, weights in TYPE_RULES.items()
    }
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    margin = round(ranked[0][1] - ranked[1][1], 2)
    result_type = "混合综合型" if margin < 8 else ranked[0][0]
    confidence = "高" if margin >= 18 else "中" if margin >= 8 else "低"
    return {"type": result_type, "scores": scores, "confidence": confidence, "margin": margin}


def score_level(vector: dict[str, Any], normalized: dict[str, float], business_share: float) -> dict[str, Any]:
    one_key = str(min(vector["radii"], key=lambda x: abs(x - 1000)))
    layer = vector["layers"][one_key]
    c = layer["counts"]
    indicators = {
        "商业设施密度": _cap((c.get("商业", 0) + c.get("零售生活", 0) + c.get("餐饮娱乐", 0)) / _circle_area_km2(layer["radius"]), 140),
        "大型商业设施数量": normalized.get("商业", 0),
        "餐饮和零售丰富度": (normalized.get("餐饮娱乐", 0) + normalized.get("零售生活", 0)) / 2,
        "交通便利程度": normalized.get("交通", 0),
        "住宅及客群基础": normalized.get("住宅", 0),
        "教育医疗休闲配套": (normalized.get("教育", 0) + normalized.get("医疗休闲", 0)) / 2,
        "商圈名称集中程度": business_share,
    }
    score = round(sum(indicators[key] * weight / 100 for key, weight in LEVEL_WEIGHTS.items()), 1)
    level = "S" if score >= 85 else "A" if score >= 70 else "B" if score >= 55 else "C" if score >= 35 else "D"
    return {"level": level, "score": score, "mode": "固定POI规则初步评级", "indicators": indicators}


def score_competition(vector: dict[str, Any]) -> dict[str, Any]:
    layers = vector["layers"]
    r500 = layers[str(min(vector["radii"], key=lambda x: abs(x - 500)))]
    r1000 = layers[str(min(vector["radii"], key=lambda x: abs(x - 1000)))]
    c500, c1000 = r500["counts"].get("竞品", 0), r1000["counts"].get("竞品", 0)
    nearest = r1000["nearest"].get("竞品")
    score = min(100, c500 * 18 + max(0, c1000 - c500) * 8 + (25 if nearest is not None and nearest <= 300 else 10 if nearest is not None and nearest <= 600 else 0))
    level = "高" if score >= 75 else "较高" if score >= 50 else "中等" if score >= 25 else "低"
    return {"score": score, "level": level, "count_500m": c500, "count_1km": c1000, "nearest": nearest}


def score_fit(vector: dict[str, Any], normalized: dict[str, float], competition_score: float) -> dict[str, Any]:
    one_key = str(min(vector["radii"], key=lambda x: abs(x - 1000)))
    counts = vector["layers"][one_key]["counts"]
    components = {
        "住宅": normalized.get("住宅", 0),
        "幼儿园": _cap(counts.get("教育", 0), 8),
        "小学": _cap(counts.get("教育", 0), 10),
        "商业": normalized.get("商业", 0),
        "零售生活": normalized.get("零售生活", 0),
        "交通": normalized.get("交通", 0),
    }
    base = sum(components[key] * weight / 100 for key, weight in FIT_WEIGHTS.items())
    penalty = min(15, competition_score * .15)
    score = round(max(0, min(100, base - penalty)), 1)
    level = "高适配" if score >= 85 else "较高适配" if score >= 70 else "一般适配" if score >= 55 else "较低适配" if score >= 40 else "低适配"
    return {"score": score, "level": level, "components": components, "competition_penalty": round(penalty, 1)}


def infer_audience_profile(items: list[dict[str, Any]], vector: dict[str, Any], normalized: dict[str, float]) -> dict[str, Any]:
    """Build an explainable environmental proxy profile without claiming demographic facts."""
    one_key = str(min(vector["radii"], key=lambda x: abs(x - 1000)))
    counts = vector["layers"][one_key]["counts"]
    nearby_names = [
        str(item.get("name") or "")
        for item in items
        if float(item.get("distance") or 0) <= 2000
    ]
    joined_names = "|".join(nearby_names)
    university_hits = sum(word in joined_names for word in ("大学", "学院", "职业技术", "校区"))
    family_hits = sum(word in joined_names for word in ("幼儿园", "小学", "中学", "实验学校"))
    premium_hits = sum(word in joined_names for word in ("万象城", "恒隆", "国金", "天地", "太古", "大悦城", "天街"))
    regional_mall_hits = sum(word in joined_names for word in ("万达广场", "购物中心", "广场", "百货", "奥特莱斯", "银泰", "武商"))
    value_hits = sum(word in joined_names for word in ("批发", "农贸", "折扣", "平价", "集贸"))

    def weighted(*parts: tuple[float, float]) -> float:
        return round(min(100.0, max(0.0, sum(value * weight for value, weight in parts))), 1)

    age_segments = [
        {
            "label": "学龄家庭",
            "age_range": "家长约28–45岁，儿童约3–17岁",
            "index": weighted((normalized.get("住宅", 0), .42), (normalized.get("教育", 0), .48), (min(100, family_hits * 20), .10)),
            "basis": "住宅与学校、幼儿园等教育设施共同出现",
        },
        {
            "label": "青年学生",
            "age_range": "约18–24岁",
            "index": weighted((normalized.get("教育", 0), .42), (normalized.get("餐饮娱乐", 0), .23), (normalized.get("交通", 0), .20), (min(100, university_hits * 30), .15)),
            "basis": "高校线索以及餐饮、交通配套共同出现",
        },
        {
            "label": "青年职场人群",
            "age_range": "约22–35岁",
            "index": weighted((normalized.get("商务办公", 0), .43), (normalized.get("产业园区", 0), .17), (normalized.get("交通", 0), .22), (normalized.get("餐饮娱乐", 0), .18)),
            "basis": "办公、产业园、通勤交通与餐饮密度",
        },
        {
            "label": "稳定家庭居民",
            "age_range": "约30–49岁",
            "index": weighted((normalized.get("住宅", 0), .48), (normalized.get("零售生活", 0), .22), (normalized.get("教育", 0), .15), (normalized.get("医疗休闲", 0), .15)),
            "basis": "住宅基础与日常零售、教育、医疗休闲配套",
        },
        {
            "label": "成熟社区居民",
            "age_range": "约45岁以上",
            "index": weighted((normalized.get("住宅", 0), .45), (normalized.get("医疗休闲", 0), .35), (normalized.get("零售生活", 0), .20)),
            "basis": "住宅与医疗、休闲及生活服务设施",
        },
    ]
    age_segments.sort(key=lambda item: item["index"], reverse=True)

    consumption_index = weighted(
        (normalized.get("商业", 0), .24),
        (normalized.get("餐饮娱乐", 0), .18),
        (normalized.get("商务办公", 0), .22),
        (normalized.get("零售生活", 0), .16),
        (normalized.get("交通", 0), .10),
        (min(100, premium_hits * 35 + regional_mall_hits * 12 - value_hits * 10), .10),
    )
    if consumption_index >= 70:
        consumption_level = "中高消费环境倾向"
    elif consumption_index >= 45:
        consumption_level = "大众稳定消费环境"
    else:
        consumption_level = "基础型、价格敏感环境倾向"

    mall_items = [
        item for item in items
        if item.get("category") == "商业" and float(item.get("distance") or 0) <= 2000
    ]
    mall_names = list(dict.fromkeys(str(item.get("name") or "") for item in mall_items if item.get("name")))[:8]
    if premium_hits:
        mall_level = "中高端商业线索"
    elif regional_mall_hits >= 2 or len(mall_items) >= 5:
        mall_level = "区域综合型商业线索"
    elif mall_items:
        mall_level = "社区型或大众商业线索"
    else:
        mall_level = "暂无足够商场样本"
    mall_confidence = "中" if premium_hits or regional_mall_hits >= 2 or len(mall_items) >= 5 else "低"

    profile_confidence = "中" if counts.get("住宅", 0) >= 8 and sum(counts.values()) >= 30 else "低"
    leaders = age_segments[:2]
    summary = [
        f"周边潜在人群更偏向{leaders[0]['label']}（{leaders[0]['age_range']}）与{leaders[1]['label']}（{leaders[1]['age_range']}）。",
        f"消费环境代理判断为“{consumption_level}”，指数 {consumption_index}/100。",
        f"商场档次代理判断为“{mall_level}”，该结论不是高德官方评级。",
    ]
    return {
        "method": "POI环境代理模型（规则推断）",
        "confidence": profile_confidence,
        "primary_groups": leaders,
        "age_segments": age_segments,
        "consumption_power": {
            "level": consumption_level,
            "index": consumption_index,
            "confidence": profile_confidence,
            "basis": "商业、餐饮、办公、生活零售、交通及商场品牌线索的组合指数",
        },
        "mall_profile": {
            "level": mall_level,
            "confidence": mall_confidence,
            "sample_count": len(mall_items),
            "sample_names": mall_names,
            "basis": "购物中心数量、名称中的品牌与业态线索；不含官方商场等级",
        },
        "summary": summary,
        "evidence": [
            f"约1公里内住宅类POI {counts.get('住宅', 0)} 个、教育类POI {counts.get('教育', 0)} 个",
            f"约1公里内办公类POI {counts.get('商务办公', 0)} 个、交通类POI {counts.get('交通', 0)} 个",
            f"2公里内纳入判断的商业POI {len(mall_items)} 个",
        ],
        "limitations": [AUDIENCE_DISCLAIMER, "未接入住宅房价、建成年代、手机信令、会员、订单或SKU销售数据。"],
    }


def analyze_business_district(
    items: list[dict[str, Any]],
    *,
    radii: list[int] | None = None,
    location_confirmed: bool = True,
    truncated: bool = False,
    failures: list[str] | None = None,
) -> dict[str, Any]:
    vector = build_feature_vector(items, radii)
    area = identify_business_area(items)
    one_key = str(min(vector["radii"], key=lambda x: abs(x - 1000)))
    normalized = _normalized_features(vector, area["share"])
    type_result = classify_business_type(normalized, vector["layers"][one_key]["total"])
    level = score_level(vector, normalized, area["share"])
    competition = score_competition(vector)
    fit = score_fit(vector, normalized, competition["score"])
    audience_profile = infer_audience_profile(items, vector, normalized)
    vector["level_indicators"] = level["indicators"]
    vector["fit_components"] = fit["components"]
    vector["competition"] = competition
    vector["audience_profile"] = audience_profile
    warnings = list(failures or [])
    confidence_points = 100
    if not location_confirmed:
        confidence_points -= 30; warnings.append("门店位置尚未人工确认")
    if truncated:
        confidence_points -= 25; warnings.append("部分POI达到查询上限，结果可能截断")
    if area["confidence"] == "低":
        confidence_points -= 15; warnings.append("高德商圈名称字段有效率或集中度较低")
    if failures:
        confidence_points -= min(30, len(failures) * 10)
    if type_result["confidence"] == "低":
        confidence_points -= 10; warnings.append("商圈类型第一名与第二名差距较小或样本不足")
    confidence = "高" if confidence_points >= 80 else "中" if confidence_points >= 55 else "低"
    strengths = []
    weaknesses = []
    counts = vector["layers"][one_key]["counts"]
    for name, value in sorted(counts.items(), key=lambda x: x[1], reverse=True)[:3]:
        strengths.append(f"约1公里圈层内{name}类POI {value} 个")
    for name in ("住宅", "教育", "商业", "交通"):
        if normalized.get(name, 0) < 35:
            weaknesses.append(f"{name}类配套相对有限")
    return {
        "analysis_version": ALGORITHM_VERSION,
        "poi_config_version": POI_CONFIG_VERSION,
        "weight_version": WEIGHT_VERSION,
        "amap_query_time": datetime.now(timezone.utc).isoformat(),
        "radius_config": vector["radii"],
        "business_area": area,
        "business_district_type": type_result,
        "level": level,
        "fit": fit,
        "competition": competition,
        "audience_profile": audience_profile,
        "confidence_level": confidence,
        "feature_vector": vector,
        "normalized_features": normalized,
        "evidence": strengths,
        "strengths": strengths,
        "weaknesses": weaknesses[:3],
        "truncation_flags": {"any": truncated},
        "warning_messages": warnings,
        "disclaimer": DISCLAIMER,
    }


def public_config() -> dict[str, Any]:
    return {
        "analysis_version": ALGORITHM_VERSION,
        "poi_config_version": POI_CONFIG_VERSION,
        "weight_version": WEIGHT_VERSION,
        "default_radii": DEFAULT_BUSINESS_RADII,
        "feature_pack": FEATURE_PACK,
        "type_rules": TYPE_RULES,
        "level_weights": LEVEL_WEIGHTS,
        "fit_weights": FIT_WEIGHTS,
        "disclaimer": DISCLAIMER,
    }
