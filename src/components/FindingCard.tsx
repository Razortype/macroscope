import type { Finding, Severity } from "../types/finding";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function severityColors(s: Severity) {
  return {
    fg: `var(--color-severity-${s}-fg)`,
    bg: `var(--color-severity-${s}-bg)`,
  };
}

interface Props {
  finding: Finding;
  selected: boolean;
  onSelectChange: (selected: boolean) => void;
  executed?: boolean;
}

export default function FindingCard({ finding: f, selected, onSelectChange, executed = false }: Props) {
  const { fg, bg } = severityColors(f.severity);
  const isSelectable = f.suggested_action === "delete_paths" && !executed;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 20px",
        borderBottom: "1px solid var(--color-border-divider)",
        background: selected ? "var(--color-bg-elev-2)" : "transparent",
        transition: "background 100ms",
      }}
    >
      {/* Checkbox column — 20px wide, reserved even for non-selectable findings */}
      <div style={{ width: "20px", paddingTop: "2px", flexShrink: 0 }}>
        {isSelectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectChange(e.target.checked)}
            style={{
              width: "14px",
              height: "14px",
              accentColor: "var(--color-accent)",
              cursor: "pointer",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
        {/* Header: severity + category + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span
            style={{
              background: bg,
              color: fg,
              borderRadius: "var(--radius-xs)",
              padding: "1px 6px",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            {f.severity}
          </span>
          <span
            style={{
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              flexShrink: 0,
            }}
          >
            {f.category}
          </span>
          <span
            style={{
              fontWeight: 500,
              fontSize: "var(--text-sm)",
              color: executed ? "var(--color-text-disabled)" : "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textDecoration: executed ? "line-through" : "none",
            }}
          >
            {f.title}
          </span>
          {executed && (
            <span
              style={{
                color: "var(--color-status-ok)",
                fontSize: "var(--text-xs)",
                flexShrink: 0,
              }}
            >
              ✓ Trash
            </span>
          )}
          {!executed && f.suggested_action !== "delete_paths" && (
            <span
              style={{
                color: "var(--color-text-disabled)",
                fontSize: "var(--text-xs)",
                flexShrink: 0,
              }}
            >
              · {f.suggested_action}
            </span>
          )}
        </div>

        {/* Description */}
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--color-text-secondary)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {f.description}
        </p>

        {/* Paths to remove */}
        {f.paths_to_remove && f.paths_to_remove.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "2px" }}>
            {f.paths_to_remove.map((p) => (
              <span
                key={p}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-secondary)",
                }}
              >
                → {p}
              </span>
            ))}
            {f.estimated_bytes_freed != null && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                ↑ {formatBytes(f.estimated_bytes_freed)} freed
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
