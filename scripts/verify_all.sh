#!/usr/bin/env bash
# 一键验收：启动靶场 -> 全量解题 -> 生成报告
set -euo pipefail
cd "$(dirname "$0")/.."

PY=".venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "==> 1/3 启动靶场（首次会构建/拉取镜像）"
"$PY" -m pentest_agent labs up

echo "==> 2/3 全量自动验证（DVWA 76 关 + SQLi-Labs 69 关）"
set +e
"$PY" -m pentest_agent verify --report-dir reports
CODE=$?
set -e

echo "==> 3/3 报告位置"
ls -lh reports/pentest_report.md reports/pentest_results.json 2>/dev/null || true
exit $CODE
