"""知识卡片 + AI 出题/判题测试（LLM 用 Fake，不访问网络）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent import knowledge  # noqa: E402
from pentest_agent.web import quiz  # noqa: E402
from pentest_agent.web.learning import LearningStore  # noqa: E402
from pentest_agent.web.server import create_app  # noqa: E402

QUIZ_JSON = json.dumps(
    {
        "questions": [
            {
                "id": 1,
                "difficulty": "easy",
                "question": "为什么 Less-5 不适合直接 UNION 回显？",
                "hint": "看看 PHP 打印了什么",
                "reference": "只判断行是否存在并打印固定文字，不输出字段内容",
            },
            {
                "id": 2,
                "difficulty": "medium",
                "question": "如何判断该关是报错注入还是布尔盲注？",
                "hint": "观察错误是否可见",
                "reference": "传 1' 看是否出现 SQL 语法错误",
            },
        ]
    },
    ensure_ascii=False,
)

GRADE_JSON = json.dumps(
    {
        "score": 85,
        "passed": True,
        "summary": "思路基本正确，继续注意条件构造。",
        "per_question": [
            {"id": 1, "correct": True, "comment": "正确，抓住了回显受限的本质。"},
            {"id": 2, "correct": True, "comment": "思路对，可以补充 error_reporting 的影响。"},
        ],
        "improvements": ["练习用布尔条件区分真假回显"],
    },
    ensure_ascii=False,
)


class FakeLLM:
    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.calls: list[dict] = []
        self.configured = True

    def chat_stream(self, messages, **kwargs):  # noqa: D102
        self.calls.append({"messages": messages, "kwargs": kwargs})
        return self.replies.pop(0)


# --------------------------------------------------------------------- 知识卡片
def test_knowledge_coverage():
    stats = knowledge.stats()
    assert stats["dvwa_modules"] == 19
    assert stats["sqli_groups"] == 13
    assert stats["sqli_lessons"] == 69
    for module in knowledge.all_dvwa():
        card = knowledge.dvwa_card(module)
        assert card and card.get("principle") and card.get("defense") and card.get("cwe")
    from pentest_agent.labs.sqli_labs import LESSON_IDS

    for lesson in LESSON_IDS:
        card = knowledge.sqli_card(lesson)
        assert card, f"{lesson} 缺少知识卡片"
        assert card.get("principle")


def test_knowledge_lookup_and_context():
    card = knowledge.card_for_item("dvwa:sqli:medium")
    assert card["title"] == "SQL 注入"
    assert card["cwe"] == "CWE-89"
    context = knowledge.tutor_context("dvwa:sqli:medium")
    assert "CWE-89" in context
    assert "原理" in context
    sqli = knowledge.card_for_item("sqli:Less-5")
    assert sqli["title"] == "UNION / 报错注入"
    assert knowledge.card_for_item("bad-key") is None


def test_knowledge_api(tmp_path):
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        response = client.get("/api/lab/knowledge?item_key=dvwa:sqli:low")
        assert response.status_code == 200
        data = response.get_json()
        assert data["card"]["title"] == "SQL 注入"
        assert data["stats"]["dvwa_modules"] == 19

        assert client.get("/api/lab/knowledge?item_key=nope").status_code == 404
        assert client.get("/api/lab/knowledge").status_code == 400


# --------------------------------------------------------------------- 出题
def test_extract_json_robust():
    assert quiz._extract_json("```json\n" + QUIZ_JSON + "\n```")["questions"]
    assert quiz._extract_json("好的，以下是题目：" + QUIZ_JSON)["questions"]
    with pytest.raises(quiz.QuizError):
        quiz._extract_json("没有 JSON")
    with pytest.raises(quiz.QuizError):
        quiz._extract_json("[1,2,3]")


def test_generate_quiz_with_fake_llm(tmp_path, monkeypatch):
    fake = FakeLLM([QUIZ_JSON])
    monkeypatch.setattr(quiz, "_llm", lambda root: fake)
    monkeypatch.setattr(
        quiz,
        "_item_context",
        lambda root, key, include_page=True: (
            knowledge.card_for_item(key) or {},
            "## 测试上下文",
        ),
    )
    result = quiz.generate_quiz(tmp_path, "dvwa:sqli:low", count=2)
    assert result["title"] == "SQL 注入"
    assert len(result["questions"]) == 2
    assert result["questions"][0]["question"]
    assert "reference" in result["questions"][0]
    assert len(fake.calls) == 1


def test_grade_quiz_with_fake_llm(tmp_path, monkeypatch):
    fake = FakeLLM([GRADE_JSON])
    monkeypatch.setattr(quiz, "_llm", lambda root: fake)
    monkeypatch.setattr(
        quiz,
        "_item_context",
        lambda root, key, include_page=True: (knowledge.card_for_item(key) or {}, "ctx"),
    )
    questions = [
        {"id": 1, "question": "q1", "reference": "r1"},
        {"id": 2, "question": "q2", "reference": "r2"},
    ]
    result = quiz.grade_quiz(
        tmp_path,
        "dvwa:sqli:low",
        questions,
        [{"id": 1, "answer": "a1"}, {"id": 2, "answer": "a2"}],
        hints_used=1,
    )
    assert result["score"] == 85
    assert result["passed"] is True
    assert len(result["per_question"]) == 2
    assert "布尔" in result["improvements"][0]

    with pytest.raises(quiz.QuizError):
        quiz.grade_quiz(tmp_path, "dvwa:sqli:low", questions, [], hints_used=0)


def test_quiz_without_llm_config(tmp_path):
    with pytest.raises(quiz.QuizError):
        quiz.generate_quiz(tmp_path, "dvwa:sqli:low")


# --------------------------------------------------------------------- API
def test_quiz_api_records_learning(tmp_path, monkeypatch):
    fake = FakeLLM([QUIZ_JSON, GRADE_JSON])
    monkeypatch.setattr(quiz, "_llm", lambda root: fake)
    monkeypatch.setattr(
        quiz,
        "_item_context",
        lambda root, key, include_page=True: (knowledge.card_for_item(key) or {}, "ctx"),
    )
    app = create_app(tmp_path)
    app.config.update(TESTING=True)
    with app.test_client() as client:
        generated = client.post(
            "/api/learning/dvwa:sqli:low/quiz/generate", json={"count": 2}
        )
        assert generated.status_code == 200, generated.get_json()
        questions = generated.get_json()["questions"]
        assert len(questions) == 2

        graded = client.post(
            "/api/learning/dvwa:sqli:low/quiz/grade",
            json={
                "questions": questions,
                "answers": [
                    {"id": item["id"], "answer": "我的回答"} for item in questions
                ],
                "hints_used": 1,
            },
        )
        assert graded.status_code == 200, graded.get_json()
        payload = graded.get_json()
        assert payload["result"]["score"] == 85
        assert payload["item"]["best_score"] == 85
        assert payload["item"]["status"] == "solved"
        assert payload["item"]["quiz_attempts"]

        snapshot = client.get("/api/learning").get_json()
        item = next(
            entry for entry in snapshot["labs"]["dvwa"] if entry["key"] == "dvwa:sqli:low"
        )
        assert item["best_score"] == 85
        assert snapshot["summary"]["quiz_passed"] >= 1

        assert (
            client.post("/api/learning/nope/quiz/generate", json={}).status_code == 400
        )
