"""关卡上下文采集 / 源码对照测试（HTTP 用 FakeClient，不访问真实靶场）。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web import lab_context  # noqa: E402
from pentest_agent.web.server import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

DVWA_LOGIN_HTML = """
<html><body>
<form method="POST" action="login.php">
  <input type="hidden" name="user_token" value="tok123">
  <input type="text" name="username">
  <input type="password" name="password">
</form>
</body></html>
"""

DVWA_MODULE_HTML = """
<html><head><title>Vulnerability: SQL Injection</title></head>
<body>
<h1>Vulnerability: SQL Injection</h1>
<form method="GET" action="#">
  <input type="text" name="id" value="1">
  <input type="submit" name="Submit" value="Submit">
</form>
<a href="?id=1&Submit=Submit">link</a>
<div>You have an error in your SQL syntax near ''1'''</div>
</body></html>
"""

SQLI_HTML = """
<html><head><title>Less-5</title></head>
<body>
<form method="GET" action="">
  <input type="text" name="id" value="1">
</form>
<p>You are in ...</p>
</body></html>
"""


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code


class FakeClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.cookies: dict[str, str] = {}
        self.closed = False
        self.posts: list[tuple[str, dict]] = []

    def get_text(self, path: str) -> str:
        if path == "/login.php":
            return DVWA_LOGIN_HTML
        if path == "/index.php":
            return "<html>logged in as admin</html>"
        return "<html></html>"

    def extract_hidden(self, text: str, name: str = "user_token") -> str | None:
        import re

        match = re.search(
            rf'<input[^>]*name="{name}"[^>]*value="([^"]+)"', text, re.IGNORECASE
        )
        return match.group(1) if match else None

    def post(self, path: str, data: dict | None = None, **kwargs):
        self.posts.append((path, data or {}))
        return FakeResponse("<html>ok</html>")

    def get(self, path: str, params: dict | None = None, **kwargs):
        if "/vulnerabilities/" in path:
            return FakeResponse(DVWA_MODULE_HTML)
        return FakeResponse(SQLI_HTML)

    def set_cookie(self, name: str, value: str, domain=None, path: str = "/") -> None:
        self.cookies[name] = value

    def close(self) -> None:
        self.closed = True


@pytest.fixture()
def fake_clients(monkeypatch):
    created: list[FakeClient] = []

    def factory(base_url: str) -> FakeClient:
        client = FakeClient(base_url)
        created.append(client)
        return client

    monkeypatch.setattr(lab_context, "_new_client", factory)
    return created


def test_detect_item_natural_language():
    assert lab_context.detect_item("DVWA 的 SQL 注入 medium 怎么绕过", None) == "dvwa:sqli:medium"
    assert lab_context.detect_item("Less-5 我判断不出闭合", None) == "sqli:Less-5"
    assert lab_context.detect_item("第 25a 关怎么过", None) == "sqli:Less-25a"
    assert lab_context.detect_item("dom xss 高难度", None) == "dvwa:xss_d:high"
    assert lab_context.detect_item("今天天气不错", None) is None
    assert lab_context.detect_item("SQL 注入怎么学", type("P", (), {"lab": "sqli-labs"})()) is None


def test_normalize_level():
    assert lab_context.normalize_level("low") == "low"
    assert lab_context.normalize_level("中难度") == "medium"
    assert lab_context.normalize_level("impossible") == "impossible"
    assert lab_context.normalize_level("随便问问") is None


def test_dvwa_context_with_fake_http(fake_clients):
    context = lab_context.collect_context(ROOT, "dvwa:sqli:low", use_cache=False)
    assert context["ok"] is True
    assert context["lab"] == "dvwa"
    assert context["level"] == "low"
    assert "SQL Injection" in (context["page"] or {}).get("title", "")
    assert context["page"]["forms"][0]["fields"][0]["name"] == "id"
    assert "source" in context and "low.php" in context["source"]["path"]
    assert "SELECT" in context["source"]["code"]
    # 登录 + 设置 security cookie
    client = fake_clients[0]
    assert any(path == "/login.php" for path, _data in client.posts)
    assert client.cookies.get("security") == "low"

    prompt = lab_context.context_to_prompt(context)
    assert "实时抓取的关卡上下文" in prompt
    assert "关卡源码" in prompt
    assert "You have an error" in prompt


def test_sqli_context_with_fake_http(fake_clients):
    context = lab_context.collect_context(ROOT, "sqli:Less-5", use_cache=False)
    assert context["ok"] is True
    assert context["lab"] == "sqli-labs"
    assert context["lesson"] == "Less-5"
    assert "source" in context and "Less-5" in context["source"]["path"]
    assert "index.php" in context["source"]["path"]


def test_source_bundle_dvwa():
    bundle = lab_context.source_bundle(ROOT, "dvwa:sqli:low")
    assert bundle["kind"] == "dvwa"
    assert set(bundle["levels"]) == {"low", "medium", "high", "impossible"}
    assert bundle["current_level"] == "low"
    assert len(bundle["diffs"]) == 3
    assert any(diff["from"] == "low" and diff["to"] == "medium" for diff in bundle["diffs"])
    assert any("mysqli_real_escape_string" in levels["code"] or "mysql_real_escape_string" in levels["code"] for levels in bundle["levels"].values())


def test_source_bundle_sqli():
    bundle = lab_context.source_bundle(ROOT, "sqli:Less-5")
    assert bundle["kind"] == "sqli-labs"
    assert bundle["source"]["path"].endswith("Less-5/index.php")
    assert "SELECT" in bundle["source"]["code"]


def test_lab_source_api(tmp_path, monkeypatch):
    fake_bundle = {
        "kind": "dvwa",
        "item_key": "dvwa:sqli:low",
        "title": "DVWA · SQL 注入 · low",
        "levels": {"low": {"path": "low.php", "code": "<?php 1;"}},
        "diffs": [{"from": "low", "to": "medium", "text": "-a\n+b", "has_changes": True}],
        "warnings": [],
    }
    monkeypatch.setattr(
        lab_context, "source_bundle", lambda root, key: dict(fake_bundle)
    )
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        response = client.get("/api/lab/source?item_key=dvwa:sqli:low")
        assert response.status_code == 200
        data = response.get_json()
        assert data["kind"] == "dvwa"
        assert len(data["levels"]) == 1

        assert client.get("/api/lab/source?item_key=bad-key").status_code == 400
        assert client.get("/api/lab/source").status_code == 400


def test_lab_context_api(tmp_path, monkeypatch):
    fake = {
        "ok": True,
        "item_key": "dvwa:sqli:low",
        "title": "DVWA · SQL 注入 · low",
        "lab": "dvwa",
        "page": {"text": "hello", "forms": [], "query_params": []},
        "source": {"path": "x/low.php", "code": "<?php echo 1;"},
        "warnings": [],
        "note": "mock",
    }
    monkeypatch.setattr(
        lab_context, "collect_context", lambda root, key, **kwargs: dict(fake)
    )
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        response = client.post("/api/lab/context", json={"item_key": "dvwa:sqli:low"})
        assert response.status_code == 200
        assert response.get_json()["title"] == "DVWA · SQL 注入 · low"

        detected = client.post(
            "/api/lab/context", json={"text": "Less-5 不会，帮我看看页面"}
        )
        assert detected.status_code == 200

        assert client.post("/api/lab/context", json={}).status_code == 400
        assert client.post("/api/lab/context", json={"item_key": "nope"}).status_code == 400
