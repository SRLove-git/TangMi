"""通用 Web 扫描引擎测试（离线，使用内置真实漏洞演示靶场）。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.core.scope import ScopeError
from pentest_agent.engines.webscan import ScanConfig, WebScanner
from pentest_agent.labs.demo_webapp import DemoVulnServer


@pytest.fixture(scope="module")
def demo_server():
    with DemoVulnServer() as server:
        yield server


def _scan(base_url: str, profile: str = "quick") -> object:
    config = ScanConfig.for_profile(profile)
    config.delay = 0.0
    config.port_scan = False
    config.login_tests = False
    config.time_based = False
    scanner = WebScanner(base_url, config=config)
    try:
        return scanner.scan()
    finally:
        scanner.close()


def test_recon_and_config_findings(demo_server):
    run = _scan(demo_server.base_url, "quick")
    titles = {finding.title for finding in run.findings}
    assert "缺少安全响应头" in titles
    assert "服务版本信息泄露" in titles
    assert "环境变量/密钥文件泄露" in titles
    assert "Git 仓库源码泄露" in titles
    assert any(finding.severity == "Critical" for finding in run.findings)


def test_active_vulnerability_findings(demo_server):
    run = _scan(demo_server.base_url, "quick")
    categories = {finding.category for finding in run.findings}
    titles = {finding.title for finding in run.findings}
    assert "SQL 注入" in categories
    assert "文件包含" in categories
    assert "命令注入" in categories
    assert "开放重定向" in categories
    assert "跨站脚本（XSS）" in categories
    assert any("SQL 注入" in title for title in titles)
    # 命令注入只应出现在会执行命令的 /search 参数上，反射型 /echo 不应误报
    rce_findings = [finding for finding in run.findings if finding.category == "命令注入"]
    assert rce_findings
    assert all("/search" in finding.target for finding in rce_findings)
    # 每个发现都应有 CWE / 修复建议，便于报告
    for finding in run.findings:
        if finding.severity in ("Critical", "High", "Medium"):
            assert finding.cwe, f"{finding.title} 缺少 CWE"
            assert finding.remediation, f"{finding.title} 缺少修复建议"


def test_recon_profile_has_no_active_findings(demo_server):
    run = _scan(demo_server.base_url, "recon")
    categories = {finding.category for finding in run.findings}
    assert "SQL 注入" not in categories
    assert "命令注入" not in categories
    assert "文件包含" not in categories


def test_scope_guard_rejects_public_target():
    scanner = WebScanner("http://example.com", config=ScanConfig.for_profile("recon"))
    with pytest.raises(ScopeError):
        scanner.scan()
    scanner.close()


def test_finding_serialization_has_security_fields(demo_server):
    run = _scan(demo_server.base_url, "quick")
    data = run.findings[0].to_dict()
    for key in ("category", "cwe", "remediation", "cvss"):
        assert key in data
