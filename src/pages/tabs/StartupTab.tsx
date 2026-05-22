import { useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, CircleMinus, Shield } from "lucide-react";
import type { Finding } from "../../types/finding";
import type { PersistenceEntry, Snapshot } from "../../types/snapshot";
import { classifyPersistence } from "../../lib/persistence";

// ── Types ─────────────────────────────────────────────────────────────────────

type EntryStatus = "flagged" | "known" | "disabled" | "normal";
type SectionKey = "unknown" | "known" | "system";

interface StartupTabProps {
  snapshot: Snapshot | null;
  findings: Finding[];
  onTogglePersistence: (entry: PersistenceEntry, action: "disable" | "enable") => Promise<void>;
}

interface SectionEntry {
  entry: PersistenceEntry;
  status: EntryStatus;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function useKindLabel() {
  const { t } = useTranslation("tabs");
  return (kind: PersistenceEntry["kind"]): string => {
    switch (kind) {
      case "user_agent":   return t("startup_tab.kind_user_agent");
      case "user_daemon":  return t("startup_tab.kind_user_daemon");
      case "system_daemon": return t("startup_tab.kind_system_daemon");
      case "system_agent": return t("startup_tab.kind_system_agent");
      case "login_item":   return t("startup_tab.kind_login_item");
    }
  };
}

// Bucket assignment ignores entry.disabled — disabled is a sort key, not a bucket.
// System daemons/agents always go to "system"; all others split on publisher recognition.
function sectionFor(entry: PersistenceEntry, flaggedLabels: Set<string>): SectionKey {
  if (entry.kind === "system_daemon" || entry.kind === "system_agent") return "system";
  // Proxy with disabled=false so classifyPersistence skips the disabled early-return.
  const status = classifyPersistence({ ...entry, disabled: false }, flaggedLabels);
  return status === "known" ? "known" : "unknown";
}

// Badge display: flagged takes precedence over disabled.
// An entry that is both flagged and disabled shows FLAGGED — it still needs attention.
function badgeStatusFor(entry: PersistenceEntry, flaggedLabels: Set<string>): EntryStatus {
  if (flaggedLabels.has(entry.label)) return "flagged";
  if (entry.disabled) return "disabled";
  return classifyPersistence(entry, flaggedLabels) as EntryStatus;
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
  const { t } = useTranslation("tabs");
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onChange}
      disabled={pending}
      title={on ? t("startup_tab.toggle_disable") : t("startup_tab.toggle_enable")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "24px",
        height: "14px",
        borderRadius: "7px",
        background: on ? "rgba(120, 120, 140, 0.85)" : "var(--color-bg-elev-3)",
        border: on ? "none" : "1px solid var(--color-border-subtle)",
        position: "relative",
        cursor: pending ? "wait" : "pointer",
        transition: "background 0.15s ease, box-shadow 0.12s ease",
        flexShrink: 0,
        opacity: pending ? 0.6 : 1,
        padding: 0,
        boxShadow: hovered && !pending ? "0 0 0 2px rgba(255,255,255,0.10)" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: on ? "calc(100% - 12px)" : "2px",
          width: "10px",
          height: "10px",
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
  const { t } = useTranslation("common");
  const labels: Record<EntryStatus, string> = {
    flagged: t("status.flagged"),
    known: t("status.known"),
    disabled: t("status.disabled"),
    normal: t("status.normal"),
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
  const { t } = useTranslation("tabs");
  const kindLabel = useKindLabel();
  // Dim by disabled state directly — a flagged+disabled row is dimmed but shows FLAGGED badge.
  const isDimmed = entry.disabled;

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <StatusIcon status={status} />
      </div>

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
          {entry.path || t("startup_tab.registered_via_system")}
        </div>
      </div>

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

      <div>
        <StatusBadge status={status} />
      </div>

      {/* login_item entries can't be toggled via launchctl */}
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

// ── Persistence section ───────────────────────────────────────────────────────

function PersistenceSection({
  labelKey,
  entries,
  pendingLabels,
  onToggle,
  collapsible = false,
}: {
  labelKey: string;
  entries: SectionEntry[];
  pendingLabels: Set<string>;
  onToggle: (entry: PersistenceEntry) => void;
  collapsible?: boolean;
}) {
  const { t } = useTranslation("tabs");
  const [expanded, setExpanded] = useState(!collapsible);
  const label = t(labelKey);

  const headerText = (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {label} · {entries.length}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {collapsible ? (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontSize: "9px",
              color: "var(--color-text-muted)",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            {expanded ? "▾" : "▸"}
          </span>
          {headerText}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center" }}>{headerText}</div>
      )}

      {expanded && (
        <div
          style={{
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}
        >
          {entries.map(({ entry, status }) => (
            <PersistenceRow
              key={entry.label + entry.path}
              entry={entry}
              status={status}
              pending={pendingLabels.has(entry.label)}
              onToggle={() => onToggle(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Column headers ────────────────────────────────────────────────────────────

function ColumnHeaders() {
  const { t } = useTranslation("tabs");
  return (
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
      <div>{t("startup_tab.col_label_path")}</div>
      <div style={{ textAlign: "center" }}>{t("startup_tab.col_kind")}</div>
      <div>{t("startup_tab.col_status")}</div>
      <div style={{ textAlign: "right" }}>{t("startup_tab.col_enabled")}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StartupTab({ snapshot, findings, onTogglePersistence }: StartupTabProps) {
  const [pendingLabels, setPendingLabels] = useState<Set<string>>(new Set());

  // snapshotKey changes only when a genuinely new snapshot is loaded.
  // Toggles within a snapshot update entry.disabled but leave created_at unchanged.
  const snapshotKey = snapshot?.created_at ?? null;

  // Synchronously capture entries the moment a new snapshot arrives.
  // Reading frozenEntriesRef.current inside memos below is safe because every
  // memo that uses it also lists snapshotKey as a dependency.
  const prevKeyRef = useRef<string | null>(null);
  const frozenEntriesRef = useRef<PersistenceEntry[]>([]);
  if (snapshotKey !== prevKeyRef.current) {
    prevKeyRef.current = snapshotKey;
    frozenEntriesRef.current = snapshot?.persistence?.entries ?? [];
  }

  // Live entries — updated when the user toggles within the current snapshot.
  const liveEntries = snapshot?.persistence?.entries ?? [];

  // Fast lookup for live entry state (disabled, etc.) keyed by label+path.
  const liveEntryMap = useMemo(() => {
    const m = new Map<string, PersistenceEntry>();
    for (const e of liveEntries) m.set(e.label + e.path, e);
    return m;
  }, [liveEntries]);

  const networkFindings = useMemo(
    () => findings.filter((f) => ["network", "security", "process"].includes(f.category)),
    [findings]
  );

  // Cross-reference findings against frozen entries — stable across toggles.
  const flaggedLabels = useMemo(() => {
    const set = new Set<string>();
    const relevant = findings.filter((f) =>
      ["security", "persistence", "network", "process"].includes(f.category)
    );
    for (const entry of frozenEntriesRef.current) {
      for (const f of relevant) {
        if (f.title.includes(entry.label) || f.description.includes(entry.label)) {
          set.add(entry.label);
          break;
        }
      }
    }
    return set;
  }, [snapshotKey, findings]); // snapshotKey (not liveEntries) keeps this stable across toggles

  // Frozen ordered sections — bucket + sort established once per snapshot.
  // Disabled is a sort key (bottom of bucket), not a separate bucket.
  // Sort within each bucket: flagged+enabled → enabled → disabled; stable by label.
  // Disabled always sorts to the bottom even when also flagged (dealt-with signal).
  const frozenOrderedSections = useMemo((): Record<SectionKey, string[]> => {
    type Item = { key: string; flagged: boolean; disabled: boolean; label: string };
    const raw: Record<SectionKey, Item[]> = { unknown: [], known: [], system: [] };

    for (const entry of frozenEntriesRef.current) {
      const key = entry.label + entry.path;
      raw[sectionFor(entry, flaggedLabels)].push({
        key,
        flagged: flaggedLabels.has(entry.label),
        disabled: entry.disabled,
        label: entry.label,
      });
    }

    const sortItems = (items: Item[]): string[] =>
      items
        .sort((a, b) => {
          const pa = a.disabled ? 2 : a.flagged ? 0 : 1;
          const pb = b.disabled ? 2 : b.flagged ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return a.label.localeCompare(b.label);
        })
        .map((x) => x.key);

    return {
      unknown: sortItems(raw.unknown),
      known: sortItems(raw.known),
      system: sortItems(raw.system),
    };
  }, [snapshotKey, flaggedLabels]); // stable within snapshot, never depends on liveEntries

  const sections = useMemo(() => {
    const buckets: Record<SectionKey, SectionEntry[]> = { unknown: [], known: [], system: [] };
    for (const [sec, orderedKeys] of Object.entries(frozenOrderedSections) as [SectionKey, string[]][]) {
      for (const key of orderedKeys) {
        const liveEntry = liveEntryMap.get(key);
        if (!liveEntry) continue;
        buckets[sec].push({ entry: liveEntry, status: badgeStatusFor(liveEntry, flaggedLabels) });
      }
    }
    return buckets;
  }, [frozenOrderedSections, liveEntryMap, flaggedLabels]);

  const hasAnyEntries = frozenEntriesRef.current.length > 0;

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

  const { t } = useTranslation("tabs");

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
          {t("startup_tab.empty_title")}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {t("startup_tab.empty_hint")}
        </span>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Subtitle */}
      <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
        {t("startup_tab.description")}
      </p>

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
            {t("startup_tab.network_header", { count: networkFindings.length })}
          </div>
          {networkFindings.map((f) => (
            <NetworkFindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      {/* Section 2 — Persistence inventory (grouped) */}
      {hasAnyEntries ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <ColumnHeaders />

          {sections.unknown.length > 0 && (
            <PersistenceSection
              labelKey="startup_tab.section_unknown"
              entries={sections.unknown}
              pendingLabels={pendingLabels}
              onToggle={handleToggle}
            />
          )}

          {sections.known.length > 0 && (
            <PersistenceSection
              labelKey="startup_tab.section_known"
              entries={sections.known}
              pendingLabels={pendingLabels}
              onToggle={handleToggle}
            />
          )}

          {sections.system.length > 0 && (
            <PersistenceSection
              labelKey="startup_tab.section_system"
              entries={sections.system}
              pendingLabels={pendingLabels}
              onToggle={handleToggle}
              collapsible
            />
          )}
        </div>
      ) : (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-muted)",
          }}
        >
          {t("startup_tab.no_entries")}
        </div>
      )}

      {/* Footer hint */}
      {hasAnyEntries && (
        <div
          style={{
            textAlign: "center",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            letterSpacing: "0.04em",
          }}
        >
          {t("startup_tab.footer_hint")}
        </div>
      )}
    </div>
  );
}
