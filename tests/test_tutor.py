"""AI 教学模式（导师）测试：配置读写、消息路由、mock LLM 流式回复。

全部离线执行，用本地 ThreadingHTTPServer 模拟 OpenAI 兼容接口。

运行：.venv/bin/python -m pytest tests/test_tutor.py -q
"""

from __future__ import annotations

import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.server import create_app  # noqa: E402
from pentest_agent.web.tutor import (  # noqa: E402
    LLMSettingsStore,
    TutorError,
    TutorLLM,
    _endpoint,
    _is_local_base_url,
)

REPLY_PARTS = ["先判断闭合方式：", "分别输入 `'` 和 `\"` ", "观察报错差异。"]


# --------------------------------------------------------------------- 工具
def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_reply(test_client, conversation_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        response = test_client.get(f"/api/conversations/{conversation_id}")
        last = response.get_json()
        messages = last.get("messages") or []
        if not last.get("busy") and any(item["role"] == "assistant" for item in messages):
            return last
        time.sleep(0.05)
    raise AssertionError(f"等待导师回复超时，最后状态：{last}")


# --------------------------------------------------------------------- fixture
@pytest.fixture()
def client(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def mock_llm():
    """本地 OpenAI 兼容 mock：流式返回 REPLY_PARTS。"""
    captured: dict[str, object] = {"requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = {}
            captured["requests"].append(  # type: ignore[union-attr]
                {"headers": dict(self.headers), "body": body}
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            for part in REPLY_PARTS:
                chunk = {"choices": [{"delta": {"content": part}, "index": 0}]}
                self.wfile.write(
                    f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
                )
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

        def log_message(self, *_args):  # 静音
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield {
        "url": f"http://127.0.0.1:{server.server_address[1]}",
        "captured": captured,
    }
    server.shutdown()
    server.server_close()


def _configure(client, base_url: str, **overrides) -> dict:
    payload = {
        "base_url": base_url,
        "api_key": "sk-test-123456",
        "model": "mock-chat",
        "temperature": 0.3,
        "max_tokens": 800,
    }
    payload.update(overrides)
    response = client.put("/api/settings/llm", json=payload)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _new_conversation(client) -> str:
    projects = client.get("/api/projects").get_json()["projects"]
    dvwa = next(item for item in projects if item["lab"] == "dvwa")
    created = client.post(f"/api/projects/{dvwa['id']}/conversations", json={})
    assert created.status_code == 201
    return created.get_json()["id"]


# --------------------------------------------------------------------- 配置
def test_llm_settings_default_and_validation(client):
    default = client.get("/api/settings/llm").get_json()
    assert default["configured"] is False
    assert default["source"] == "none"
    assert default["api_key_masked"] == ""

    bad = client.put("/api/settings/llm", json={"base_url": "api.deepseek.com"})
    assert bad.status_code == 400
    assert "http" in bad.get_json()["error"]

    bad_temp = client.put(
        "/api/settings/llm",
        json={"base_url": "https://api.deepseek.com", "temperature": 9},
    )
    assert bad_temp.status_code == 400

    saved = _configure(client, "https://api.deepseek.com", model="deepseek-chat")
    assert saved["configured"] is True
    assert saved["source"] == "ui"
    assert saved["base_url"] == "https://api.deepseek.com"
    # 密钥只返回掩码
    assert saved["api_key_masked"] == "sk-****3456"
    assert "sk-test-123456" not in json.dumps(saved)

    # 空 API Key 表示保持原值
    kept = client.put(
        "/api/settings/llm", json={"base_url": "https://api.deepseek.com", "api_key": ""}
    ).get_json()
    assert kept["has_api_key"] is True

    settings_file = Path(saved["settings_path"])
    assert settings_file.exists()
    assert oct(settings_file.stat().st_mode & 0o777) == "0o600"


def test_llm_settings_local_base_url_without_key(client):
    saved = client.put(
        "/api/settings/llm",
        json={"base_url": "http://127.0.0.1:11434/v1", "model": "qwen2.5:7b", "api_key": "__clear__"},
    ).get_json()
    assert saved["configured"] is True
    assert saved["is_local"] is True
    assert saved["has_api_key"] is False


def test_llm_settings_env_fallback(client, monkeypatch):
    monkeypatch.setenv("PENTEST_LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("PENTEST_LLM_API_KEY", "sk-env-abcdef1234")
    monkeypatch.setenv("PENTEST_LLM_MODEL", "deepseek-chat")
    public = client.get("/api/settings/llm").get_json()
    assert public["configured"] is True
    assert public["source"] == "env"
    assert public["api_key_masked"] == "sk-****1234"


def test_endpoint_normalization_and_local_host():
    assert _endpoint("https://api.deepseek.com") == "https://api.deepseek.com/chat/completions"
    assert _endpoint("https://api.deepseek.com/v1") == "https://api.deepseek.com/v1/chat/completions"
    assert _endpoint("https://api.openai.com") == "https://api.openai.com/v1/chat/completions"
    assert _endpoint("http://127.0.0.1:11434/v1") == "http://127.0.0.1:11434/v1/chat/completions"
    assert _endpoint("https://x.com/v1/chat/completions") == "https://x.com/v1/chat/completions"
    assert _is_local_base_url("http://127.0.0.1:11434/v1")
    assert _is_local_base_url("http://192.168.1.5:8000/v1")
    assert not _is_local_base_url("https://api.deepseek.com")


# --------------------------------------------------------------------- 路由
def test_post_message_mode_validation(client):
    conversation_id = _new_conversation(client)
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "你好", "mode": "hacker"},
    )
    assert response.status_code == 400
    assert "mode" in response.get_json()["error"]


def test_tutor_without_config_returns_setup_help(client):
    conversation_id = _new_conversation(client)
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "Less-1 不会，给我提示", "mode": "tutor"},
    )
    assert response.status_code == 201
    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] == "tutor"
    assert "AI 教学模型" in assistant["content"]
    assert "DeepSeek" in assistant["content"]


def test_tutor_streams_reply_from_mock_llm(client, mock_llm):
    _configure(client, mock_llm["url"])
    conversation_id = _new_conversation(client)
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "Less-5 我判断不出闭合方式，先给我提示", "mode": "tutor"},
    )
    assert response.status_code == 201

    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] == "tutor"
    assert assistant["content"] == "".join(REPLY_PARTS)
    assert assistant["data"]["model"] == "mock-chat"

    # 用户消息带 mode 标记，方便前端渲染
    user = state["messages"][0]
    assert user["data"]["mode"] == "tutor"

    # 流式事件：先有 message 占位，再有多个 delta，最后是 message 定稿
    events = state.get("events") or []
    deltas = [event for event in events if event["type"] == "delta"]
    assert len(deltas) >= 2
    assert any(event["type"] == "message" for event in events)

    # 请求里注入了教学 Prompt + 靶场上下文
    captured = mock_llm["captured"]["requests"][0]
    assert captured["headers"]["Authorization"] == "Bearer sk-test-123456"
    assert captured["body"]["model"] == "mock-chat"
    system_prompt = captured["body"]["messages"][0]["content"]
    assert "靶场导师" in system_prompt
    assert "DVWA" in system_prompt
    assert "SQLi-Labs" in system_prompt
    assert captured["body"]["messages"][-1]["content"].startswith("Less-5")


def test_tutor_connection_error_is_friendly(client):
    configured = _configure(client, f"http://127.0.0.1:{_free_port()}/v1")
    assert configured["configured"] is True
    conversation_id = _new_conversation(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "帮我看下这个报错", "mode": "tutor"},
    )
    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] == "error"
    assert "导师暂时不可用" in assistant["content"]


def test_agent_mode_still_uses_rule_engine(client):
    conversation_id = _new_conversation(client)
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "你能干什么", "mode": "agent"},
    )
    assert response.status_code == 201
    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] in ("help", "text")
    assert "教学模式" in assistant["content"]


# --------------------------------------------------------------------- 单元
def test_tutor_llm_requires_config(tmp_path):
    store = LLMSettingsStore(tmp_path)
    llm = TutorLLM(store)
    assert llm.configured is False
    with pytest.raises(TutorError):
        llm.ping()


# ---------------------------------------------------------------- 模型探测
class _FakeModelResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or json.dumps(self._payload)

    def json(self):
        return self._payload


def test_models_endpoint_normalization():
    from pentest_agent.web.tutor import _models_endpoint

    assert _models_endpoint("https://api.deepseek.com") == "https://api.deepseek.com/models"
    assert _models_endpoint("https://api.deepseek.com/v1") == "https://api.deepseek.com/v1/models"
    assert (
        _models_endpoint("https://api.deepseek.com/v1/chat/completions")
        == "https://api.deepseek.com/v1/models"
    )
    assert _models_endpoint("https://api.openai.com/v1") == "https://api.openai.com/v1/models"


def test_list_models_success(tmp_path, monkeypatch):
    from pentest_agent.web import tutor
    from pentest_agent.web.tutor import LLMSettingsStore, list_models

    store = LLMSettingsStore(tmp_path)
    store.update(
        {
            "base_url": "https://api.deepseek.com",
            "api_key": "sk-test-123456",
            "model": "deepseek-flash",
        }
    )
    captured = {}

    def fake_get(url, headers=None, timeout=15):
        captured["url"] = url
        captured["headers"] = headers
        return _FakeModelResponse(
            200, {"data": [{"id": "deepseek-v4-pro"}, {"id": "deepseek-flash"}]}
        )

    monkeypatch.setattr(tutor.requests, "get", fake_get)
    result = list_models(store)
    assert result["models"] == ["deepseek-flash", "deepseek-v4-pro"]
    assert result["current_model"] == "deepseek-flash"
    assert captured["url"] == "https://api.deepseek.com/models"
    assert captured["headers"]["Authorization"] == "Bearer sk-test-123456"


def test_list_models_http_error(tmp_path, monkeypatch):
    from pentest_agent.web import tutor
    from pentest_agent.web.tutor import LLMSettingsStore, TutorError, list_models

    store = LLMSettingsStore(tmp_path)
    store.update(
        {
            "base_url": "https://api.deepseek.com",
            "api_key": "sk-bad-key",
            "model": "deepseek-flash",
        }
    )
    monkeypatch.setattr(
        tutor.requests, "get", lambda *args, **kwargs: _FakeModelResponse(401, text="unauthorized")
    )
    with pytest.raises(TutorError) as excinfo:
        list_models(store)
    assert "401" in str(excinfo.value) or "API Key" in str(excinfo.value)


def test_models_api(tmp_path, monkeypatch):
    from pentest_agent.web import tutor

    app = create_app(tmp_path)
    app.config.update(TESTING=True)

    monkeypatch.setattr(
        tutor,
        "list_models",
        lambda store: {
            "ok": True,
            "models": ["deepseek-flash", "deepseek-v4-pro"],
            "base_url": "https://api.deepseek.com",
            "current_model": "deepseek-flash",
            "endpoint": "https://api.deepseek.com/models",
        },
    )
    with app.test_client() as client:
        response = client.get("/api/settings/llm/models")
        assert response.status_code == 200
        data = response.get_json()
        assert data["models"] == ["deepseek-flash", "deepseek-v4-pro"]

    def boom(store):
        raise tutor.TutorError("尚未配置")

    monkeypatch.setattr(tutor, "list_models", boom)
    with app.test_client() as client:
        assert client.get("/api/settings/llm/models").status_code == 400
