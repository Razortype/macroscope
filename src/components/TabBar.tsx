import { useState, type ReactNode } from "react";
import { LayoutGrid, CircleAlert, Grid3x3, FileText, Activity } from "lucide-react";

export type TabId = "overview" | "findings" | "apps" | "files" | "startup";

interface TabBarProps {
  active: TabId;
  onChange: (id: TabId) => void;
  counts?: { findings?: number; apps?: number; files?: number; startup?: number };
}

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "overview", icon: <LayoutGrid size={13} /> },
  { id: "findings", label: "findings", icon: <CircleAlert size={13} /> },
  { id: "apps", label: "apps", icon: <Grid3x3 size={13} /> },
  { id: "files", label: "files", icon: <FileText size={13} /> },
  { id: "startup", label: "startup & background", icon: <Activity size={13} /> },
];

export default function TabBar({ active, onChange, counts = {} }: TabBarProps) {
  const [hoveredId, setHoveredId] = useState<TabId | null>(null);

  return (
    <div
      style={{
        background: "var(--color-bg-elev-1)",
        borderBottom: "1px solid var(--color-border-divider)",
        display: "flex",
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const isHovered = hoveredId === tab.id;
        const count = counts[tab.id as keyof typeof counts];
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            onMouseEnter={() => setHoveredId(tab.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "10px 18px",
              background: !isActive && isHovered ? "rgba(255,255,255,0.04)" : "transparent",
              border: "none",
              borderBottom: isActive
                ? "2px solid var(--color-accent)"
                : "2px solid transparent",
              color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              fontWeight: isActive ? 500 : 400,
              lineHeight: 1,
              transition: "color 120ms, background 120ms",
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {count !== undefined && (
              <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
