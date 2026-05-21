import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Finding, Severity } from "../../types/finding";
import type { ClassifiedLeftover } from "../../types/snapshot";
import FindingCard from "../../components/FindingCard";

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
const SEVERITIES: Severity[] = ["high", "medium", "low", "info"];
type FilterSeverity = "all" | Severity;

function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => {
    const sv = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (sv !== 0) return sv;
    return (b.estimated_bytes_freed ?? 0) - (a.estimated_bytes_freed ?? 0);
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FindingsTabProps {
  findings: Finding[] | null;
  selectedIds: Set<string>;
  executedPaths: Set<string>;
  partialPaths: Set<string>;
  onToggleSelection: (id: string, checked: boolean) => void;
  onSelectAll: () => void;
  deleteableCount: number;
  classifiedLeftovers: ClassifiedLeftover[];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FindingsTab({
  findings,
  selectedIds,
  executedPaths,
  partialPaths,
  onToggleSelection,
  onSelectAll,
  deleteableCount,
  classifiedLeftovers,
}: FindingsTabProps) {
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>("all");

  // Build a path → status-type map for quick companion/ambiguous lookup
  const statusByPath = useMemo(() => {
    const m = new Map<string, "companion" | "ambiguous">();
    for (const cl of classifiedLeftovers) {
      if (cl.status.type === "companion" || cl.status.type === "ambiguous") {
        m.set(cl.path, cl.status.type);
      }
    }
    return m;
  }, [classifiedLeftovers]);

  const { t } = useTranslation("tabs");

  if (!findings) {
    return (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: "var(--color-text-muted)",
          fontSize: "var(--text-sm)",
        }}
      >
        {t("findings_tab.empty_no_snapshot")}
      </div>
    );
  }

  const sorted = sortFindings(findings);
  const filtered =
    filterSeverity === "all" ? sorted : sorted.filter((f) => f.severity === filterSeverity);

  const countBySeverity = (s: Severity) => findings.filter((f) => f.severity === s).length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Filter chip row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "14px 20px 12px",
          borderBottom: "1px solid var(--color-border-divider)",
        }}
      >
        {/* "all" chip */}
        <FilterChip
          label={t("findings_tab.filter_all", { count: findings.length })}
          isActive={filterSeverity === "all"}
          dot={null}
          onClick={() => setFilterSeverity("all")}
        />
        {SEVERITIES.map((s) => (
          <FilterChip
            key={s}
            label={t("findings_tab.filter_severity", { severity: s, count: countBySeverity(s) })}
            isActive={filterSeverity === s}
            dot={`var(--color-severity-${s}-fg)`}
            onClick={() => setFilterSeverity(s)}
          />
        ))}

        {/* Spacer + select-all toggle */}
        <div style={{ flex: 1 }} />
        {deleteableCount > 0 && (
          <button
            onClick={onSelectAll}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "11px",
              color: "var(--color-text-muted)",
            }}
          >
            {selectedIds.size === deleteableCount
              ? `⊟ ${t("common:actions.deselect_all")}`
              : `⊞ ${t("common:actions.select_all")}`}
          </button>
        )}
      </div>

      {/* Findings list */}
      {filtered.length === 0 ? (
        <div
          style={{
            padding: "24px 20px",
            color: "var(--color-text-muted)",
            fontSize: "var(--text-sm)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filterSeverity === "all"
            ? t("findings_tab.empty_clean")
            : t("findings_tab.empty_severity", { severity: filterSeverity })}
        </div>
      ) : (
        filtered.map((f) => {
          const paths = f.paths_to_remove ?? [];
          const isExecuted = paths.length > 0 && paths.every((p) => executedPaths.has(p));
          const isPartial = !isExecuted && paths.some((p) => partialPaths.has(p));
          const identityHint = paths.length > 0
            ? (paths.some((p) => statusByPath.get(p) === "companion") ? "companion"
               : paths.some((p) => statusByPath.get(p) === "ambiguous") ? "ambiguous"
               : undefined)
            : undefined;
          return (
            <FindingCard
              key={f.id}
              finding={f}
              selected={selectedIds.has(f.id)}
              executed={isExecuted}
              partial={isPartial}
              identityHint={identityHint}
              onSelectChange={(checked) => onToggleSelection(f.id, checked)}
            />
          );
        })
      )}
    </div>
  );
}

// ── FilterChip ─────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  isActive,
  dot,
  onClick,
}: {
  label: string;
  isActive: boolean;
  dot: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "5px",
        padding: "4px 10px",
        background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "12px",
        color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontSize: "11px",
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: dot,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
      )}
      {label}
    </button>
  );
}
