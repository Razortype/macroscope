import { useState, useMemo, useCallback } from "react";
import { AlertTriangle, Check, CircleMinus, Shield } from "lucide-react";
import type { Finding } from "../../types/finding";
import type { PersistenceEntry, Snapshot } from "../../types/snapshot";
import { classifyPersistence } from "../../lib/persistence";

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterKey = "all" | "flagged" | "known" | "disabled";
type EntryStatus = "flagged" | "known" | "disabled" | "normal";

interface StartupTabProps {
  snapshot: Snapshot | null;
  findings: Finding[];
  onTogglePersistence: (entry: PersistenceEntry, action: "disable" | "enable") => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindLabel(kind: PersistenceEntry["kind"]): string {
  switch (kind) {
    case "user_agent": return "user agent";
    case "user_daemon": return "user daemon";
    case "system_daemon": return "root daemon";
    case "system_agent": return "root agent";
    case "login_item": return "login item";
  }
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  on,
  pending,
  onChange,
}: {
  on: boolean;
  pending: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      disabled={pending}
      title={on ? "click to disable" : "click to enable"}
      style={{
        width: "32px",
        height: "18px",
        borderRadius: "9px",
        background: on ? "var(--color-severity-low-fg)" : "var(--color-bg-elev-3)",
        border: on ? "none" : "1px solid var(--color-border-subtle)",
        position: "relative",
        cursor: pending ? "wait" : "pointer",
        transition: "background 0.15s ease",
        flexShrink: 0,
        opacity: pending ? 0.6 : 1,
        padding: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: on ? "calc(100% - 16px)" : "2px",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          background: "white",
          transition: "left 0.15s ease",
          pointerEvents: "none",
        }}
      />
    </button>
  );
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: EntryStatus }) {
  switch (status) {
    case "flagged":
      return <AlertTriangle size={14} color="var(--color-severity-medium-fg)" />;
    case "known":
      return <Check size={14} color="var(--color-severity-low-fg)" />;
    case "disabled":
      return <CircleMinus size={14} color="var(--color-text-muted)" />;
    case "normal":
      return <Shield size={14} color="var(--color-text-muted)" />;
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EntryStatus }) {
  const styles: Record<EntryStatus, React.CSSProperties> = {
    flagged: {
      background: "var(--color-severity-medium-bg)",
      color: "var(--color-severity-medium-fg)",
    },
    known: {
      background: "var(--color-severity-low-bg)",
      color: "var(--color-severity-low-fg)",
    },
    disabled: {
      background: "var(--color-bg-elev-3)",
      color: "var(--color-text-secondary)",
    },
    normal: {
      background: "var(--color-bg-elev-3)",
      color: "var(--color-text-muted)",
    },
  };
  const labels: Record<EntryStatus, string> = {
    flagged: "FLAGGED",
    known: "KNOWN",
    disabled: "DISABLED",
    normal: "NORMAL",
  };
  return (
    <span
      style={{
        ...styles[status],
        fontSize: "9px",
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        padding: "2px 6px",
        borderRadius: "var(--radius-sm)",
        letterSpacing: "0.06em",
      }}
    >
      {labels[status]}
    </span>
  );
}

// ── Network findings section ──────────────────────────────────────────────────

function NetworkFindingCard({ finding: f }: { finding: Finding }) {
  return (
    <div
      style={{
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            background: `var(--color-severity-${f.severity}-bg)`,
            color: `var(--color-severity-${f.severity}-fg)`,
            fontSize: "9px",
            fontWeight: 600,
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
        >
          {f.severity}
        </span>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {f.title}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          lineHeight: 1.55,
        }}
      >
        {f.description}
      </p>
      {f.rationale && (
        <div
          style={{
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "6px 10px",
            fontSize: "11px",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {f.rationale}
        </div>
      )}
    </div>
  );
}

// ── Persistence row ───────────────────────────────────────────────────────────

const GRID = "20px minmax(0, 1fr) 80px 90px 50px";

function PersistenceRow({
  entry,
  status,
  pending,
  onToggle,
}: {
  entry: PersistenceEntry;
  status: EntryStatus;
  pending: boolean;
  onToggle: () => void;
}) {
  const isDimmed = status === "disabled";

  const rowBg =
    status === "flagged"
      ? "var(--color-severity-medium-bg)"
      : "transparent";

  const rowBorder =
    status === "flagged"
      ? "1px solid rgba(245,166,35,0.25)"
      : "1px solid transparent";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: "8px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-divider)",
        alignItems: "center",
        background: rowBg,
        border: rowBorder,
        borderRadius: "var(--radius-md)",
        opacity: isDimmed ? 0.55 : 1,
      }}
    >
      {/* Status icon */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <StatusIcon status={status} />
      </div>

      {/* Label + path */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: isDimmed ? "line-through" : "none",
          }}
        >
          {entry.label}
        </div>
        <div
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: isDimmed ? "line-through" : "none",
          }}
        >
          {entry.path || "registered via System Settings"}
        </div>
      </div>

      {/* Kind */}
      <div
        style={{
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-muted)",
          textAlign: "center",
        }}
      >
        {kindLabel(entry.kind)}
      </div>

      {/* Status badge */}
      <div>
        <StatusBadge status={status} />
      </div>

      {/* Toggle — login_items can't be toggled via launchctl */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {entry.kind !== "login_item" && (
          <ToggleSwitch
            on={!entry.disabled}
            pending={pending}
            onChange={onToggle}
          />
        )}
      </div>
    </div>
  );
}

// ── Filter chip ───────────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--color-accent)" : "var(--color-bg-elev-2)",
        color: active ? "var(--color-accent-on)" : "var(--color-text-secondary)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        padding: "3px 9px",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label} {count}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StartupTab({ snapshot, findings, onTogglePersistence }: StartupTabProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pendingLabels, setPendingLabels] = useState<Set<string>>(new Set());

  const persistenceEntries = snapshot?.persistence?.entries ?? [];

  const networkFindings = useMemo(
    () => findings.filter((f) => ["network", "security", "process"].includes(f.category)),
    [findings]
  );

  const flaggedLabels = useMemo(() => {
    const set = new Set<string>();
    const relevantFindings = findings.filter((f) =>
      ["security", "persistence", "network", "process"].includes(f.category)
    );
    for (const entry of persistenceEntries) {
      for (const f of relevantFindings) {
        if (f.title.includes(entry.label) || f.description.includes(entry.label)) {
          set.add(entry.label);
          break;
        }
      }
    }
    return set;
  }, [findings, persistenceEntries]);

  const classified = useMemo(
    () =>
      persistenceEntries.map((entry) => ({
        entry,
        status: classifyPersistence(entry, flaggedLabels) as EntryStatus,
      })),
    [persistenceEntries, flaggedLabels]
  );

  const counts = useMemo(
    () => ({
      all: classified.length,
      flagged: classified.filter((c) => c.status === "flagged").length,
      known: classified.filter((c) => c.status === "known").length,
      disabled: classified.filter((c) => c.status === "disabled").length,
    }),
    [classified]
  );

  const filtered = useMemo(
    () => (filter === "all" ? classified : classified.filter((c) => c.status === filter)),
    [classified, filter]
  );

  const sorted = useMemo(() => {
    const order: Record<EntryStatus, number> = { flagged: 0, known: 1, normal: 2, disabled: 3 };
    return [...filtered].sort((a, b) => order[a.status] - order[b.status]);
  }, [filtered]);

  const handleToggle = useCallback(
    async (entry: PersistenceEntry) => {
      const action = entry.disabled ? "enable" : "disable";
      setPendingLabels((prev) => new Set(prev).add(entry.label));
      try {
        await onTogglePersistence(entry, action);
      } finally {
        setPendingLabels((prev) => {
          const next = new Set(prev);
          next.delete(entry.label);
          return next;
        });
      }
    },
    [onTogglePersistence]
  );

  if (!snapshot) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          gap: "8px",
        }}
      >
        <Shield size={28} color="var(--color-text-muted)" />
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          No persistence concerns detected
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          Run a snapshot to scan launch agents and daemons
        </span>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Section 1 — Network exposure findings */}
      {networkFindings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            network & security · {networkFindings.length} finding{networkFindings.length !== 1 ? "s" : ""}
          </div>
          {networkFindings.map((f) => (
            <NetworkFindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      {/* Section 2 — Persistence inventory */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
              marginRight: "4px",
            }}
          >
            persistence
          </div>
          <FilterChip label="all" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterChip label="flagged" count={counts.flagged} active={filter === "flagged"} onClick={() => setFilter("flagged")} />
          <FilterChip label="known" count={counts.known} active={filter === "known"} onClick={() => setFilter("known")} />
          <FilterChip label="disabled" count={counts.disabled} active={filter === "disabled"} onClick={() => setFilter("disabled")} />
        </div>

        {/* Column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: "8px",
            padding: "0 12px",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          <div />
          <div>label · path</div>
          <div style={{ textAlign: "center" }}>kind</div>
          <div>status</div>
          <div style={{ textAlign: "right" }}>enabled</div>
        </div>

        {/* Rows */}
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              fontSize: "var(--text-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            No {filter === "all" ? "" : filter + " "}entries
          </div>
        ) : (
          <div
            style={{
              background: "var(--color-bg-elev-1)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            {sorted.map(({ entry, status }) => (
              <PersistenceRow
                key={entry.label + entry.path}
                entry={entry}
                status={status}
                pending={pendingLabels.has(entry.label)}
                onToggle={() => handleToggle(entry)}
              />
            ))}
          </div>
        )}

        {/* Footer hint */}
        <div
          style={{
            textAlign: "center",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            letterSpacing: "0.04em",
          }}
        >
          toggling a switch runs launchctl disable/enable · sudo prompt for root daemons
        </div>
      </div>
    </div>
  );
}
