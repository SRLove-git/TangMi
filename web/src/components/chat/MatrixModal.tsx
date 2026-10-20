import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Finding } from "../../types";
import { snapshotFromLatestResult } from "../../utils";
import MatrixView from "../MatrixView";
import Overlay from "./Overlay";

interface Props {
  runId?: string;
  onClose: () => void;
  onSelectFinding: (finding: Finding) => void;
}

export default function MatrixModal({ runId, onClose, onSelectFinding }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [title, setTitle] = useState("结果矩阵");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (runId) {
          const snapshot = await api.run(runId);
          if (cancelled) return;
          setFindings(snapshot.findings);
          setTitle(
            `${snapshot.config?.lab ?? "任务"} · ${snapshot.config?.target ?? ""}`,
          );
        } else {
          const latest = await api.latestResult();
          if (cancelled) return;
          setFindings(snapshotFromLatestResult(latest).findings);
          setTitle("最新验证报告");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <Overlay
      title={`结果矩阵 · ${title}`}
      subtitle="点击任意格子查看 payload、证据与备注"
      onClose={onClose}
      wide
    >
      {loading && <p className="muted">加载中…</p>}
      {error && <div className="alert error">{error}</div>}
      {!loading && !error && <MatrixView findings={findings} onSelectFinding={onSelectFinding} />}
    </Overlay>
  );
}
