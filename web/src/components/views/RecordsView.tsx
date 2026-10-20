import { useState } from "react";
import type { Project } from "../../types";
import AssetsView from "./AssetsView";
import DashboardView from "./DashboardView";
import ScansView from "./ScansView";
import VulnerabilitiesView from "./VulnerabilitiesView";

type RecordTab = "dashboard" | "assets" | "vulnerabilities" | "scans";

const TABS: Array<{ id: RecordTab; label: string; hint: string }> = [
  { id: "dashboard", label: "安全态势", hint: "风险分布与趋势" },
  { id: "assets", label: "资产台账", hint: "主机 / 端口 / 接口" },
  { id: "vulnerabilities", label: "漏洞管理", hint: "生命周期与备注" },
  { id: "scans", label: "扫描记录", hint: "历史任务与结果" },
];

interface Props {
  activeProject: Project | null;
  onOpenRun: (runId: string, lab: string) => void;
  onGoChat: () => void;
}

/** 「记录」页：把原态势 / 资产 / 漏洞 / 扫描四个平台页合并为 Tab。 */
export default function RecordsView({ activeProject, onOpenRun, onGoChat }: Props) {
  const [tab, setTab] = useState<RecordTab>("dashboard");
  return (
    <div className="records-view">
      <div className="records-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`records-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
            title={item.hint}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
      {tab === "dashboard" && (
        <DashboardView
          activeProject={activeProject}
          onOpenRun={onOpenRun}
          onGoChat={onGoChat}
        />
      )}
      {tab === "assets" && <AssetsView activeProject={activeProject} />}
      {tab === "vulnerabilities" && <VulnerabilitiesView activeProject={activeProject} />}
      {tab === "scans" && (
        <ScansView
          activeProject={activeProject}
          onOpenRun={onOpenRun}
          onGoChat={onGoChat}
        />
      )}
    </div>
  );
}
