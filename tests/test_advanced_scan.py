"""进阶扫描能力测试：密钥、JWT、SSTI、SSRF、GraphQL、CSRF、HTML 报告、基础设施检查。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import socket
import threading

from pentest_agent.core.models import Finding, LabRun, Status
from pentest_agent.core.reporter import build_html, owasp_for, save_reports
from pentest_agent.engines import infra
from pentest_agent.engines.secrets import extract_endpoints, scan_secrets
from pentest_agent.engines.webapi import analyze_jwt, check_csrf_forms, check_graphql
from pentest_agent.engines.webscan import ScanConfig, WebScanner
from tests.mock_vuln_app import MockVulnServer


# ------------------------------------------------------------------ secrets
def test_secrets_scan_and_mask():
    text = (
        "const key='AKIAABCDEFGHIJKLMNOP'; "
        "const privateKey='-----BEGIN RSA PRIVATE KEY-----'; "
        "password = 'super-secret-pass'"
    )
    findings = scan_secrets(text, "http://example.test/app.js")
    titles = {finding.title for finding in findings}
    assert any("AWS Access Key" in title for title in titles)
    assert any("Private Key" in title for title in titles)
    assert any("通用口令赋值" in title for title in titles)
    for finding in findings:
        assert "AKIAABCDEFGHIJKLMNOP" not in (finding.evidence + finding.payload)


def test_extract_endpoints_from_js():
    js = 'fetch("/api/users?id=1"); const url = "https://x.test/status";'
    endpoints = extract_endpoints(js, "http://example.test/app.js")
    assert "/api/users?id=1" in endpoints


# ---------------------------------------------------------------------- JWT
def _make_jwt(secret: str, header: dict | None = None) -> str:
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    head = b64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"sub": "admin", "role": "admin"}).encode())
    signature = b64(hmac.new(secret.encode(), f"{head}.{payload}".encode(), hashlib.sha256).digest())
    return f"{head}.{payload}.{signature}"


def test_jwt_weak_secret_and_alg_none():
    weak = analyze_jwt([("http://example.test/", f"token={_make_jwt('secret')}")])
    assert any(finding.severity == "Critical" and "弱签名密钥" in finding.title for finding in weak)

    none_token = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
        "eyJ1c2VyIjoiYWRtaW4ifQ."
    )
    none = analyze_jwt([("http://example.test/", none_token)])
    assert any("alg=none" in finding.title for finding in none)


# --------------------------------------------------------------------- CSRF
def test_csrf_form_without_token():
    forms = [
        {
            "action": "http://example.test/login",
            "method": "POST",
            "fields": {"username": "", "password": ""},
            "types": {"username": "text", "password": "password"},
        },
        {
            "action": "http://example.test/transfer",
            "method": "POST",
            "fields": {"amount": "", "csrf_token": "x"},
            "types": {},
        },
    ]
    findings = check_csrf_forms(forms, "http://example.test/")
    assert len(findings) == 1
    assert findings[0].title.startswith("POST 表单缺少 CSRF")


# ---------------------------------------------------------------- GraphQL
def test_graphql_introspection_via_http_client():
    from pentest_agent.core.http import HttpClient

    with MockVulnServer() as server:
        client = HttpClient(server.base_url)
        findings = check_graphql(client, server.base_url)
        client.close()
    assert findings
    assert "GraphQL" in findings[0].title


# ------------------------------------------------------- 扫描器进阶检测项
def test_scanner_advanced_findings():
    with MockVulnServer() as server:
        config = ScanConfig.for_profile("quick")
        config.modules = {"headers", "files", "secrets", "web", "api"}
        config.time_based = False
        scanner = WebScanner(server.base_url, config=config)
        try:
            run = scanner.scan()
        finally:
            scanner.close()
    titles = {finding.title for finding in run.findings}
    assert "服务端模板注入（SSTI）" in titles
    assert "服务端请求伪造（SSRF，带外确认）" in titles
    assert "GraphQL 接口开启 introspection" in titles
    assert "Host 头注入（可污染绝对 URL/缓存）" in titles
    assert any(title.startswith("敏感信息泄露") for title in titles)
    assert any("JWT" in title for title in titles)
    assert run.meta["secrets_count"] >= 1
    assert run.meta["endpoints"]


# ---------------------------------------------------------- HTML 报告 / OWASP
def _sample_run() -> LabRun:
    run = LabRun(lab="WebScan", target_url="http://127.0.0.1:8899")
    run.findings = [
        Finding(
            lab="WebScan",
            target="http://127.0.0.1:8899/search?q=x",
            status=Status.EXPLOITED,
            title="SQL 注入（报错型）",
            severity="Critical",
            category="SQL 注入",
            technique="报错探测",
            payload="'",
            evidence="SQL syntax error",
            cwe="CWE-89",
            remediation="参数化查询",
        ),
        Finding(
            lab="WebScan",
            target="http://127.0.0.1:8899/.env",
            status=Status.EXPLOITED,
            title="环境变量泄露",
            severity="High",
            category="敏感文件泄露",
            evidence="DB_PASSWORD=secret",
            remediation="移除敏感文件",
        ),
    ]
    return run


def test_owasp_mapping():
    assert owasp_for("SQL 注入") == "A03:2021 Injection"
    assert owasp_for("SSRF") == "A01:2021 Broken Access Control"
    assert owasp_for("传输安全") == "A02:2021 Cryptographic Failures"
    assert owasp_for("未授权访问") == "A01:2021 Broken Access Control"


def test_html_report_generated(tmp_path):
    paths = save_reports([_sample_run()], tmp_path, meta={"目标": "http://127.0.0.1:8899"})
    assert paths["html"].exists()
    html = paths["html"].read_text()
    assert "渗透测试报告" in html
    assert "A03:2021 Injection" in html
    assert "SQL 注入" in html
    # 证据/标题必须转义，不能注入原始标签
    assert "DB_PASSWORD=secret" in html


def test_html_escapes_markup(tmp_path):
    run = _sample_run()
    run.findings[0].title = "<script>alert(1)</script>"
    html = build_html([run])
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# --------------------------------------------------------------- 基础设施
def test_redis_unauthorized_detection(monkeypatch):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]

    def fake_redis() -> None:
        conn, _ = server.accept()
        conn.recv(1024)
        conn.sendall(b"$123\r\n# Server\r\nredis_version:7.2.0\r\n")
        conn.close()

    thread = threading.Thread(target=fake_redis, daemon=True)
    thread.start()
    monkeypatch.setitem(infra.SERVICE_PROBES, port, "redis")
    try:
        findings, _services = infra.inspect_services("127.0.0.1", [{"port": port}])
    finally:
        server.close()
    assert any("Redis 未授权访问" in finding.title for finding in findings)


def test_tls_deep_check_handles_plain_http():
    # 对普通 HTTP 端口做 TLS 探测必须优雅失败，不抛异常
    findings = infra.tls_deep_check("127.0.0.1", 1)
    assert findings == []


def test_scan_profile_modules():
    assert "infra" in ScanConfig.for_profile("full").modules
    assert "infra" not in ScanConfig.for_profile("quick").modules
    assert ScanConfig.for_profile("recon").modules == {"dns", "ports", "tls", "headers"}
    assert ScanConfig.for_profile("recon").to_dict()["modules"] == ["dns", "headers", "ports", "tls"]
