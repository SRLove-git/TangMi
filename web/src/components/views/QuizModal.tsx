import { useEffect, useState } from "react";
import { Brain, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { api } from "../../api";
import type {
  LearningItem,
  QuizGenerateResult,
  QuizGradeResult,
} from "../../types";
import Overlay from "../chat/Overlay";

interface Props {
  item: LearningItem;
  onClose: () => void;
  onUpdated: () => void;
}

/** AI 出题练习：基于知识卡片 + 关卡源码生成变体题，提交后逐题点评。 */
export default function QuizModal({ item, onClose, onUpdated }: Props) {
  const [quiz, setQuiz] = useState<QuizGenerateResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<QuizGradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    setResult(null);
    setAnswers({});
    try {
      setQuiz(await api.quizGenerate(item.key, 3));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key]);

  async function grade() {
    if (!quiz) return;
    setGrading(true);
    setError("");
    try {
      const payload = {
        questions: quiz.questions,
        answers: quiz.questions.map((question) => ({
          id: question.id,
          answer: answers[question.id] ?? "",
        })),
        hints_used: item.hints,
      };
      const response = await api.quizGrade(item.key, payload);
      setResult(response.result);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGrading(false);
    }
  }

  const answeredCount = Object.values(answers).filter((text) => text.trim()).length;

  return (
    <Overlay
      title={`AI 出题练习 · ${item.title}`}
      subtitle={`根据知识卡片与关卡源码出 3 道变体题（已看 ${item.hints} 层提示，判分会更严格）；≥80 分自动标记已掌握`}
      onClose={onClose}
      wide
    >
      {error && <div className="alert error">{error}</div>}

      {!result && (
        <>
          {loading && (
            <div className="quiz-loading">
              <Loader2 size={18} className="spin" />
              <span>AI 正在根据本关知识点出题…</span>
            </div>
          )}

          {!loading && quiz && (
            <div className="quiz-list">
              {quiz.questions.map((question) => (
                <div className="quiz-question" key={question.id}>
                  <div className="quiz-question-head">
                    <span className="quiz-index">Q{question.id}</span>
                    <span className="deploy-chip">{question.difficulty}</span>
                  </div>
                  <p className="quiz-text">{question.question}</p>
                  {question.hint && (
                    <details className="quiz-hint">
                      <summary>看提示</summary>
                      <p>{question.hint}</p>
                    </details>
                  )}
                  <textarea
                    className="text-input quiz-answer"
                    rows={3}
                    placeholder="写下你的思路 / payload 思路 / 判断方法…"
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
                    }
                  />
                </div>
              ))}

              <div className="quiz-actions">
                <button
                  className="btn primary"
                  onClick={() => void grade()}
                  disabled={grading || answeredCount === 0}
                >
                  {grading ? <Loader2 size={14} className="spin" /> : <Brain size={14} />}
                  {grading ? "批改中…" : `提交批改（已答 ${answeredCount}/${quiz.questions.length}）`}
                </button>
                <button className="btn" onClick={() => void generate()} disabled={grading}>
                  <RefreshCw size={14} />
                  换一组题
                </button>
                <span className="form-hint">开放题按「原理 / 判断方法 / 防御」要点评分，合理变体也算对。</span>
              </div>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="quiz-result">
          <div className={`quiz-score ${result.passed ? "passed" : "failed"}`}>
            {result.passed ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
            <div>
              <b>{result.score}</b>
              <span>分 · {result.passed ? "通过" : "未通过（80 分通过）"}</span>
            </div>
          </div>
          <p className="quiz-summary">{result.summary}</p>

          <div className="quiz-review">
            {result.per_question.map((feedback) => {
              const question = quiz?.questions.find((item) => item.id === feedback.id);
              return (
                <div
                  className={`quiz-feedback ${feedback.correct ? "ok" : "bad"}`}
                  key={feedback.id}
                >
                  <div className="quiz-feedback-head">
                    <b>Q{feedback.id}</b>
                    <span>{feedback.correct ? "✓ 正确" : "✗ 需改进"}</span>
                  </div>
                  {question && <p className="quiz-feedback-question">{question.question}</p>}
                  <p>{feedback.comment}</p>
                </div>
              );
            })}
          </div>

          {result.improvements.length > 0 && (
            <div className="quiz-improvements">
              <b>下一步改进</b>
              <ul>
                {result.improvements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="quiz-actions">
            <button className="btn primary" onClick={() => void generate()}>
              <RefreshCw size={14} />
              再来一组
            </button>
            <button className="btn" onClick={onClose}>
              完成，返回关卡
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}
