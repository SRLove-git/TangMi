"""测试共用工具：本地 OpenAI 兼容 mock LLM + 对话辅助函数。

被 tests/test_agent_llm.py 与 tests/test_extensions.py 复用，避免重复实现。
"""

from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def text_parts(text: str, size: int = 6) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


class MockLLM:
    """按脚本返回流式响应的本地 OpenAI 兼容服务。

    脚本元素：
    - ``{"content": "...", "reasoning": "...", "tool_calls": [{"id","name","arguments"}]}``
    - 每次请求按顺序消费一个脚本；耗尽后固定回复 ``好的。``
    """

    def __init__(self, script: list[dict[str, Any]] | None = None) -> None:
        self.script = list(script or [])
        self.captured: list[dict[str, Any]] = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    body = json.loads(raw)
                except json.JSONDecodeError:
                    body = {}
                owner.captured.append({"headers": dict(self.headers), "body": body})
                item = owner.script.pop(0) if owner.script else {"content": ["好的。"]}
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self._write_script(item)
                self.wfile.flush()

            def _write_script(self, item: dict[str, Any]) -> None:
                for part in text_parts(str(item.get("reasoning") or "")):
                    self._chunk({"reasoning_content": part})
                content = item.get("content")
                if isinstance(content, list):
                    for part in content:
                        self._chunk({"content": str(part)})
                else:
                    for part in text_parts(str(content or "")):
                        self._chunk({"content": part})
                for call in item.get("tool_calls") or []:
                    arguments = json.dumps(call.get("arguments") or {}, ensure_ascii=False)
                    split = max(1, len(arguments) // 2)
                    self._chunk(
                        {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": call.get("id") or "call_test_1",
                                    "type": "function",
                                    "function": {
                                        "name": call["name"],
                                        "arguments": arguments[:split],
                                    },
                                }
                            ]
                        }
                    )
                    if arguments[split:]:
                        self._chunk(
                            {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {"arguments": arguments[split:]},
                                    }
                                ]
                            }
                        )
                self.wfile.write(b"data: [DONE]\n\n")

            def _chunk(self, delta: dict[str, Any]) -> None:
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


# ---------------------------------------------------------------- 对话辅助
def wait_for_reply(client: Any, conversation_id: str, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    last: dict | None = None
    while time.time() < deadline:
        response = client.get(f"/api/conversations/{conversation_id}")
        last = response.get_json()
        messages = last.get("messages") or []
        if not last.get("busy") and any(item["role"] == "assistant" for item in messages):
            return last
        time.sleep(0.05)
    raise AssertionError(f"等待 Agent 回复超时，最后状态：{last}")


def configure_llm(client: Any, base_url: str, model: str = "mock-agent") -> dict:
    response = client.put(
        "/api/settings/llm",
        json={
            "base_url": base_url,
            "api_key": "sk-agent-test",
            "model": model,
            "temperature": 0.2,
            "max_tokens": 800,
        },
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def new_conversation(client: Any, *, lab: str = "dvwa") -> str:
    projects = client.get("/api/projects").get_json()["projects"]
    project = next(item for item in projects if item["lab"] == lab)
    created = client.post(f"/api/projects/{project['id']}/conversations", json={})
    assert created.status_code == 201
    return created.get_json()["id"]


def send_message(
    client: Any,
    conversation_id: str,
    content: str,
    *,
    mode: str = "agent",
    data: dict | None = None,
):
    payload: dict[str, Any] = {"content": content, "mode": mode}
    if data:
        payload["data"] = data
    return client.post(f"/api/conversations/{conversation_id}/messages", json=payload)
