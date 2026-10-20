#!/usr/bin/env python3
"""启动演示用的「故意有漏洞」Web 应用（仅监听 127.0.0.1:8899）。

用于体验通用 Web 渗透扫描功能：
    python scripts/demo_target.py
    python -m pentest_agent scan --target http://127.0.0.1:8899 --profile quick

或在 Web 工作台新建项目 http://127.0.0.1:8899，对 Agent 说 "扫描一下"。

注意：该演示应用仅用于本地教学，请勿部署到公网。
"""

from __future__ import annotations

import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tests.mock_vuln_app import MockVulnHandler  # noqa: E402

HOST, PORT = "127.0.0.1", 8899


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MockVulnHandler)
    print("=" * 58)
    print(f"  Demo vulnerable app: http://{HOST}:{PORT}")
    print("  仅用于本地教学演示，按 Ctrl+C 停止")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
