"""扩展系统测试：技能安装/启停/预览 + MCP stdio/HTTP 接入 + Agent 动态工具。

全部离线执行：
- 技能用临时目录里的 SKILL.md 与内存 ZIP；
- MCP stdio 用本地 Python 脚本模拟 JSON-RPC 服务器；
- MCP HTTP 用本地 ThreadingHTTPServer 模拟 Streamable HTTP 端点；
- Agent 集成用 tests/mock_llm.py 的流式 mock 大模型。

运行：.venv/bin/python -m pytest tests/test_extensions.py -q
"""

from __future__ import annotations

import io
import json
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pentest_agent.web.server import create_app  # noqa: E402
from mock_llm import (  # noqa: E402
    MockLLM,
    configure_llm,
    new_conversation,
    send_message,
    wait_for_reply,
)


# --------------------------------------------------------------------- 工具
def _write_skill(
    root: Path,
    skill_id: str,
    name: str,
    description: str,
    body: str,
    *,
    installed: bool = False,
) -> Path:
    base = (root / "web_data" / "skills") if installed else (root / "skills")
    path = base / skill_id
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\n{body}\n",
        encoding="utf-8",
    )
    return path


def _make_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


STDIO_MOCK_SOURCE = r'''
import json
import sys

TOOLS = [
    {
        "name": "echo",
        "description": "回显文本",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "add",
        "description": "两数相加",
        "inputSchema": {
            "type": "object",
            "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
        },
    },
]


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        continue
    request_id = message.get("id")
    if request_id is None:
        continue
    method = message.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": request_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mock-mcp", "version": "1.0"},
        }})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}})
    elif method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name == "echo":
            text = "MCP echo: " + str(arguments.get("text", ""))
        elif name == "add":
            text = "sum=" + str(
                float(arguments.get("a", 0)) + float(arguments.get("b", 0))
            )
        else:
            text = "unknown tool"
        send({"jsonrpc": "2.0", "id": request_id, "result": {
            "content": [{"type": "text", "text": text}],
        }})
    else:
        send({"jsonrpc": "2.0", "id": request_id,
              "error": {"code": -32601, "message": "not found"}})
'''


def _write_stdio_server(root: Path) -> Path:
    path = root / "mock_mcp_server.py"
    path.write_text(STDIO_MOCK_SOURCE, encoding="utf-8")
    return path


def _add_stdio_mcp(client, tmp_path: Path, name: str = "Mock MCP") -> str:
    script = _write_stdio_server(tmp_path)
    response = client.post(
        "/api/extensions/mcp",
        json={
            "name": name,
            "transport": "stdio",
            "command": sys.executable,
            "args": [str(script)],
        },
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()["server"]["id"]


class _HTTPMCPHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}
        if "id" not in body:  # 通知
            self.send_response(202)
            self.send_header("Mcp-Session-Id", "sess-test")
            self.end_headers()
            return
        request_id = body["id"]
        method = body.get("method")
        if method == "initialize":
            result = {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "http-mock", "version": "1.0"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "http_echo",
                        "description": "HTTP MCP 回显",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"msg": {"type": "string"}},
                        },
                    }
                ]
            }
        elif method == "tools/call":
            params = body.get("params") or {}
            arguments = params.get("arguments") or {}
            result = {
                "content": [
                    {"type": "text", "text": "HTTP echo: " + str(arguments.get("msg", ""))}
                ]
            }
        else:
            result = {}
        data = json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Mcp-Session-Id", "sess-test")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):  # 静音
        return


@pytest.fixture()
def client(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client
    try:
        app.config["EXTENSIONS"].close()
    except Exception:  # noqa: BLE001
        pass


@pytest.fixture()
def mock_llm():
    service = MockLLM()
    yield service
    service.close()


@pytest.fixture()
def http_mcp():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _HTTPMCPHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/mcp"
    server.shutdown()
    server.server_close()


# --------------------------------------------------------------------- 技能
def test_skills_list_read_toggle_and_snapshot(client, tmp_path):
    _write_skill(
        tmp_path,
        "demo-skill",
        "演示技能",
        "用于测试的只读技能",
        "第一步：观察现象；第二步：验证假设。",
    )
    snapshot = client.get("/api/extensions").get_json()
    skill = next(item for item in snapshot["skills"] if item["id"] == "demo-skill")
    assert skill["source"] == "builtin"
    assert skill["enabled"] is True
    assert skill["description"] == "用于测试的只读技能"

    detail = client.get("/api/extensions/skills/demo-skill").get_json()
    assert "第一步：观察现象" in detail["content"]
    assert "SKILL.md" in detail["file_list"]
    assert "name: 演示技能" in detail["content"]

    toggled = client.patch(
        "/api/extensions/skills/demo-skill", json={"enabled": False}
    ).get_json()
    assert toggled["skill"]["enabled"] is False
    snapshot = client.get("/api/extensions").get_json()
    skill = next(item for item in snapshot["skills"] if item["id"] == "demo-skill")
    assert skill["enabled"] is False
    # 内置技能不允许删除
    assert client.delete("/api/extensions/skills/demo-skill").status_code == 400
    # 不存在的技能
    assert client.get("/api/extensions/skills/nope").status_code == 404


def test_skill_install_zip_toggle_and_delete(client):
    payload = _make_zip(
        {
            "my-skill/SKILL.md": (
                "---\nname: Zip 技能\ndescription: 来自 ZIP 的技能\n---\n\n"
                "# Zip 技能\n\n按步骤执行。\n"
            ),
            "my-skill/scripts/run.sh": "echo hi\n",
        }
    )
    response = client.post(
        "/api/extensions/skills/install",
        data={"file": (io.BytesIO(payload), "my-skill.zip")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 201, response.get_json()
    skill = response.get_json()["skill"]
    assert skill["name"] == "Zip 技能"
    assert skill["source"] == "installed"
    assert skill["files"] >= 2
    skill_id = skill["id"]

    assert (
        client.patch(
            f"/api/extensions/skills/{skill_id}", json={"enabled": False}
        ).status_code
        == 200
    )
    deleted = client.delete(f"/api/extensions/skills/{skill_id}")
    assert deleted.status_code == 200
    items = client.get("/api/extensions/skills").get_json()["skills"]
    assert all(item["id"] != skill_id for item in items)
    assert client.delete(f"/api/extensions/skills/{skill_id}").status_code == 400


def test_skill_zip_rejects_unsafe_paths_and_missing_skill_md(client):
    traversal = _make_zip({"../evil.txt": "x", "SKILL.md": "# 坏技能"})
    response = client.post(
        "/api/extensions/skills/install",
        data={"file": (io.BytesIO(traversal), "bad.zip")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert "非法路径" in response.get_json()["error"]

    missing = _make_zip({"readme.md": "没有 SKILL.md"})
    response = client.post(
        "/api/extensions/skills/install",
        data={"file": (io.BytesIO(missing), "missing.zip")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert "SKILL.md" in response.get_json()["error"]


def test_skill_install_from_local_path(client, tmp_path):
    source = tmp_path / "external-skill"
    source.mkdir()
    (source / "SKILL.md").write_text(
        "---\nname: 本地目录技能\ndescription: 从本地目录安装\n---\n\n# 本地目录技能\n\n内容。\n",
        encoding="utf-8",
    )
    response = client.post(
        "/api/extensions/skills/install-path", json={"path": str(source)}
    )
    assert response.status_code == 201, response.get_json()
    assert response.get_json()["skill"]["name"] == "本地目录技能"
    # 不存在的目录
    bad = client.post("/api/extensions/skills/install-path", json={"path": "/nope"})
    assert bad.status_code == 400


# --------------------------------------------------------------------- MCP
def test_mcp_stdio_configure_test_and_disable(client, tmp_path):
    server_id = _add_stdio_mcp(client, tmp_path)
    test = client.post(f"/api/extensions/mcp/{server_id}/test").get_json()
    assert test["ok"] is True
    assert {tool["name"] for tool in test["tools"]} == {"echo", "add"}

    listed = client.get("/api/extensions/mcp").get_json()
    server = next(item for item in listed["servers"] if item["id"] == server_id)
    assert server["connected"] is True
    assert server["tool_count"] == 2
    assert listed["status"]["enabled"] >= 1

    tools = client.get(f"/api/extensions/mcp/{server_id}/tools").get_json()
    assert {tool["name"] for tool in tools["tools"]} == {"echo", "add"}

    agent_tools = client.get("/api/extensions/agent-tools").get_json()
    exposed = {
        item["exposed_name"]
        for item in agent_tools["mcp_tools"]
        if item["server_id"] == server_id
    }
    assert exposed == {"mcp__Mock_MCP__echo", "mcp__Mock_MCP__add"}

    # 禁用后不再暴露给 Agent，连接也会关闭
    assert (
        client.patch(f"/api/extensions/mcp/{server_id}", json={"enabled": False}).status_code
        == 200
    )
    agent_tools = client.get("/api/extensions/agent-tools").get_json()
    assert all(
        item["server_id"] != server_id for item in agent_tools["mcp_tools"]
    )
    assert client.delete(f"/api/extensions/mcp/{server_id}").status_code == 200
    assert client.delete(f"/api/extensions/mcp/{server_id}").status_code == 404


def test_mcp_http_transport(client, http_mcp):
    response = client.post(
        "/api/extensions/mcp",
        json={"name": "HTTP Mock", "transport": "http", "url": http_mcp},
    )
    assert response.status_code == 201, response.get_json()
    server_id = response.get_json()["server"]["id"]
    test = client.post(f"/api/extensions/mcp/{server_id}/test").get_json()
    assert test["ok"] is True
    assert [tool["name"] for tool in test["tools"]] == ["http_echo"]
    agent_tools = client.get("/api/extensions/agent-tools").get_json()
    assert any(
        item["exposed_name"] == "mcp__HTTP_Mock__http_echo"
        for item in agent_tools["mcp_tools"]
    )


def test_mcp_config_validation(client):
    assert client.post("/api/extensions/mcp", json={}).status_code == 400
    assert (
        client.post(
            "/api/extensions/mcp", json={"name": "无命令", "transport": "stdio"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/extensions/mcp",
            json={"name": "坏 URL", "transport": "http", "url": "ftp://example.com"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/extensions/mcp", json={"name": "坏传输", "transport": "sse"}
        ).status_code
        == 400
    )
    # http 请求头支持 "Name: Value" 文本
    response = client.post(
        "/api/extensions/mcp",
        json={
            "name": "Header Mock",
            "transport": "http",
            "url": "http://127.0.0.1:9/mcp",
            "headers": "Authorization: Bearer test\nX-Demo: 1",
            "env": "TOKEN=abc",
        },
    )
    assert response.status_code == 201, response.get_json()
    headers = response.get_json()["server"]["headers"]
    assert headers["Authorization"] == "Bearer test"
    assert headers["X-Demo"] == "1"


# --------------------------------------------------------------- Agent 集成
def test_agent_uses_skill_and_mcp_tools(client, mock_llm, tmp_path):
    _write_skill(
        tmp_path,
        "echo-skill",
        "Echo 技能",
        "按 MCP echo 演示流程",
        "技能步骤：先调用 echo 工具，再总结结果。",
    )
    server_id = _add_stdio_mcp(client, tmp_path)
    agent_tools = client.get("/api/extensions/agent-tools").get_json()
    exposed = next(
        item["exposed_name"]
        for item in agent_tools["mcp_tools"]
        if item["server_id"] == server_id and item["tool_name"] == "echo"
    )
    configure_llm(client, mock_llm.url)
    mock_llm.script = [
        {
            "tool_calls": [
                {"id": "call_skill", "name": "use_skill", "arguments": {"name": "echo-skill"}}
            ]
        },
        {
            "tool_calls": [
                {
                    "id": "call_mcp",
                    "name": exposed,
                    "arguments": {"text": "hello mcp"},
                }
            ]
        },
        {"content": "技能与 MCP 工具都调用成功。"},
    ]

    conversation_id = new_conversation(client)
    response = send_message(
        client,
        conversation_id,
        "先读取 echo-skill 技能，再用 MCP 的 echo 工具打个招呼",
    )
    assert response.status_code == 201
    state = wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["content"] == "技能与 MCP 工具都调用成功。"
    tools = assistant["data"]["tools"]
    assert [tool["name"] for tool in tools] == ["use_skill", exposed]
    assert "技能步骤" in tools[0]["output"]
    assert "MCP echo: hello mcp" in tools[1]["output"]

    # 第一次请求：扩展工具 schema + 系统提示都注入
    first = mock_llm.captured[0]["body"]
    tool_names = {item["function"]["name"] for item in first["tools"]}
    assert {"list_skills", "use_skill", exposed} <= tool_names
    system_prompt = first["messages"][0]["content"]
    assert "Echo 技能" in system_prompt
    assert "MCP 扩展工具" in system_prompt
    # 第二次请求：带上技能工具结果
    assert mock_llm.captured[1]["body"]["messages"][-1]["role"] == "tool"
    assert "技能步骤" in mock_llm.captured[1]["body"]["messages"][-1]["content"]
    # 第三次请求：带上 MCP 工具结果，完成多步循环
    assert "MCP echo: hello mcp" in mock_llm.captured[2]["body"]["messages"][-1]["content"]


def test_agent_without_extensions_has_skill_tools_only(client, mock_llm):
    configure_llm(client, mock_llm.url)
    mock_llm.script = [{"content": "好的。"}]
    conversation_id = new_conversation(client)
    send_message(client, conversation_id, "你好")
    state = wait_for_reply(client, conversation_id)
    assert state["messages"][-1]["content"] == "好的。"
    tool_names = {
        item["function"]["name"] for item in mock_llm.captured[0]["body"]["tools"]
    }
    assert {"list_skills", "use_skill"} <= tool_names
    assert not any(name.startswith("mcp__") for name in tool_names)
