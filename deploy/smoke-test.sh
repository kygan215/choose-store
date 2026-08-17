#!/usr/bin/env sh
set -eu

BASE_URL="${1:-http://127.0.0.1:90}"
echo "检查首页..."
curl -fsS "$BASE_URL/" >/dev/null
echo "检查健康状态..."
curl -fsS "$BASE_URL/api/health" | grep -q '"status":"ok"'
echo "检查匿名访问保护..."
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/analysis-jobs")"
[ "$code" = "401" ]
echo "HTTP 90、健康检查和登录保护均正常。"
