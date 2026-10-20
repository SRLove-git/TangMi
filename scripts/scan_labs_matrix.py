#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对多个本地授权靶场批量执行通用 Web 渗透扫描（多靶场测试脚本）。

前置条件：各靶场已在 127.0.0.1 上启动（DVWA 4280、SQLi-Labs 8085、内置演示靶场 8899、
Juice Shop 13000、WebGoat 18080、VAmPI 15000、DSVW 8898、Vulpy 8897、
PyGoat 8896、NodeGoat 8895 等，可按需修改 LABS）。
结果写入 reports/labs_matrix/<slug>/，可配合聚合脚本生成汇总报告。
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / "bin" / "python"
OUT = ROOT / "reports" / "labs_matrix"

LABS = {
    "dvwa": "http://127.0.0.1:4280/",
    "sqli-labs": "http://127.0.0.1:8085/",
    "demo-vuln": "http://127.0.0.1:8899/",
    "juice-shop": "http://127.0.0.1:13000/",
    "webgoat": "http://127.0.0.1:18080/WebGoat/",
    "vampi": "http://127.0.0.1:15000/",
    "dsvw": "http://127.0.0.1:8898/",
    "vulpy": "http://127.0.0.1:8897/",
    "pygoat": "http://127.0.0.1:8896/",
    "nodegoat": "http://127.0.0.1:8895/",
}


def scan(slug: str) -> None:
    target = LABS[slug]
    outdir = OUT / slug
    outdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(PY), "-m", "pentest_agent", "scan", "--target", target,
        "--profile", "full", "--modules", "dns,headers,files,secrets,web,api",
        "--no-port-scan", "--delay", "0.02", "--report-dir", str(outdir),
    ]
    started = time.time()
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    summary = {}
    rp = outdir / "pentest_results.json"
    if rp.exists():
        runs = json.loads(rp.read_text(encoding="utf-8")).get("runs") or []
        if runs:
            summary = runs[0].get("summary") or {}
    print(f"[{slug}] exit={proc.returncode} time={time.time()-started:.1f}s summary={summary}", flush=True)


if __name__ == "__main__":
    for name in (sys.argv[1:] or list(LABS)):
        scan(name)
