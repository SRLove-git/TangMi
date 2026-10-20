"""学习进度 / 错题本测试。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.learning import (  # noqa: E402
    LearningStore,
    all_items,
    dvwa_item_key,
    parse_item_key,
    sqli_item_key,
)
from pentest_agent.web.server import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def test_item_catalog_and_parse():
    items = all_items()
    assert len(items) == 76 + 69
    dvwa = parse_item_key(dvwa_item_key("sqli", "medium"))
    assert dvwa["lab"] == "dvwa"
    assert dvwa["module"] == "sqli"
    assert dvwa["level"] == "medium"
    assert "SQL 注入" in dvwa["title"]
    sqli = parse_item_key(sqli_item_key("less-5"))
    assert sqli["key"] == "sqli:Less-5"
    assert sqli["url"].endswith("/Less-5/")
    with pytest.raises(ValueError):
        parse_item_key("dvwa:not-a-module:low")
    with pytest.raises(ValueError):
        parse_item_key("sqli:Less-999")
    with pytest.raises(ValueError):
        sqli_item_key("Less-999")


def test_store_update_and_hints(tmp_path):
    store = LearningStore(tmp_path)
    key = dvwa_item_key("xss_r", "low")
    item = store.get(key)
    assert item["status"] == "not_started"
    assert item["auto_verified"] is False

    # 看提示会自动进入「在学」并记录最高层级
    store.record_hint(key, 1)
    store.record_hint(key, 3)
    item = store.get(key)
    assert item["status"] == "learning"
    assert item["hints"] == 3

    # 记笔记 / 标记已掌握
    store.update(key, note="反射型 XSS 要闭合标签")
    item = store.get(key)
    assert item["notes"] == "反射型 XSS 要闭合标签"
    store.mark_solved(key)
    assert store.get(key)["status"] == "solved"

    summary = store.snapshot()["summary"]
    assert summary["total"] == 145
    assert summary["solved"] == 1
    assert summary["learning"] == 0
    assert summary["notes"] == 1

    with pytest.raises(ValueError):
        store.update(key, status="unknown")
    with pytest.raises(ValueError):
        store.update(key, note="x" * 6000)


def test_tutor_turn_counts(tmp_path):
    store = LearningStore(tmp_path)
    key = "sqli:Less-1"
    store.record_tutor_turn(key)
    store.record_tutor_turn(key)
    item = store.get(key)
    assert item["tutor_turns"] == 2
    assert item["status"] == "learning"


def test_seed_from_runs(tmp_path):
    runs = tmp_path / "web_runs"
    runs.mkdir(parents=True)
    dvwa_run = {
        "id": "scan-1",
        "kind": "scan",
        "config": {"lab": "dvwa"},
        "findings": [
            {"title": "SQL 注入（UNION）", "level": "low", "status": "exploited"},
            {"title": "跨站请求伪造（修改管理员口令）", "level": "medium", "status": "exploited"},
            {"title": "密码学弱点利用", "level": "high", "status": "protected"},
        ],
    }
    sqli_run = {
        "id": "scan-2",
        "kind": "scan",
        "config": {"lab": "sqli-labs"},
        "findings": [
            {"title": "Less-1 UNION 注入", "status": "exploited"},
            {"title": "Less-5 报错注入", "status": "exploited"},
        ],
    }
    (runs / "scan-1.json").write_text(json.dumps(dvwa_run), encoding="utf-8")
    (runs / "scan-2.json").write_text(json.dumps(sqli_run), encoding="utf-8")

    store = LearningStore(tmp_path)
    store.seed_from_runs(force=True, min_findings=1)
    snapshot = store.snapshot()
    assert snapshot["seeded"] is True
    assert snapshot["summary"]["auto_verified"] == 5
    assert snapshot["labs"]["dvwa"][0]["status"] == "not_started"
    keys = {
        item["key"]
        for item in snapshot["labs"]["dvwa"]
        if item["auto_verified"]
    }
    assert "dvwa:sqli:low" in keys
    assert "dvwa:csrf:medium" in keys
    assert "dvwa:cryptography:high" in keys
    sqli_auto = [
        item["key"] for item in snapshot["labs"]["sqli-labs"] if item["auto_verified"]
    ]
    assert "sqli:Less-1" in sqli_auto and "sqli:Less-5" in sqli_auto


def test_learning_api(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        response = client.get("/api/learning")
        assert response.status_code == 200
        data = response.get_json()
        assert data["summary"]["total"] == 145
        assert len(data["labs"]["dvwa"]) == 76
        assert len(data["labs"]["sqli-labs"]) == 69

        updated = client.patch(
            "/api/learning/dvwa:sqli:low",
            json={"status": "learning", "note": "先确认闭合"},
        )
        assert updated.status_code == 200
        assert updated.get_json()["item"]["status"] == "learning"
        assert updated.get_json()["item"]["notes"] == "先确认闭合"

        assert (
            client.patch("/api/learning/dvwa:sqli:low", json={"status": "bad"}).status_code
            == 400
        )
        assert (
            client.patch("/api/learning/dvwa:nope:low", json={"status": "learning"}).status_code
            == 400
        )


def test_message_data_validation(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        projects = client.get("/api/projects").get_json()["projects"]
        project_id = projects[0]["id"]
        conversation = client.post(
            f"/api/projects/{project_id}/conversations", json={}
        ).get_json()
        cid = conversation["id"]

        bad_key = client.post(
            f"/api/conversations/{cid}/messages",
            json={
                "content": "给我提示",
                "mode": "tutor",
                "data": {"item_key": "dvwa:nope:low"},
            },
        )
        assert bad_key.status_code == 400
        bad_level = client.post(
            f"/api/conversations/{cid}/messages",
            json={
                "content": "给我提示",
                "mode": "tutor",
                "data": {"item_key": "dvwa:sqli:low", "hint_level": 9},
            },
        )
        assert bad_level.status_code == 400

        # 合法 data 会写入用户消息（tutor 未配置时返回配置引导，不影响消息落库）
        ok = client.post(
            f"/api/conversations/{cid}/messages",
            json={
                "content": "给我第一层提示",
                "mode": "tutor",
                "data": {"item_key": "dvwa:sqli:low", "hint_level": 1},
            },
        )
        assert ok.status_code == 201
        message = ok.get_json()["message"]
        assert message["data"]["item_key"] == "dvwa:sqli:low"
        assert message["data"]["hint_level"] == 1


# ---------------------------------------------------------------- 复习 / 报告
def test_review_scheduling_and_streak(tmp_path):
    store = LearningStore(tmp_path)
    key = "sqli:Less-1"
    item = store.update(key, status="solved")
    assert item["review_at"], "标记已掌握后应安排 3 天后复习"
    assert item["status"] == "solved"

    item = store.update(key, status="review")
    assert item["review_at"]

    reviewed = store.mark_reviewed(key)
    assert reviewed["review_count"] == 1
    assert reviewed["status"] == "learning"
    assert reviewed["review_at"]

    # 同一天的学习事件，连续天数 = 1
    assert store.snapshot()["summary"]["streak"] >= 1


def test_record_quiz_updates_best_score(tmp_path):
    store = LearningStore(tmp_path)
    key = "dvwa:xss_r:low"
    store.record_quiz(key, score=60, passed=False, summary="一般", question_count=3)
    item = store.get(key)
    assert item["best_score"] == 60
    assert item["status"] != "solved"

    store.record_quiz(key, score=90, passed=True, summary="很好", question_count=3)
    item = store.get(key)
    assert item["best_score"] == 90
    assert item["status"] == "solved"
    assert len(item["quiz_attempts"]) == 2


def test_learning_report_markdown(tmp_path):
    from pentest_agent.web.learning import build_learning_report

    store = LearningStore(tmp_path)
    store.update("dvwa:sqli:low", status="solved", note="先判闭合，再 UNION")
    store.record_hint("dvwa:sqli:medium", 2)
    report = build_learning_report(tmp_path, include_ai=False)
    markdown = report["markdown"]
    assert "# 靶场学习报告" in markdown
    assert "## 二、DVWA 进度" in markdown
    assert "## 四、错题 / 学习笔记" in markdown
    assert "先判闭合" in markdown
    assert report["filename"].endswith(".md")
    assert Path(report["path"]).exists()


def test_review_api_and_report_api(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        client.patch("/api/learning/sqli:Less-2", json={"status": "review"})
        reviewed = client.patch(
            "/api/learning/sqli:Less-2", json={"review_done": True}
        )
        assert reviewed.status_code == 200
        assert reviewed.get_json()["item"]["review_count"] == 1

        report = client.get("/api/learning/report")
        assert report.status_code == 200
        data = report.get_json()
        assert "# 靶场学习报告" in data["markdown"]
        assert data["summary"]["total"] == 145

        report_ai = client.get("/api/learning/report?ai=1")
        assert report_ai.status_code == 200
