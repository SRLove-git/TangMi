import { useEffect, useState } from "react";
import { api } from "../../api";
import type { ReportFile } from "../../types";
import ReportView from "../ReportView";
import Overlay from "./Overlay";

interface Props {
  onClose: () => void;
}

export default function ReportModal({ onClose }: Props) {
  const [reports, setReports] = useState<ReportFile[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const data = await api.reports();
      setReports(data.reports);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Overlay
      title="测试报告"
      subtitle="在线预览 Markdown / HTML / JSON 报告，或下载归档"
      onClose={onClose}
      wide
    >
      {loading ? <p className="muted">加载中…</p> : <ReportView reports={reports} onRefresh={refresh} compact />}
    </Overlay>
  );
}
