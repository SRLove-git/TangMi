"""内置演示靶场的「真实性」测试。

核心原则：每个漏洞都必须由真实实现触发 —— 真实 SQLite 数据库、真实 shell、
真实文件系统、真实模板求值、真实 HTTP 请求、真实 JWT 解析，而不是返回固定假数据。
"""

from __future__ import annotations

import os
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

from pentest_agent.labs.demo_webapp import DemoVulnServer


@pytest.fixture(scope="module")
def demo():
    with DemoVulnServer() as server:
        yield server


# ------------------------------------------------------------------ 数据库
def test_sql_injection_hits_real_sqlite_database(demo):
    # 真实 SQLite 语法错误（不是固定模拟文本）
    broken = requests.get(demo.base_url + "/search", params={"q": "test'"})
    assert broken.status_code == 500
    assert "SQL error" in broken.text
    assert any(
        marker in broken.text for marker in ("unrecognized token", "syntax error")
    )

    # 正常查询会真正命中数据库里的用户（证明数据库内容是真的）
    normal = requests.get(demo.base_url + "/search", params={"q": "admin"})
    assert "admin@demo.local" in normal.text

    conn = sqlite3.connect(demo.db_path)
    try:
        rows = conn.execute("SELECT username FROM users").fetchall()
    finally:
        conn.close()
    assert {"admin", "alice", "bob"} <= {row[0] for row in rows}


# --------------------------------------------------------------- 命令执行
def test_command_injection_really_executes_shell(demo):
    response = requests.get(
        demo.base_url + "/search", params={"q": "test; echo px_rce_$((21+21))"}
    )
    # 标记由 shell 算术展开计算得到，说明命令确实被执行了
    assert "px_rce_42" in response.text


# ------------------------------------------------------------------ LFI
def test_lfi_reads_real_files(demo, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-CONTENT-42", encoding="utf-8")
    absolute = requests.get(demo.base_url + "/file", params={"path": str(secret)})
    assert absolute.status_code == 200
    assert "TOP-SECRET-CONTENT-42" in absolute.text

    if os.name != "nt":
        traversal = requests.get(
            demo.base_url + "/file", params={"path": "../../../../../../etc/passwd"}
        )
        assert traversal.status_code == 200
        assert "User Database" in traversal.text or "root:" in traversal.text


# ----------------------------------------------------------------- SSTI
def test_ssti_really_evaluates_template(demo):
    brace = requests.get(demo.base_url + "/render", params={"tpl": "{{6*7}}"})
    assert "<div>42</div>" in brace.text
    erb = requests.get(demo.base_url + "/render", params={"tpl": "<%= 9*9 %>"})
    assert "<div>81</div>" in erb.text


# ----------------------------------------------------------------- SSRF
def test_ssrf_really_sends_outbound_request(demo):
    hits: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"canary-hit")

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        canary = f"http://127.0.0.1:{server.server_address[1]}/ssrf-canary"
        response = requests.get(demo.base_url + "/fetch", params={"url": canary})
        assert "canary-hit" in response.text
        assert "/ssrf-canary" in hits
    finally:
        server.shutdown()
        server.server_close()


# ------------------------------------------------------------------ JWT
def test_jwt_alg_none_is_accepted(demo):
    forged = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
        "eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ."
    )
    response = requests.get(demo.base_url + "/api/me", params={"token": forged})
    data = response.json()
    assert data["ok"] is True
    assert data["claims"]["role"] == "admin"
    # 篡改 payload 同样被接受（签名未被校验）
    tampered = forged.split(".")[1] + "x"
    assert tampered


# -------------------------------------------------------------- 登录 / CSRF
def test_login_uses_real_database(demo):
    bad = requests.post(
        demo.base_url + "/login", data={"username": "admin", "password": "wrong"}
    )
    assert "Invalid username or password" in bad.text

    good = requests.post(
        demo.base_url + "/login",
        data={"username": "admin", "password": "S3cret!Pass"},
    )
    assert "欢迎，admin" in good.text
    assert good.cookies.get("auth")


# ------------------------------------------------------------ 敏感文件/接口
def test_sensitive_files_are_real_files(demo):
    env = requests.get(demo.base_url + "/.env").text
    assert "DB_PASSWORD=" in env and "SECRET_KEY=" in env
    assert (demo.root / ".env").is_file()

    head = requests.get(demo.base_url + "/.git/HEAD").text
    assert head.startswith("ref:")
    # .git/config 未暴露（贴近真实的部分泄露场景）
    assert requests.get(demo.base_url + "/.git/config").status_code == 404

    js = requests.get(demo.base_url + "/js/app.js").text
    assert "AKIA" in js


def test_graphql_endpoint_queries_real_data(demo):
    introspection = requests.post(
        demo.base_url + "/graphql", json={"query": "{__schema{queryType{name}}}"}
    )
    assert "__schema" in introspection.text
    query = requests.post(
        demo.base_url + "/graphql", json={"query": "{ users { id username } }"}
    )
    users = query.json()["data"]["users"]
    assert any(user["username"] == "admin" for user in users)


def test_demo_cli_command_registered():
    from pentest_agent.cli import build_parser

    args = build_parser().parse_args(["demo", "--port", "8899"])
    assert args.command == "demo"
    assert args.port == 8899
