#!/usr/bin/env python3
"""启动内置演示靶场（真实可被利用的故意有漏洞 Web 应用，仅监听 127.0.0.1:8899）。

用于体验通用 Web 渗透扫描功能：
    python scripts/demo_target.py
    python -m pentest_agent demo              # 等价写法
    python -m pentest_agent scan --target http://127.0.0.1:8899 --profile full

或在 Web 工作台新建项目 http://127.0.0.1:8899，对 Agent 说 "扫描一下"。

注意：该演示应用真实包含命令执行、任意文件读取、模板求值等漏洞，
只能在本机回环地址使用，请勿部署到公网。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pentest_agent.labs.demo_webapp import DemoVulnApp  # noqa: E402

HOST, PORT = "127.0.0.1", 8899


def main() -> None:
    app = DemoVulnApp(host=HOST, port=PORT)
    print("=" * 58)
    print(f"  Demo vulnerable app: {app.base_url}")
    print("  真实漏洞：SQLi / 命令注入 / LFI / SSTI / SSRF / JWT alg=none")
    print("  仅用于本地教学演示，按 Ctrl+C 停止")
    print("=" * 58)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        app.close()


if __name__ == "__main__":
    main()
