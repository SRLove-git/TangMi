"""内置安全工具 MCP Server 测试（真实工具，全部离线可跑）。

启动方式与 Web 界面一致：``python -m pentest_agent mcp-server``（stdio JSON-RPC）。
"""

from __future__ import annotations

import hashlib
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.extensions import MCPManager  # noqa: E402

EXPECTED_TOOLS = {
    "dns_lookup",
    "http_probe",
    "port_check",
    "tls_certificate",
    "hash_encode",
    "jwt_decode",
    "scope_check",
}


@pytest.fixture(scope="module")
def mcp(tmp_path_factory):
    root = tmp_path_factory.mktemp("mcp-real")
    manager = MCPManager(root)
    server = manager.upsert(
        {
            "name": "Pentest Agent Tools",
            "transport": "stdio",
            "command": sys.executable,
            "args": ["-m", "pentest_agent", "mcp-server"],
            "env": {"PYTHONPATH": str(Path(__file__).resolve().parents[1])},
            "enabled": True,
        }
    )
    yield manager, server["id"]
    manager.close_all()


@pytest.fixture()
def local_http():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("X-Demo-Server", "pentest-agent-test")
            self.end_headers()
            self.wfile.write(b"hello-from-local")

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_mcp_server_lists_real_security_tools(mcp):
    manager, server_id = mcp
    result = manager.test(server_id)
    assert result["ok"] is True
    assert result["server_info"]["serverInfo"]["name"] == "pentest-agent-tools"
    names = {tool["name"] for tool in result["tools"]}
    assert EXPECTED_TOOLS <= names
    # 不再是 echo/add 之类的玩具工具
    assert "echo" not in names and "add" not in names


def test_hash_encode_is_real(mcp):
    manager, server_id = mcp
    result = manager.call_tool(
        server_id, "hash_encode", {"text": "abc", "operation": "sha256"}
    )
    assert result["ok"] is True
    assert hashlib.sha256(b"abc").hexdigest() in result["text"]
    decoded = manager.call_tool(
        server_id, "hash_encode", {"text": "aGVsbG8=", "operation": "base64_decode"}
    )
    assert "hello" in decoded["text"]


def test_jwt_tool_detects_alg_none(mcp):
    manager, server_id = mcp
    token = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
        "eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ."
    )
    result = manager.call_tool(server_id, "jwt_decode", {"token": token})
    assert result["ok"] is True
    assert "alg=none" in result["text"]
    assert "admin" in result["text"]


def test_http_probe_local_target(mcp, local_http):
    manager, server_id = mcp
    result = manager.call_tool(server_id, "http_probe", {"url": local_http})
    assert result["ok"] is True
    assert "状态码：200" in result["text"]
    assert "hello-from-local" in result["text"]


def test_http_probe_rejects_public_target(mcp):
    manager, server_id = mcp
    result = manager.call_tool(server_id, "http_probe", {"url": "http://example.com/"})
    assert result["ok"] is False
    assert "作用域" in result["text"]


def test_port_check_real_socket(mcp, local_http):
    manager, server_id = mcp
    port = int(local_http.rsplit(":", 1)[1])
    result = manager.call_tool(
        server_id, "port_check", {"host": "127.0.0.1", "ports": [port]}
    )
    assert result["ok"] is True
    assert f"{port}/tcp open" in result["text"]


def test_port_check_rejects_public_host(mcp):
    manager, server_id = mcp
    result = manager.call_tool(
        server_id, "port_check", {"host": "8.8.8.8", "ports": [53]}
    )
    assert result["ok"] is False
    assert "作用域" in result["text"]


def test_scope_check_tool(mcp):
    manager, server_id = mcp
    allowed = manager.call_tool(
        server_id, "scope_check", {"url": "http://127.0.0.1:8899/"}
    )
    assert "在授权范围内" in allowed["text"]
    denied = manager.call_tool(
        server_id, "scope_check", {"url": "https://example.com/"}
    )
    assert "不在授权范围内" in denied["text"]


def test_dns_lookup_localhost(mcp):
    manager, server_id = mcp
    result = manager.call_tool(server_id, "dns_lookup", {"domain": "localhost"})
    assert result["ok"] is True
    assert "127.0.0.1" in result["text"] or "::1" in result["text"]


def test_agent_tools_include_real_mcp_tools(mcp):
    manager, _server_id = mcp
    bindings = manager.agent_tools()
    names = {binding["exposed_name"] for binding in bindings}
    assert "mcp__Pentest_Agent_Tools__hash_encode" in names
    assert "mcp__Pentest_Agent_Tools__http_probe" in names


def test_mcp_server_cli_registered():
    from pentest_agent.cli import build_parser

    args = build_parser().parse_args(["mcp-server"])
    assert args.command == "mcp-server"
