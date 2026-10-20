#!/usr/bin/env python3
"""演示用 MCP Server（stdio 传输）：给 Pentest Agent 的「扩展 → MCP」做联调 / 截图。

它实现 MCP 最常用的一小部分协议（换行分隔的 JSON-RPC 2.0）：

- ``initialize`` / ``notifications/initialized``
- ``ping``
- ``tools/list``
- ``tools/call``

提供的工具都是无副作用、纯本地的演示工具：

- ``echo``：回显文本（验证工具调用链路）
- ``now``：返回当前时间
- ``add``：两数相加
- ``wordlist``：返回一批常见 Web 路径（演示安全类工具怎么接入）

在「扩展 → MCP」里新增服务器，传输选 stdio，命令填::

    python /绝对路径/scripts/demo_mcp_server.py

即可测试连接并看到上面 4 个工具。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime

PROTOCOL_VERSION = "2024-11-05"

COMMON_PATHS = [
    "/admin",
    "/login",
    "/api",
    "/api/v1",
    "/backup.zip",
    "/.git/config",
    "/.env",
    "/robots.txt",
    "/sitemap.xml",
    "/swagger-ui.html",
]

TOOLS = [
    {
        "name": "echo",
        "description": "回显传入的文本，用于验证 MCP 工具调用链路是否正常。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "要回显的文本"}
            },
            "required": ["text"],
        },
    },
    {
        "name": "now",
        "description": "返回服务器当前时间（ISO 8601）。",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "add",
        "description": "计算两个数字之和。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "a": {"type": "number", "description": "第一个数"},
                "b": {"type": "number", "description": "第二个数"},
            },
            "required": ["a", "b"],
        },
    },
    {
        "name": "wordlist",
        "description": "返回一批常见 Web 路径，用于目录 / 敏感文件探测的候选列表。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "number", "description": "最多返回多少条", "default": 10}
            },
            "required": [],
        },
    },
]


def _send(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result(request_id, result: dict) -> None:
    _send({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def _call_tool(name: str, arguments: dict) -> dict:
    arguments = arguments or {}
    if name == "echo":
        text = f"echo: {arguments.get('text', '')}"
    elif name == "now":
        text = datetime.now().astimezone().isoformat(timespec="seconds")
    elif name == "add":
        try:
            total = float(arguments.get("a", 0)) + float(arguments.get("b", 0))
        except (TypeError, ValueError):
            return {
                "isError": True,
                "content": [{"type": "text", "text": "add 需要两个数字参数 a / b"}],
            }
        text = f"{arguments.get('a')} + {arguments.get('b')} = {total:g}"
    elif name == "wordlist":
        try:
            limit = int(arguments.get("limit") or len(COMMON_PATHS))
        except (TypeError, ValueError):
            limit = len(COMMON_PATHS)
        text = "\n".join(COMMON_PATHS[: max(1, min(limit, len(COMMON_PATHS)))])
    else:
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"未知工具：{name}"}],
        }
    return {"content": [{"type": "text", "text": text}]}


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        request_id = message.get("id")
        method = message.get("method")
        if request_id is None:  # 通知类消息，不需要响应
            continue
        if method == "initialize":
            _result(
                request_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "pentest-agent-demo-mcp", "version": "1.0.0"},
                },
            )
        elif method == "ping":
            _result(request_id, {})
        elif method == "tools/list":
            _result(request_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = message.get("params") or {}
            name = str(params.get("name") or "")
            arguments = params.get("arguments") or {}
            _result(request_id, _call_tool(name, arguments if isinstance(arguments, dict) else {}))
        else:
            _error(request_id, -32601, f"Method not found: {method}")


if __name__ == "__main__":
    main()
