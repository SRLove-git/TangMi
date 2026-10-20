#!/usr/bin/env bash
# Pentest Agent 一键启动（macOS / Linux）
# 用法:
#   ./scripts/start.sh                 启动 Web 平台（http://127.0.0.1:8777）
#   ./scripts/start.sh --with-labs     同时拉起 DVWA / SQLi-Labs
#   ./scripts/start.sh --with-demo     同时启动演示漏洞站（127.0.0.1:8899）
#   ./scripts/start.sh --no-browser    不自动打开浏览器
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON=".venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  echo "[*] 创建虚拟环境 .venv ..."
  python3 -m venv .venv
  "$PYTHON" -m pip install -q --upgrade pip
  "$PYTHON" -m pip install -q -r requirements.txt
fi
"$PYTHON" -m pip install -q -r requirements.txt

WITH_LABS=0
WITH_DEMO=0
NO_BROWSER=""
for arg in "$@"; do
  case "$arg" in
    --with-labs) WITH_LABS=1 ;;
    --with-demo) WITH_DEMO=1 ;;
    --no-browser) NO_BROWSER="--no-browser" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  esac
done

if [ ! -d web/dist ]; then
  echo "[*] 前端尚未构建，尝试构建 ..."
  (cd web && npm install --no-audit --no-fund && npm run build)
fi

if [ "$WITH_DEMO" = "1" ]; then
  echo "[*] 启动演示漏洞站 http://127.0.0.1:8899（真实漏洞靶场）"
  "$PYTHON" -m pentest_agent demo >/tmp/pentest_demo_target.log 2>&1 &
fi
if [ "$WITH_LABS" = "1" ]; then
  echo "[*] 启动本地靶场（DVWA / SQLi-Labs）"
  "$PYTHON" -m pentest_agent labs up || true
fi

if [ ! -d web/dist ]; then
  echo "[!] web/dist 构建失败，后端会提示 503。请在 web/ 下执行 npm install && npm run build"
fi

echo "[*] 启动 Pentest Agent Web 平台： http://127.0.0.1:8777"
exec "$PYTHON" -m pentest_agent web $NO_BROWSER
