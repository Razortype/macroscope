import { Link } from "react-router-dom";
import { Settings, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import MacroscopeLogo from "./MacroscopeLogo";
import type { Snapshot } from "../types/snapshot";

interface TopBarProps {
  activeSnapshot?: Snapshot | null;
  activeSnapshotId?: number | null;
  findingCount?: number | null;
  isAnalyzing?: boolean;
  snapshotBlocked?: boolean;
  onTakeSnapshot?: () => void;
  onReAnalyze?: () => void;
}

function snapshotAge(ts: string): string {
  try {
    // i18n-deferred: formatDistanceToNow — replace with Intl.RelativeTimeFormat keyed off locale
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

export default function TopBar({
  activeSnapshot = null,
  activeSnapshotId = null,
  findingCount = null,
  isAnalyzing = false,
  snapshotBlocked = false,
  onTakeSnapshot,
  onReAnalyze,
}: TopBarProps) {
  const { t } = useTranslation("tabs");

  return (
    <header
      style={{
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "var(--color-bg-elev-1)",
        borderBottom: "1px solid var(--color-border-divider)",
        flexShrink: 0,
        gap: "16px",
      }}
    >
      {/* Left: wordmark + snapshot metadata */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <MacroscopeLogo size={22} />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              fontSize: "var(--text-base)",
              color: "var(--color-text-primary)",
              letterSpacing: "0.01em",
            }}
          >
            {t("topbar.app_name")}
          </span>
        </div>
        {activeSnapshot && activeSnapshotId != null && !isAnalyzing && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("topbar.snapshot_label", { id: activeSnapshotId })}
            {" · "}
            {snapshotAge(activeSnapshot.created_at)}
            {findingCount != null && ` · ${t("topbar.snapshot_findings", { count: findingCount })}`}
          </span>
        )}
      </div>

      {/* Right: Re-analyze + Take snapshot + gear */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        {onReAnalyze && activeSnapshotId != null && !isAnalyzing && (
          <button
            onClick={onReAnalyze}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "12px",
              color: "var(--color-text-secondary)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--color-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--color-text-secondary)";
            }}
          >
            <RefreshCw size={12} />
            {t("topbar.re_analyze")}
          </button>
        )}
        {onTakeSnapshot && (
          <button
            onClick={onTakeSnapshot}
            disabled={isAnalyzing || snapshotBlocked}
            title={snapshotBlocked ? t("topbar.blocked_title") : undefined}
            style={{
              background: (isAnalyzing || snapshotBlocked) ? "var(--color-text-muted)" : "var(--color-accent)",
              color: (isAnalyzing || snapshotBlocked) ? "var(--color-text-disabled)" : "#1a1a26",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: (isAnalyzing || snapshotBlocked) ? "not-allowed" : "pointer",
            }}
          >
            {isAnalyzing ? t("topbar.analyzing") : t("topbar.take_snapshot")}
          </button>
        )}
        <Link
          to="/settings"
          style={{ color: "var(--color-text-muted)", display: "flex", lineHeight: 0 }}
          title={t("topbar.settings_link_title")}
        >
          <Settings size={18} strokeWidth={1.5} />
        </Link>
      </div>
    </header>
  );
}
