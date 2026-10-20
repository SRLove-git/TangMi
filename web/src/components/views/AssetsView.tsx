import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Network, Search } from "lucide-react";
import { api } from "../../api";
import type { AssetItem, Project } from "../../types";
import { EmptyState, PageHeader, ScopeSwitch, formatDateTime } from "./shared";

interface Props {
  activeProject: Project | null;
}

const KIND_LABELS: Record<string, string> = {
  host: "主机",
  port: "端口",
  service: "服务",
  subdomain: "子域",
  tech: "技术栈",
  endpoint: "接口",
};

const KIND_ORDER = ["host", "port", "service", "subdomain", "endpoint", "tech"];

export default function AssetsView({ activeProject }: Props) {
  const [scope, setScope] = useState<"all" | "project">("all");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const projectId = scope === "project" ? activeProject?.id : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.assets(projectId);
      setAssets(data.assets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kind && asset.kind !== kind) return false;
      if (!keyword) return true;
      return [asset.url, asset.host, asset.service, ...(asset.tech ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [assets, kind, search]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const asset of assets) {
      result[asset.kind] = (result[asset.kind] ?? 0) + 1;
    }
    return result;
  }, [assets]);

  return (
    <section className="platform-view">
      <PageHeader
        eyebrow="Attack Surface"
        title="资产台账"
        subtitle="扫描过程中自动沉淀的主机、端口、服务、子域、技术栈与接口。"
        actions={
          <ScopeSwitch
            value={scope}
            onChange={setScope}
            projectId={activeProject?.id ?? null}
            projectName={activeProject?.name}
          />
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="filter-row">
        <button className={`chip ${kind === "" ? "on" : ""}`} onClick={() => setKind("")}>
          全部 {assets.length}
        </button>
        {KIND_ORDER.map((item) => (
          <button
            key={item}
            className={`chip ${kind === item ? "on" : ""}`}
            onClick={() => setKind(item)}
          >
            {KIND_LABELS[item]} {counts[item] ?? 0}
          </button>
        ))}
        <div className="filter-search">
          <Search size={14} />
          <input
            className="text-input"
            placeholder="搜索资产 / 端口 / 技术栈…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="muted">加载中…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Network size={24} />}
          title="还没有资产数据"
          description="执行一次带「端口 / 子域 / 接口」模块的扫描后，资产会自动进入台账。"
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>资产</th>
                  <th>服务 / 技术</th>
                  <th>命中</th>
                  <th>最近发现</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => (
                  <tr key={`${asset.kind}-${asset.url}-${asset.port}`}>
                    <td>
                      <span className={`kind-badge kind-${asset.kind}`}>
                        {KIND_LABELS[asset.kind] ?? asset.kind}
                      </span>
                    </td>
                    <td>
                      <div className="cell-primary mono">
                        {asset.kind === "host" || asset.kind === "tech" ? (
                          asset.url
                        ) : (
                          <>
                            <Globe size={12} /> {asset.url}
                          </>
                        )}
                      </div>
                      {asset.detail && (
                        <div className="cell-sub ellipsis">{asset.detail}</div>
                      )}
                    </td>
                    <td className="small">
                      {[asset.service, ...(asset.tech ?? [])].filter(Boolean).join(" · ") || "-"}
                    </td>
                    <td className="small muted">{asset.hits}</td>
                    <td className="small mono muted">{formatDateTime(asset.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
