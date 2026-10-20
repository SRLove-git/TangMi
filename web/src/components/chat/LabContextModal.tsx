import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { Catalog, Project } from "../../types";
import Overlay from "./Overlay";

interface Props {
  project: Project;
  onClose: () => void;
  onPick: (itemKey: string, title: string) => void;
}

/** 教学模式里手动选择关卡：导师会自动读取该关卡的真实页面与源码。 */
export default function LabContextModal({ project, onClose, onPick }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [moduleKey, setModuleKey] = useState("sqli");
  const [level, setLevel] = useState("low");
  const [lesson, setLesson] = useState("Less-1");

  useEffect(() => {
    let cancelled = false;
    api
      .catalog()
      .then((data) => {
        if (!cancelled) {
          setCatalog(data);
          if (data.dvwa.modules.length > 0 && data.dvwa.modules[0].key) {
            // 默认选中 SQL 注入，最常问
            const preferred = data.dvwa.modules.find((item) => item.key === "sqli");
            if (preferred) setModuleKey(preferred.key);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDvwa = project.lab === "dvwa";
  const moduleInfo = catalog?.dvwa.modules.find((item) => item.key === moduleKey);
  const itemKey = isDvwa ? `dvwa:${moduleKey}:${level}` : `sqli:${lesson}`;
  const title = useMemo(() => {
    if (isDvwa) {
      return `DVWA · ${moduleInfo?.title ?? moduleKey} · ${level}`;
    }
    return `SQLi-Labs · ${lesson}`;
  }, [isDvwa, moduleInfo, moduleKey, level, lesson]);

  return (
    <Overlay
      title="读取当前关卡"
      subtitle="选择你正在做的关卡，导师会自动读取真实页面回显 + 关卡源码，再按「提示优先」的方式讲解。"
      onClose={onClose}
    >
      {error && <div className="alert error">{error}</div>}
      {!catalog && !error && <p className="muted small">加载关卡目录中…</p>}
      {catalog && (
        <>
          {isDvwa ? (
            <div className="lab-picker">
              <label className="field-label">DVWA 模块</label>
              <select
                className="select"
                value={moduleKey}
                onChange={(event) => setModuleKey(event.target.value)}
              >
                {catalog.dvwa.modules.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}（{item.key}）
                  </option>
                ))}
              </select>
              <label className="field-label">难度</label>
              <div className="deploy-filter-chips">
                {catalog.dvwa.levels.map((item) => (
                  <button
                    key={item}
                    className={`deploy-filter ${level === item ? "active" : ""}`}
                    onClick={() => setLevel(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="lab-picker">
              <label className="field-label">SQLi-Labs 关卡</label>
              <select
                className="select"
                value={lesson}
                onChange={(event) => setLesson(event.target.value)}
              >
                {catalog.sqli_labs.lessons.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="form-hint">将附带上下文：{title}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" onClick={() => onPick(itemKey, title)}>
              读取并提问
            </button>
          </div>
        </>
      )}
    </Overlay>
  );
}
