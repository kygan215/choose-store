import pytest

from backend.core import admin_match, amap_error, confidence_status, deduplicate_pois, distance_bucket, evaluate_candidate, map_headers, normalize_admin_name, normalize_store_name, parse_radius, safe_excel, score_candidate, split_store_name


def test_name_normalization_and_split():
    assert normalize_store_name("零食很忙（武汉南湖店）") == "零食很忙(武汉南湖店)"
    assert normalize_store_name("零食很忙-武汉南湖店") == "零食很忙武汉南湖店"
    assert split_store_name("零食很忙（武汉南湖店）") == ("零食很忙", "武汉南湖店")


def test_scoring_and_confidence():
    q={"name":"零食很忙武汉南湖店","city":"武汉市","district":"洪山区","address":"文治街32号"}
    c={"name":"零食很忙武汉南湖店","city":"武汉市","district":"洪山区","address":"文治街32号","type":"购物服务"}
    score,reasons=score_candidate(q,c)
    assert score == 95 and "品牌一致" in reasons
    assert confidence_status(score,20,True)=="高置信度"
    assert confidence_status(80,20,True)=="需要确认"
    assert confidence_status(50,20,True)=="低置信度"
    assert confidence_status(100,20,False)=="需要确认"
    parenthesized={"name":"零食很忙（武汉南湖店）","city":"","district":"","address":"","type":"高德输入提示"}
    score,reasons=score_candidate({"name":"零食很忙武汉南湖店","city":"","district":"","address":""},parenthesized)
    assert score == 55 and "标准化名称完全一致" in reasons


def test_huashanjun_unique_candidate_scores_90_with_full_breakdown():
    query = {"name":"零食很忙（武汉洪山联投花山郡店）","city":"武汉市","district":"洪山区","address":""}
    candidate = {"name":"零食很忙（武汉洪山联投花山郡店）","city":"武汉","district":"洪山","adcode":"420111","address":"严西湖路8号附137号","type":"购物服务;专卖店;专营店"}
    result = evaluate_candidate(query, candidate, unique_high_match=True)
    assert result["score"] == 90
    assert result["auto_confirm"] is True
    assert not result["conflicts"]
    assert "详细地址未填写：不加分、不扣分" in [x["label"] for x in result["breakdown"]]


def test_admin_normalization_adcode_and_conflicts():
    assert normalize_admin_name(" 湖北省 ") == "湖北"
    assert admin_match("武汉市", "武汉") is True
    assert admin_match("洪山区", "洪山") is True
    same_adcode = evaluate_candidate(
        {"name":"零食很忙南湖店","city":"武汉市","district":"洪山区","adcode":"420111","address":""},
        {"name":"零食很忙南湖店","city":"武汉","district":"洪山","adcode":"420111","address":"","type":"购物服务"},
    )
    assert "区县或 adcode 一致" in same_adcode["reasons"]
    city_conflict = evaluate_candidate(
        {"name":"零食很忙南湖店","city":"武汉市","district":"洪山区","address":""},
        {"name":"零食很忙南湖店","city":"长沙市","district":"洪山区","address":"","type":"购物服务"},
    )
    assert city_conflict["auto_confirm"] is False and any("城市" in x for x in city_conflict["conflicts"])
    district_conflict = evaluate_candidate(
        {"name":"零食很忙南湖店","city":"武汉市","district":"洪山区","address":""},
        {"name":"零食很忙南湖店","city":"武汉市","district":"武昌区","address":"","type":"购物服务"},
    )
    assert district_conflict["auto_confirm"] is False and any("区县" in x for x in district_conflict["conflicts"])


def test_branch_number_conflict_and_direct_municipality_fallback():
    result = evaluate_candidate(
        {"name":"零食很忙南湖店","city":"北京市","district":"朝阳区","address":""},
        {"name":"零食很忙南湖二店","city":"","province":"北京市","district":"朝阳","address":"","type":"购物服务"},
    )
    assert any("分店编号" in x for x in result["conflicts"])
    assert "城市一致" in result["reasons"]


def test_radius_parsing_sorting_dedup_and_limits():
    assert parse_radius("800", "米", [500, 1000]) == [500, 800, 1000]
    assert parse_radius("1.5", "公里", [500, 1000]) == [500, 1000, 1500]
    assert parse_radius("1", "公里", [500, 1000]) == [500, 1000]
    with pytest.raises(ValueError): parse_radius("abc", "米")
    with pytest.raises(ValueError): parse_radius("0", "米")
    with pytest.raises(ValueError): parse_radius("-1", "米")
    with pytest.raises(ValueError): parse_radius("50001", "米")
    with pytest.raises(ValueError): parse_radius("6000", "米", [100,200,300,400,500])


def test_distance_dedupe_and_mapping():
    assert distance_bucket(500,[500,1000,2000])=="0–500米"
    assert distance_bucket(501,[500,1000,2000])=="501–1000米"
    data=[{"id":"A","name":"x"},{"id":"A","name":"x2"},{"id":"","name":"同名","location":[1,2],"address":"地址"},{"id":"","name":"同名","location":[1,2],"address":"地址"}]
    assert len(deduplicate_pois(data))==2
    assert map_headers(["店名","市","门店地址"])=={"name":"店名","city":"市","address":"门店地址"}


def test_errors_and_excel_injection():
    assert amap_error("10004")[0]=="AMAP_RATE_LIMIT"
    assert safe_excel("=1+1")=="'=1+1"
    assert safe_excel("@SUM(A1)")=="'@SUM(A1)"
    assert safe_excel("正常")=="正常"
