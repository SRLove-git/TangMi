"""连真实靶场的集成验收测试（默认跳过，需要靶场运行）。

运行：
    .venv/bin/python -m pytest tests/test_live.py -m live -v
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pytestmark = pytest.mark.live

DVWA_URL = os.environ.get("DVWA_URL", "http://127.0.0.1:4280")
SQLI_URL = os.environ.get("SQLI_URL", "http://127.0.0.1:8085")


def _http_ok(url: str) -> bool:
    try:
        return requests.get(url, timeout=5).status_code < 500
    except requests.RequestException:
        return False


def test_labs_reachable():
    assert _http_ok(f"{DVWA_URL}/login.php"), "DVWA 未运行，请先执行 labs up"
    assert _http_ok(f"{SQLI_URL}/Less-1/"), "SQLi-Labs 未运行，请先执行 labs up"


def test_dvwa_full_suite():
    from pentest_agent.labs.dvwa import DvwaTarget

    target = DvwaTarget(DVWA_URL, use_browser=False)
    try:
        run = target.solve()
    finally:
        target.close()
    summary = run.summary()
    failed = [f.key for f in run.findings if f.status.value in ("failed", "error")]
    assert summary["total"] == 76
    assert not failed, f"DVWA 未通关: {failed}"
    assert run.is_fully_solved()


def test_sqli_labs_full_suite():
    from pentest_agent.labs.sqli_labs import SqliLabsTarget

    target = SqliLabsTarget(SQLI_URL)
    try:
        run = target.solve()
    finally:
        target.close()
    failed = [f.target for f in run.findings if f.status.value in ("failed", "error")]
    assert len(run.findings) >= 65, f"关卡数异常: {len(run.findings)}"
    assert not failed, f"SQLi-Labs 未通关: {failed}"
