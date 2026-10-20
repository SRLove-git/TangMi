import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export default function Overlay({ title, subtitle, onClose, children, wide }: Props) {
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className={`overlay-panel ${wide ? "wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overlay-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          <button className="btn ghost tiny" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}
