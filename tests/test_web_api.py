"""Web 控制台后端 API 测试（离线，不访问靶场）。

运行：.venv/bin/python -m pytest tests/test_web_api.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.server import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def client():
    app = create_app(ROOT)
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_index_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Pentest Agent" in response.data


def test_catalog(client):
    response = client.get("/api/catalog")
    assert response.status_code == 200
    data = response.get_json()
    assert len(data["dvwa"]["modules"]) == 19
    assert data["dvwa"]["levels"] == ["low", "medium", "high", "impossible"]
    assert len(data["sqli_labs"]["lessons"]) == 69
    assert "Less-25a" in data["sqli_labs"]["lessons"]


def test_reports_list_and_content(client):
    response = client.get("/api/reports")
    assert response.status_code == 200
    names = [item["name"] for item in response.get_json()["reports"]]
    assert "pentest_report.md" in names

    report = client.get("/api/reports/pentest_report.md")
    assert report.status_code == 200
    assert "渗透测试报告" in report.get_data(as_text=True)

    kinds = {item["kind"] for item in response.get_json()["reports"]}
    assert "markdown" in kinds
    assert "html" in kinds
    html_report = client.get("/api/reports/pentest_report.html")
    assert html_report.status_code == 200
    assert html_report.mimetype == "text/html"
    assert "渗透测试报告" in html_report.get_data(as_text=True)


def test_report_path_traversal_blocked(client):
    response = client.get("/api/reports/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code == 404


def test_create_run_validation(client):
    assert client.post("/api/runs", json={}).status_code == 400
    assert (
        client.post("/api/runs", json={"target": "http://127.0.0.1:4280", "lab": "bad"}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/runs",
            json={"target": "http://127.0.0.1:4280", "lab": "dvwa", "levels": ["nope"]},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/runs",
            json={"target": "http://127.0.0.1:8085", "lab": "sqli-labs", "lessons": "abc"},
        ).status_code
        == 400
    )


def test_unknown_api_404(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.get_json()["error"]


# ------------------------------------------------------------ 对话工作区 API
def test_chat_default_projects(client):
    response = client.get("/api/projects")
    assert response.status_code == 200
    projects = response.get_json()["projects"]
    assert len(projects) >= 2
    labs = {project["lab"] for project in projects}
    assert "dvwa" in labs and "sqli-labs" in labs


def test_chat_conversation_flow(client):
    project_id = client.get("/api/projects").get_json()["projects"][0]["id"]
    created = client.post(f"/api/projects/{project_id}/conversations", json={})
    assert created.status_code == 201
    conversation_id = created.get_json()["id"]

    fetched = client.get(f"/api/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.get_json()["messages"] == []

    empty = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "  "})
    assert empty.status_code == 400

    deleted = client.delete(f"/api/conversations/{conversation_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/conversations/{conversation_id}").status_code == 404


def test_chat_project_scope_guard(client):
    public = client.post("/api/projects", json={"name": "bad", "target": "http://example.com"})
    assert public.status_code == 400
    assert "作用域" in public.get_json()["error"] or "本地" in public.get_json()["error"]

    invalid = client.post("/api/projects", json={"name": "bad", "target": "not-a-url"})
    assert invalid.status_code == 400
