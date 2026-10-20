#!/usr/bin/env python3
"""内置安全工具 MCP Server 的启动入口（兼容旧路径）。

真正的实现在 ``pentest_agent/mcp_server.py``：提供 DNS 解析、HTTP 探测、端口探测、
TLS 证书、hash/base64/URL 编解码、JWT 分析、作用域检查等**真实**安全工具。

在「扩展 → MCP 服务器」中新增：传输 stdio、命令 ``python3``、
参数 ``-m`` / ``pentest_agent`` / ``mcp-server``（或本脚本路径）即可。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pentest_agent.mcp_server import main  # noqa: E402

if __name__ == "__main__":
    main()
