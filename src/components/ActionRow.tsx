import { ChevronDown, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface Props {
  onTakeSnapshot: () => void;
  onAnalyze: (preset: string) => void;
  isTakingSnapshot: boolean;
  canAnalyze: boolean;
  lastSnapshotAge: string | null; // e.g. "2 min ago"
}

export default function ActionRow({
  onTakeSnapshot,
  onAnalyze,
  isTakingSnapshot,
  canAnalyze,
  lastSnapshotAge,
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 20px 16px" }}>
      {/* Primary: Take snapshot */}
      <button
        onClick={onTakeSnapshot}
        disabled={isTakingSnapshot}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: isTakingSnapshot ? "var(--color-accent-muted)" : "var(--color-accent)",
          color: "var(--color-accent-on)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "7px 14px",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          cursor: isTakingSnapshot ? "not-allowed" : "pointer",
        }}
      >
        {isTakingSnapshot && (
          <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
        )}
        {isTakingSnapshot ? "Probing…" : "Take snapshot"}
      </button>

      {/* Analyze split button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={!canAnalyze}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "transparent",
              color: canAnalyze ? "var(--color-text-primary)" : "var(--color-text-disabled)",
              border: `1px solid ${canAnalyze ? "var(--color-border-strong)" : "var(--color-border-subtle)"}`,
              borderRadius: "var(--radius-md)",
              padding: "7px 12px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              cursor: canAnalyze ? "pointer" : "not-allowed",
            }}
          >
            Analyze
            <ChevronDown size={14} style={{ opacity: 0.7 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => onAnalyze("disk-audit")}>
            Disk audit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAnalyze("security-audit")}>
            Security audit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Last snapshot timestamp */}
      {lastSnapshotAge && (
        <span
          style={{
            marginLeft: "4px",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          last snapshot {lastSnapshotAge}
        </span>
      )}

      {/* Inline spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
