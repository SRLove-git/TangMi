"""SQLi-Labs 解题器的轻量单元测试（不依赖网络/靶场）。"""

from __future__ import annotations

import inspect

from pentest_agent.labs.sqli_labs import (
    CHALLENGE_IDS,
    LESSON_IDS,
    SqliLabsTarget,
    _lesson_sort_key,
)


def test_lesson_catalog_has_69_unique_entries() -> None:
    assert len(LESSON_IDS) == 69
    assert len(set(LESSON_IDS)) == 69
    assert LESSON_IDS[0] == "Less-1"
    assert "Less-65" in LESSON_IDS
    assert {"Less-25a", "Less-26a", "Less-27a", "Less-28a"} <= set(LESSON_IDS)
    assert set(CHALLENGE_IDS) == {f"Less-{i}" for i in range(54, 66)}


def test_lesson_sort_key_is_numeric() -> None:
    ordered = sorted(["Less-25a", "Less-25", "Less-9", "Less-1"], key=_lesson_sort_key)
    assert ordered == ["Less-1", "Less-9", "Less-25", "Less-25a"]


def test_challenge_identifier_validators() -> None:
    target = SqliLabsTarget("http://127.0.0.1:8085", timeout=1)
    try:
        assert target._valid_key("aB3" * 8)                      # 24 位
        assert not target._valid_key("short")
        assert target._valid_challenge_ids("ABCDEFGHIJ", "secret_AB12")
        assert not target._valid_challenge_ids("bad", "secret_AB12")
        assert not target._valid_challenge_ids("ABCDEFGHIJ", "secret_ab12")
    finally:
        target.close()


def test_solver_public_interface() -> None:
    target = SqliLabsTarget("http://localhost:9", timeout=1)
    try:
        solve_sig = inspect.signature(target.solve)
        assert "lessons" in solve_sig.parameters
        assert callable(target.close)
        assert callable(target.reset_db)
        assert callable(target.discover_lessons)
    finally:
        target.close()
