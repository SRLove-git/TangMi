"""本机靶场源测试：内置 / 已部署 / 演示站聚合与去重。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web import local_sources  # noqa: E402
from pentest_agent.web.server import create_app  # noqa: E402


class FakeDeploy:
    def __init__(self, labs):
        self._labs = labs

    def local_labs(self):
        return list(self._labs)


def test_sources_aggregate_and_dedupe(tmp_path):
    deploy = FakeDeploy(
        [
            {
                "key": "dvwa",
                "name": "DVWA",
                "target": "http://127.0.0.1:4280/login.php",
                "credentials": "admin / password",
                "note": "已部署",
                "tags": ["综合 Web"],
            },
            {
                "key": "vampi",
                "name": "VAmPI",
                "target": "http://127.0.0.1:15000/",
                "credentials": "",
                "note": "已部署",
                "tags": ["API"],
            },
        ]
    )
    probe = lambda url, path="/": "8085" not in url  # noqa: E731
    result = local_sources.local_lab_sources(tmp_path, deploy, probe=probe)
    targets = {source["target"] for source in result["sources"]}
    # DVWA 与部署项按 origin 去重，只保留内置那一条
    assert "http://127.0.0.1:4280" in targets
    assert "http://127.0.0.1:4280/login.php" not in targets
    assert "http://127.0.0.1:15000" in targets
    assert "http://127.0.0.1:8085" in targets
    assert result["total"] == 4
    # 8085 探活失败 → 离线
    sqli = next(s for s in result["sources"] if s["key"] == "builtin:sqli-labs")
    assert sqli["online"] is False
    assert result["online"] == 3
    kinds = {source["kind"] for source in result["sources"]}
    assert {"builtin", "demo", "deploy"} == kinds


def test_sources_without_deploy_manager(tmp_path):
    result = local_sources.local_lab_sources(tmp_path, None, probe=lambda url, path="/": True)
    assert result["total"] == 3
    assert result["online"] == 3


def test_local_sources_api(tmp_path, monkeypatch):
    monkeypatch.setattr(local_sources, "_default_probe", lambda url, path="/": True)
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    app.config["DEPLOY"] = FakeDeploy(
        [
            {
                "key": "juice-shop",
                "name": "OWASP Juice Shop",
                "target": "http://127.0.0.1:13000/",
                "credentials": "",
                "note": "已部署",
                "tags": ["综合 Web"],
            }
        ]
    )
    with app.test_client() as client:
        response = client.get("/api/labs/local")
        assert response.status_code == 200
        data = response.get_json()
        assert data["total"] == 4
        assert data["online"] == 4
        assert any(source["name"] == "OWASP Juice Shop" for source in data["sources"])
        assert data["sources"][0]["kind"] == "builtin"
