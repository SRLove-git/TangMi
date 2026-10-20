"""核心组件单元测试（不依赖靶场，可离线运行）。

运行：.venv/bin/python -m pytest tests/ -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.core.models import Finding, LabRun, Status  # noqa: E402
from pentest_agent.core.scope import ScopeError, assert_in_scope, is_local_host  # noqa: E402


# ------------------------------------------------------------------ scope
def test_local_hosts_allowed():
    for host in ("127.0.0.1", "localhost", "10.0.0.5", "192.168.1.10", "::1"):
        assert is_local_host(host), host


def test_public_hosts_rejected():
    for host in ("8.8.8.8", "example.com", "1.1.1.1"):
        assert not is_local_host(host), host


def test_assert_in_scope_allows_local():
    assert assert_in_scope("http://127.0.0.1:4280") == "127.0.0.1"
    assert assert_in_scope("http://localhost:8085") == "localhost"


def test_assert_in_scope_rejects_public():
    with pytest.raises(ScopeError):
        assert_in_scope("http://example.com")
    # 显式授权后可放行
    assert assert_in_scope("http://example.com", allow_remote=True) == "example.com"


def test_assert_in_scope_rejects_non_http():
    with pytest.raises(ScopeError):
        assert_in_scope("ftp://127.0.0.1/file")


# ----------------------------------------------------------------- models
def _run() -> LabRun:
    run = LabRun(lab="DVWA", target_url="http://127.0.0.1:4280")
    run.add(Finding(lab="DVWA", target="sqli", level="low", status=Status.EXPLOITED))
    run.add(Finding(lab="DVWA", target="sqli", level="medium", status=Status.EXPLOITED))
    run.add(Finding(lab="DVWA", target="sqli", level="high", status=Status.EXPLOITED))
    run.add(Finding(lab="DVWA", target="sqli", level="impossible", status=Status.PROTECTED))
    run.finish()
    return run


def test_labrun_summary_and_solved():
    run = _run()
    summary = run.summary()
    assert summary["total"] == 4
    assert summary["exploited"] == 3
    assert summary["protected"] == 1
    assert summary["failed"] == 0
    assert summary["coverage"] == 100.0
    assert run.is_fully_solved() is True


def test_labrun_not_solved_when_failed():
    run = _run()
    run.add(Finding(lab="DVWA", target="xss_r", level="low", status=Status.FAILED))
    assert run.is_fully_solved() is False
    assert run.summary()["failed"] == 1


def test_labrun_serialization_roundtrip(tmp_path: Path):
    run = _run()
    path = tmp_path / "result.json"
    run.save_json(path)
    loaded = LabRun.load_json(path)
    assert loaded.lab == run.lab
    assert len(loaded.findings) == 4
    assert loaded.findings[0].status == Status.EXPLOITED
    assert loaded.is_fully_solved() is True


def test_finding_to_dict_contains_key_fields():
    data = Finding(
        lab="SQLi-Labs",
        target="Less-1",
        status=Status.EXPLOITED,
        payload="-1' UNION SELECT 1,2,3-- -",
        evidence="database()=security",
    ).to_dict()
    assert data["status"] == "exploited"
    assert data["lab"] == "SQLi-Labs"
    assert data["payload"].startswith("-1'")


def test_expectations_impossible_protected():
    run = _run()
    expected_exploit, expected_protected = run.expectations()
    assert expected_exploit == 3
    assert expected_protected == 1
