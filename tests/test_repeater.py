"""请求重放器测试：真实本地 HTTP 服务 + 作用域守卫 + API。"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.repeater import RepeaterError, send_request  # noqa: E402
from pentest_agent.web.server import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class EchoHandler(BaseHTTPRequestHandler):
    def _echo(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace") if length else ""
        payload = {
            "method": self.command,
            "path": self.path,
            "body": body,
            "header_x": self.headers.get("X-Test", ""),
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(201 if self.command == "POST" else 200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Reply", "ok")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _echo
    do_POST = _echo

    def log_message(self, *_args):
        return


@pytest.fixture()
def echo_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), EchoHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_send_get_request(echo_server):
    result = send_request(
        method="GET",
        url=f"{echo_server}/hello?x=1",
        headers={"X-Test": "yes"},
    )
    assert result["ok"] is True
    assert result["response"]["status"] == 200
    assert result["response"]["headers"]["X-Reply"] == "ok"
    payload = json.loads(result["response"]["body"])
    assert payload["method"] == "GET"
    assert payload["path"] == "/hello?x=1"
    assert payload["header_x"] == "yes"
    assert result["response"]["elapsed_ms"] >= 0


def test_send_post_body(echo_server):
    result = send_request(
        method="POST",
        url=f"{echo_server}/inject",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body="id=1' AND '1'='1",
    )
    assert result["response"]["status"] == 201
    payload = json.loads(result["response"]["body"])
    assert payload["method"] == "POST"
    assert payload["body"] == "id=1' AND '1'='1"


def test_scope_guard_blocks_remote():
    with pytest.raises(RepeaterError) as excinfo:
        send_request(method="GET", url="http://example.com/")
    assert "作用域" in str(excinfo.value)


def test_invalid_method_and_url():
    with pytest.raises(RepeaterError):
        send_request(method="TRACE", url="http://127.0.0.1:1/")
    with pytest.raises(RepeaterError):
        send_request(method="GET", url="ftp://127.0.0.1/")


def test_repeater_api(tmp_path, echo_server):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        response = client.post(
            "/api/repeater/send",
            json={
                "method": "POST",
                "url": f"{echo_server}/api",
                "headers": {"X-Test": "api"},
                "body": "a=1",
            },
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["ok"] is True
        assert data["response"]["status"] == 201
        payload = json.loads(data["response"]["body"])
        assert payload["body"] == "a=1"
        assert payload["header_x"] == "api"

        blocked = client.post(
            "/api/repeater/send", json={"method": "GET", "url": "http://example.com/"}
        )
        assert blocked.status_code == 400
        assert "作用域" in blocked.get_json()["error"]
