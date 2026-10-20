"""平台能力测试：扫描历史、资产台账、漏洞生命周期、策略与项目配置。"""

from __future__ import annotations

from pathlib import Path

from pentest_agent.web.security_db import SecurityDB
from pentest_agent.web.server import create_app


def _sample_findings():
    return [
        {
            "title": "SQL 注入（报错型）",
            "target": "http://127.0.0.1:8899/search?q=x",
            "severity": "Critical",
            "category": "SQL 注入",
            "cwe": "CWE-89",
            "technique": "报错探测",
            "payload": "'",
            "evidence": "SQL syntax error",
            "remediation": "参数化查询",
            "cvss": 9.1,
        },
        {
            "title": "缺少安全响应头",
            "target": "http://127.0.0.1:8899/",
            "severity": "Medium",
            "category": "安全配置",
            "cwe": "CWE-693",
            "evidence": "missing CSP",
            "remediation": "配置 CSP",
            "cvss": 5.3,
        },
    ]


def test_security_db_scan_assets_vulns(tmp_path):
    db = SecurityDB(tmp_path / "security.db")
    db.record_scan(
        run_id="scan-1",
        project_id="proj-1",
        target="http://127.0.0.1:8899",
        lab="web",
        profile="full",
        status="completed",
        findings=_sample_findings(),
    )
    db.add_assets(
        "proj-1",
        "scan-1",
        "http://127.0.0.1:8899",
        {
            "tech": ["PHP", "nginx"],
            "open_ports": [{"port": 8899, "service": "unknown"}],
            "subdomains": ["app.example.test"],
            "endpoints": ["/search?q="],
        },
    )
    result = db.upsert_vulnerabilities("proj-1", "scan-1", _sample_findings())
    assert result["created"] == 2

    scans = db.list_scans()
    assert scans and scans[0]["findings_count"] == 2
    assert scans[0]["critical"] == 1

    assets = db.list_assets()
    assert len(assets) >= 3
    kinds = {item["kind"] for item in assets}
    assert {"host", "tech", "port", "subdomain", "endpoint"} & kinds

    vulns = db.list_vulnerabilities()
    assert len(vulns) == 2
    assert vulns[0]["severity"] == "Critical"
    assert vulns[0]["owasp"].startswith("A03")

    # 去重：同一漏洞再次上报只更新 last_seen
    again = db.upsert_vulnerabilities("proj-1", "scan-2", _sample_findings())
    assert again["created"] == 0 and again["updated"] == 2

    updated = db.update_vulnerability(vulns[0]["id"], status="fixed", note="已修复")
    assert updated is not None
    assert updated["status"] == "fixed" and updated["status_label"] == "已修复"
    db.close()


def test_security_db_dashboard(tmp_path):
    db = SecurityDB(tmp_path / "security.db")
    db.record_scan(
        run_id="scan-a",
        project_id="",
        target="http://127.0.0.1:8899",
        lab="web",
        profile="quick",
        status="completed",
        findings=_sample_findings(),
    )
    db.upsert_vulnerabilities("", "scan-a", _sample_findings())
    data = db.dashboard()
    assert data["vuln_total"] == 2
    assert data["scans"] == 1
    assert data["severity"]["Critical"] == 1
    assert data["categories"]
    assert data["owasp"]
    db.close()


def test_platform_api(tmp_path):
    app = create_app(Path(tmp_path))
    client = app.test_client()
    manager = app.config["MANAGER"]
    manager.db.record_scan(
        run_id="scan-api",
        project_id="proj-api",
        target="http://127.0.0.1:8899",
        lab="web",
        profile="quick",
        status="completed",
        findings=_sample_findings(),
    )
    manager.db.upsert_vulnerabilities("proj-api", "scan-api", _sample_findings())

    dashboard = client.get("/api/dashboard").get_json()
    assert dashboard["vuln_total"] == 2

    vulns = client.get("/api/vulnerabilities").get_json()["vulnerabilities"]
    assert len(vulns) == 2
    vuln_id = vulns[0]["id"]
    response = client.patch(f"/api/vulnerabilities/{vuln_id}", json={"status": "confirmed"})
    assert response.status_code == 200
    assert response.get_json()["vulnerability"]["status"] == "confirmed"

    invalid = client.patch(f"/api/vulnerabilities/{vuln_id}", json={"status": "unknown"})
    assert invalid.status_code == 400

    assert client.get("/api/scans").get_json()["scans"]
    assert client.get("/api/policies").get_json()["policies"]


def test_project_policy_and_headers(tmp_path):
    app = create_app(Path(tmp_path))
    client = app.test_client()
    # 避免真实网络探测：项目创建后直接 PATCH 配置
    created = client.post(
        "/api/projects", json={"name": "测试项目", "target": "http://127.0.0.1:8899"}
    )
    assert created.status_code == 201
    project_id = created.get_json()["project"]["id"]
    updated = client.patch(
        f"/api/projects/{project_id}",
        json={
            "policy": "full",
            "headers": {"Authorization": "Bearer test-token"},
            "allow_remote": False,
        },
    )
    assert updated.status_code == 200
    project = updated.get_json()["project"]
    assert project["policy"] == "full"
    assert project["headers"]["Authorization"] == "Bearer test-token"


def test_web_scan_run_api_scope_guard(tmp_path):
    app = create_app(Path(tmp_path))
    client = app.test_client()
    # 公网目标在未显式 allow_remote 时应被作用域守卫拒绝
    response = client.post(
        "/api/runs",
        json={"target": "https://example.com", "lab": "web", "profile": "recon"},
    )
    assert response.status_code == 400
