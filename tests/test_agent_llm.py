"""LLM Agent 循环测试：执行模式自然语言对话、思考流、工具调用卡片、错误兜底。

全部离线执行，用本地 ThreadingHTTPServer 模拟 OpenAI 兼容接口：
- 按脚本顺序返回内容 / reasoning_content / tool_calls；
- 断言第二次请求里带上了 role=tool 的工具结果，说明 Agent 真的完成了循环。

运行：.venv/bin/python -m pytest tests/test_agent_llm.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pentest_agent.web.server import create_app  # noqa: E402
from mock_llm import (  # noqa: E402
    MockLLM,
    configure_llm,
    free_port,
    new_conversation,
    send_message,
    wait_for_reply,
)


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


def configure_llm(client, base_url: str) -> dict:
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


def new_conversation(client) -> str:
    projects = client.get("/api/projects").get_json()["projects"]
    dvwa = next(item for item in projects if item["lab"] == "dvwa")
    created = client.post(f"/api/projects/{dvwa['id']}/conversations", json={})
    assert created.status_code == 201
    return created.get_json()["id"]


def send_message(client, conversation_id: str, content: str, mode: str = "agent"):
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
    configure_llm(client, mock_llm.url)
    conversation_id = new_conversation(client)
    response = send_message(client, conversation_id, "你好，介绍一下你自己")
    assert response.status_code == 201

    state = wait_for_reply(client, conversation_id)
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
    configure_llm(client, mock_llm.url)
    conversation_id = new_conversation(client)
    send_message(client, conversation_id, "先看下靶场状态，然后给我结论")

    state = wait_for_reply(client, conversation_id)
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
    configure_llm(client, mock_llm.url)
    conversation_id = new_conversation(client)
    send_message(client, conversation_id, "把目标改成 ftp://example.com")

    state = wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["content"].startswith("目标地址不合法")
    tool = assistant["data"]["tools"][0]
    assert tool["status"] == "error"
    assert "http://" in tool["output"]
    tool_message = json.loads(mock_llm.captured[1]["body"]["messages"][-1]["content"])
    assert tool_message["ok"] is False


def test_agent_mode_uses_rule_engine_without_llm(client):
    conversation_id = new_conversation(client)
    send_message(client, conversation_id, "你能干什么")
    state = wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] in ("help", "text")
    assert "教学模式" in assistant["content"]
    # 没有配置大模型时不会创建流式占位消息
    assert all(item["data"].get("streaming") is not True for item in state["messages"])


def test_agent_llm_connection_error_is_friendly(client):
    configure_llm(client, f"http://127.0.0.1:{free_port()}/v1")
    conversation_id = new_conversation(client)
    send_message(client, conversation_id, "你好")
    state = wait_for_reply(client, conversation_id)
    assistant = state["messages"][-1]
    assert assistant["kind"] == "error"
    assert "智能体暂时不可用" in assistant["content"]
    assert "AI 教学模型" in assistant["content"]
