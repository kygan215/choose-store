from backend.business_district import analyze_business_district, classify_business_type


def _features(**values):
    base = {"住宅":0,"教育":0,"商业":0,"零售生活":0,"餐饮娱乐":0,"商务办公":0,"产业园区":0,"交通":0,"医疗休闲":0,"竞品":0,"商圈集中度":0}
    base.update(values)
    return base


def test_all_business_type_rule_paths():
    cases = [
        ("社区生活型", _features(住宅=100,教育=90,零售生活=100,医疗休闲=70)),
        ("城市商业中心型", _features(商业=100,餐饮娱乐=100,交通=90,商务办公=20,商圈集中度=100)),
        ("区域商业型", _features(商业=90,餐饮娱乐=85,零售生活=80,住宅=75,交通=70)),
        ("写字楼商务型", _features(商务办公=100,餐饮娱乐=20,交通=35,商业=20)),
        ("校园学生型", _features(教育=100,餐饮娱乐=35,零售生活=35,交通=20)),
        ("交通枢纽型", _features(交通=100,餐饮娱乐=20,零售生活=20,商务办公=10)),
        ("文旅休闲型", _features(医疗休闲=100,餐饮娱乐=40,商业=20,交通=20)),
        ("产业园区型", _features(产业园区=100,商务办公=45,交通=50)),
    ]
    for expected, features in cases:
        assert classify_business_type(features, 100)["type"] == expected
    assert classify_business_type(_features(), 2)["type"] == "配套不足型"
    mixed = classify_business_type(_features(住宅=60,教育=60,商业=60,零售生活=60,餐饮娱乐=60,商务办公=60,交通=60,医疗休闲=60,商圈集中度=60), 100)
    assert mixed["type"] == "混合综合型"


def test_business_analysis_handles_empty_business_area_and_truncation():
    items = [{"category":"住宅","distance":300,"business_area":""} for _ in range(12)]
    result = analyze_business_district(items, truncated=True, failures=["交通查询失败"])
    assert result["business_area"]["name"] == "高德暂无明确商圈名称"
    assert result["confidence_level"] in {"中", "低"}
    assert result["truncation_flags"]["any"] is True
    assert result["warning_messages"]
