"""LLM Agent 循环测试：执行模式自然语言对话、思考流、工具调用卡片、错误兜底。

全部离线执行，用本地 ThreadingHTTPServer 模拟 OpenAI 兼容接口：
- 按脚本顺序返回内容 / reasoning_content / tool_calls；
- 断言第二次请求里带上了 role=tool 的工具结果，说明 Agent 真的完成了循环。

运行：.venv/bin/python -m pytest tests/test_agent_llm.py -q
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


# --------------------------------------------------------------------- 工具
def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_reply(test_client, conversation_id: str, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    last: dict | None = None
    while time.time() < deadline:
        response = test_client.get(f"/api/conversations/{conversation_id}")
        last = response.get_json()
        messages = last.get("messages") or []
        if not last.get("busy") and any(item["role"] == "assistant" for item in messages):
            return last
        time.sleep(0.05)
    raise AssertionError(f"等待 Agent 回复超时，最后状态：{last}")


def _text_parts(text: str, size: int = 6) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


class MockLLM:
    """按脚本返回流式响应的本地 OpenAI 兼容服务。"""

    def __init__(self, script: list[dict] | None = None) -> None:
        self.script = list(script or [])
        self.captured: list[dict] = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    body = json.loads(raw)
                except json.JSONDecodeError:
                    body = {}
                owner.captured.append(
                    {"headers": dict(self.headers), "body": body}
                )
                item = owner.script.pop(0) if owner.script else {"content": ["好的。"]}
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self._write_script(item)
                self.wfile.flush()

            def _write_script(self, item: dict) -> None:
                for part in _text_parts(str(item.get("reasoning") or "")):
                    self._chunk({"reasoning_content": part})
                for part in _text_parts(str(item.get("content") or "")):
                    self._chunk({"content": part})
                for call in item.get("tool_calls") or []:
                    arguments = json.dumps(call.get("arguments") or {}, ensure_ascii=False)
                    first, rest = arguments[: max(1, len(arguments) // 2)], arguments[
                        max(1, len(arguments) // 2) :
                    ]
                    self._chunk(
                        {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": call.get("id") or "call_test_1",
                                    "type": "function",
                                    "function": {
                                        "name": call["name"],
                                        "arguments": first,
                                    },
                                }
                            ]
                        }
                    )
                    if rest:
                        self._chunk(
                            {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {"arguments": rest},
                                    }
                                ]
                            }
                        )
                self.wfile.write(b"data: [DONE]\n\n")

            def _chunk(self, delta: dict) -> None:
                chunk = {"choices": [{"delta": delta, "index": 0}]}
                self.wfile.write(
                    f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
                )
                self.wfile.flush()

            def log_message(self, *_args):  # 静音
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


# --------------------------------------------------------------------- fixture
@pytest.fixture()
def client(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def mock_llm():
    service = MockLLM()
    yield service
    service.close()


def _configure(client, base_url: str) -> dict:
    response = client.put(
        "/api/settings/llm",
        json={
            "base_url": base_url,
            "api_key": "sk-agent-test",
            "model": "mock-agent",
            "temperature": 0.2,
            "max_tokens": 800,
        },
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _new_conversation(client) -> str:
    projects = client.get("/api/projects").get_json()["projects"]
    dvwa = next(item for item in projects if item["lab"] == "dvwa")
    created = client.post(f"/api/projects/{dvwa['id']}/conversations", json={})
    assert created.status_code == 201
    return created.get_json()["id"]


def _send(client, conversation_id: str, content: str, mode: str = "agent"):
    return client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": content, "mode": mode},
    )


# --------------------------------------------------------------------- 用例
def test_agent_mode_streams_reasoning_and_content(client, mock_llm):
    mock_llm.script = [
        {
            "reasoning": "用户只是在打招呼，我直接自我介绍。",
            "content": "你好，我是本机靶场渗透测试智能体。",
        }
    ]
    _configure(client, mock_llm.url)
    conversation_id = _new_conversation(client)
    response = _send(client, conversation_id, "你好，介绍一下你自己")
    assert response.status_code == 201

    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["role"] == "assistant"
    assert assistant["content"] == "你好，我是本机靶场渗透测试智能体。"
    assert assistant["data"]["mode"] == "agent"
    assert assistant["data"]["model"] == "mock-agent"
    assert assistant["data"]["streaming"] is False
    assert "直接自我介绍" in assistant["data"]["reasoning"]

    events = state.get("events") or []
    assert any(event["type"] == "reasoning" for event in events)
    assert len([event for event in events if event["type"] == "delta"]) >= 2

    system = client.get("/api/system").get_json()
    assert system["llm_configured"] is True
    assert system["llm_model"] == "mock-agent"

    captured = mock_llm.captured[0]
    assert captured["headers"]["Authorization"] == "Bearer sk-agent-test"
    assert captured["body"]["model"] == "mock-agent"
    assert captured["body"].get("tools"), "执行模式应把工具 schema 传给模型"
    tool_names = {
        item["function"]["name"] for item in captured["body"]["tools"]
    }
    assert {"run_web_scan", "run_dvwa", "verify_all", "get_status"} <= tool_names
    system_prompt = captured["body"]["messages"][0]["content"]
    assert "Pentest Agent" in system_prompt
    assert "DVWA" in system_prompt


def test_agent_mode_executes_tool_and_continues_loop(client, mock_llm):
    mock_llm.script = [
        {
            "reasoning": "先更新计划，告诉用户我要检查状态。",
            "tool_calls": [
                {
                    "id": "call_plan",
                    "name": "update_plan",
                    "arguments": {"steps": ["检查靶场状态", "汇总结果"]},
                }
            ],
        },
        {
            "content": "检查完成：靶场在线，可直接开始扫描。",
            "tool_calls": [
                {"id": "call_status", "name": "get_status", "arguments": {}}
            ],
        },
        {"content": "靶场容器、DVWA 与 SQLi-Labs 均正常，随时可以开跑。"},
    ]
    _configure(client, mock_llm.url)
    conversation_id = _new_conversation(client)
    _send(client, conversation_id, "先看下靶场状态，然后给我结论")

    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["content"].endswith("随时可以开跑。")
    assert "\n\n" in assistant["content"]  # 工具轮之间的分段
    tools = assistant["data"]["tools"]
    assert [item["name"] for item in tools] == ["update_plan", "get_status"]
    assert all(item["status"] == "done" for item in tools)
    assert tools[0]["label"] == "更新执行计划"
    assert "靶场状态" in tools[1]["output"]
    plan = assistant["data"]["plan"]
    assert [step["text"] for step in plan["steps"]] == ["检查靶场状态", "汇总结果"]

    # 第二轮请求必须带上 role=tool 的工具结果，形成完整 Agent 循环
    assert len(mock_llm.captured) == 3
    second = mock_llm.captured[1]["body"]["messages"]
    assert second[-1]["role"] == "tool"
    assert second[-1]["tool_call_id"] == "call_plan"
    assert "计划已更新" in second[-1]["content"]
    third = mock_llm.captured[2]["body"]["messages"]
    assert third[-1]["role"] == "tool"
    assert third[-1]["tool_call_id"] == "call_status"


def test_agent_mode_tool_error_is_reported_and_model_can_recover(client, mock_llm):
    mock_llm.script = [
        {
            "tool_calls": [
                {
                    "id": "call_bad_target",
                    "name": "set_target",
                    "arguments": {"target": "ftp://example.com"},
                }
            ],
        },
        {"content": "目标地址不合法，需要以 http:// 或 https:// 开头。"},
    ]
    _configure(client, mock_llm.url)
    conversation_id = _new_conversation(client)
    _send(client, conversation_id, "把目标改成 ftp://example.com")

    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["content"].startswith("目标地址不合法")
    tool = assistant["data"]["tools"][0]
    assert tool["status"] == "error"
    assert "http://" in tool["output"]
    tool_message = json.loads(mock_llm.captured[1]["body"]["messages"][-1]["content"])
    assert tool_message["ok"] is False


def test_agent_mode_uses_rule_engine_without_llm(client):
    conversation_id = _new_conversation(client)
    _send(client, conversation_id, "你能干什么")
    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] in ("help", "text")
    assert "教学模式" in assistant["content"]
    # 没有配置大模型时不会创建流式占位消息
    assert all(item["data"].get("streaming") is not True for item in state["messages"])


def test_agent_llm_connection_error_is_friendly(client):
    _configure(client, f"http://127.0.0.1:{_free_port()}/v1")
    conversation_id = _new_conversation(client)
    _send(client, conversation_id, "你好")
    state = _wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] == "error"
    assert "智能体暂时不可用" in assistant["content"]
    assert "AI 教学模型" in assistant["content"]
