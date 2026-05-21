import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Package, FolderX, FolderCheck, HelpCircle, Settings2 } from "lucide-react";
import type { AppsSnapshot, InstalledApp, ClassifiedLeftover } from "../../types/snapshot";
import RowActions from "../../components/RowActions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatLastOpened(days: number | null): string {
  // i18n-deferred: replace with Intl.RelativeTimeFormat keyed off locale
  if (days === null) return "unknown";
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function getAppStatus(app: InstalledApp): "active" | "stale" {
  if (app.last_opened_days_ago === null) return "active";
  return app.last_opened_days_ago > 180 ? "stale" : "active";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppsTabProps {
  apps: AppsSnapshot | null;
  executedPaths: Set<string>;
  partialPaths: Set<string>;
  onCleanLeftover: (paths: string[], name: string, bytes: number) => void;
}

type AppRow =
  | { kind: "installed"; app: InstalledApp; appStatus: "active" | "stale"; sortSize: number; sortAge: number; sortName: string }
  | { kind: "leftover"; leftover: ClassifiedLeftover; sortSize: number; sortAge: number; sortName: string };

type FilterKey = "all" | "orphaned" | "companion" | "ambiguous" | "active";
type SortKey = "size" | "last_opened" | "name";

// ── Filter chip ───────────────────────────────────────────────────────────────

function FilterChip({
  label, isActive, dot, onClick,
}: {
  label: string; isActive: boolean; dot: string | null; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px",
        background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
        border: "1px solid var(--color-border-subtle)", borderRadius: "12px",
        color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontSize: "11px", fontFamily: "var(--font-sans)", cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span style={{
          width: "6px", height: "6px", borderRadius: "50%", background: dot,
          flexShrink: 0, display: "inline-block",
        }} />
      )}
      {label}
    </button>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ label, semantic }: { label: string; semantic: "low" | "medium" | "info" | "high" }) {
  return (
    <span style={{
      background: `var(--color-severity-${semantic}-bg)`,
      color: `var(--color-severity-${semantic}-fg)`,
      fontSize: "9px", fontWeight: 600, padding: "2px 6px",
      borderRadius: "var(--radius-xs)", textTransform: "uppercase" as const,
      letterSpacing: "0.06em", fontFamily: "var(--font-mono)",
    }}>
      {label}
    </span>
  );
}

function SystemBadge() {
  const { t } = useTranslation("tabs");
  return (
    <span style={{
      background: "var(--color-bg-elev-3)", color: "var(--color-text-muted)",
      fontSize: "9px", fontWeight: 600, padding: "2px 6px",
      borderRadius: "var(--radius-xs)", textTransform: "uppercase" as const,
      letterSpacing: "0.06em", fontFamily: "var(--font-mono)",
    }}>
      {t("apps_tab.badge_system")}
    </span>
  );
}

function SelfBadge() {
  const { t } = useTranslation("tabs");
  return (
    <span style={{
      background: "var(--color-bg-elev-3)", color: "var(--color-text-disabled)",
      fontSize: "9px", fontWeight: 600, padding: "2px 6px",
      borderRadius: "var(--radius-xs)", textTransform: "uppercase" as const,
      letterSpacing: "0.06em", fontFamily: "var(--font-mono)",
    }}>
      {t("apps_tab.badge_self")}
    </span>
  );
}

// ── Row layout ────────────────────────────────────────────────────────────────

const GRID = "50px minmax(0, 1fr) 110px 100px 110px 28px 80px";
const ROW_STYLE: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID, padding: "10px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center",
};

function IconCell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 6, background: "var(--color-bg-elev-3)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {children}
    </div>
  );
}

function CleanButton({
  enabled, tooltip, onClick,
}: {
  enabled: boolean; tooltip: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={tooltip}
      style={{
        background: enabled ? "var(--color-severity-medium-bg)" : "var(--color-bg-elev-3)",
        color: enabled ? "var(--color-severity-medium-fg)" : "var(--color-text-muted)",
        border: "none", padding: "4px 8px", borderRadius: "4px",
        fontSize: "10px", cursor: enabled ? "pointer" : "not-allowed",
        fontFamily: "var(--font-sans)", opacity: enabled ? 1 : 0.55,
      }}
    >
      <CleanBtnLabel />
    </button>
  );
}

function CleanBtnLabel() {
  const { t } = useTranslation("tabs");
  return <>{t("apps_tab.clean_btn")}</>;
}

// ── Installed row ─────────────────────────────────────────────────────────────

function InstalledRow({ row }: { row: AppRow & { kind: "installed" } }) {
  const { t } = useTranslation("tabs");
  const { app, appStatus } = row;
  return (
    <div style={ROW_STYLE}>
      <IconCell><Package size={14} color="var(--color-text-muted)" /></IconCell>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "13px", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {app.name}
        </div>
        <div style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {app.path}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
        {formatLastOpened(app.last_opened_days_ago)}
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
        {formatBytes(app.size_bytes)}
      </div>
      <div>
        <StatusBadge label={t(appStatus === "stale" ? "apps_tab.badge_stale" : "apps_tab.badge_active")} semantic={appStatus === "stale" ? "info" : "low"} />
      </div>
      <div />
      <div />
    </div>
  );
}

// ── Leftover row (all status variants) ───────────────────────────────────────

function LeftoverRow({
  row, isExecuted, isPartial, onClean,
}: {
  row: AppRow & { kind: "leftover" }; isExecuted: boolean; isPartial: boolean; onClean: () => void;
}) {
  const { t } = useTranslation("tabs");
  const { leftover } = row;
  const status = leftover.status;
  const isDimmed = isExecuted || isPartial;

  // Icon
  const icon = (() => {
    if (isExecuted) return <Check size={14} color="var(--color-severity-low-fg)" />;
    if (status.type === "orphaned") return <FolderX size={14} color={isDimmed ? "var(--color-text-muted)" : "var(--color-severity-medium-fg)"} />;
    if (status.type === "companion") return <FolderCheck size={14} color="var(--color-severity-info-fg)" />;
    if (status.type === "ambiguous") return <HelpCircle size={14} color="var(--color-severity-medium-fg)" />;
    return <FolderX size={14} color="var(--color-text-muted)" />; // system_managed
  })();

  // Row tint
  const rowBg = status.type === "companion"
    ? "rgba(93,163,245,0.04)"
    : status.type === "orphaned"
    ? "rgba(245,166,35,0.025)"
    : "transparent";

  // Sub-line (shown below dir_name)
  const subLine = (() => {
    if (status.type === "companion") return t("apps_tab.subline_companion", { name: status.belongs_to_display_name });
    if (status.type === "ambiguous") return t("apps_tab.subline_ambiguous", { hint: status.pattern_hint });
    if (status.type === "system_managed") return t("apps_tab.subline_system");
    if (status.type === "self_managed") return t("apps_tab.subline_self");
    return t("apps_tab.subline_orphaned");
  })();

  // Badge
  const badge = (() => {
    if (isExecuted && !isPartial) return (
      <span style={{ background: "rgba(105,211,176,0.15)", color: "var(--color-severity-low-fg)", fontSize: "9px", padding: "2px 6px", borderRadius: "3px", letterSpacing: "0.06em", fontWeight: 500, fontFamily: "var(--font-mono)" }}>{t("apps_tab.badge_moved")}</span>
    );
    if (isPartial) return (
      <span style={{ background: "rgba(245,166,35,0.15)", color: "var(--color-severity-medium-fg)", fontSize: "9px", padding: "2px 6px", borderRadius: "3px", letterSpacing: "0.06em", fontWeight: 500, fontFamily: "var(--font-mono)" }}>{t("apps_tab.badge_partial")}</span>
    );
    if (status.type === "orphaned") return <StatusBadge label={t("apps_tab.badge_orphaned")} semantic="medium" />;
    if (status.type === "companion") return <StatusBadge label={t("apps_tab.badge_companion")} semantic="info" />;
    if (status.type === "ambiguous") return <StatusBadge label={t("apps_tab.badge_investigate")} semantic="medium" />;
    if (status.type === "self_managed") return <SelfBadge />;
    return <SystemBadge />;
  })();

  // Clean button
  const [cleanEnabled, cleanTooltip] = (() => {
    if (isExecuted) return [false, ""];
    if (status.type === "orphaned") return [true, t("apps_tab.tooltip_clean")];
    if (status.type === "companion") return [false, t("apps_tab.tooltip_companion")];
    if (status.type === "ambiguous") return [false, t("apps_tab.tooltip_ambiguous")];
    if (status.type === "self_managed") return [false, t("apps_tab.tooltip_self")];
    return [false, t("apps_tab.tooltip_system")];
  })();

  return (
    <div style={{ ...ROW_STYLE, background: rowBg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div style={{ minWidth: 0, opacity: isDimmed ? 0.4 : 1 }}>
        <div style={{ fontSize: "13px", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isDimmed ? "line-through" : "none" }}>
          {leftover.dir_name}
        </div>
        <div style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isDimmed ? "line-through" : "none" }}>
          {subLine}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", opacity: isDimmed ? 0.4 : 1 }}>—</div>
      <div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: status.type === "orphaned" ? "var(--color-severity-medium-fg)" : "var(--color-text-secondary)", opacity: isDimmed ? 0.4 : 1 }}>
        {formatBytes(leftover.size_bytes)}
      </div>
      <div>{badge}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <RowActions path={leftover.path} />
      </div>
      <div>
        {!isExecuted && (
          <CleanButton
            enabled={cleanEnabled}
            tooltip={cleanTooltip}
            onClick={cleanEnabled ? onClean : undefined}
          />
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppsTab({ apps, executedPaths, partialPaths, onCleanLeftover }: AppsTabProps) {
  const { t } = useTranslation("tabs");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("size");
  const [showSystem, setShowSystem] = useState(false);

  if (!apps || (apps.installed.length === 0 && apps.classified_leftovers.length === 0 && apps.leftovers.length === 0)) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
        {!apps ? t("apps_tab.empty_no_snapshot") : t("apps_tab.empty_none")}
      </div>
    );
  }

  // Use classified_leftovers when available (new snapshots), fall back to legacy leftovers
  const classifiedLeftovers: ClassifiedLeftover[] = apps.classified_leftovers.length > 0
    ? apps.classified_leftovers
    : apps.leftovers.map((l) => ({
        path: l.path,
        dir_name: l.path.split("/").pop() ?? l.path,
        size_bytes: l.size_bytes,
        status: { type: "orphaned" as const },
      }));

  // Visible leftovers (hide system_managed and self_managed unless show-system toggle is on)
  const visibleLeftovers = classifiedLeftovers.filter((cl) =>
    (cl.status.type !== "system_managed" && cl.status.type !== "self_managed") || showSystem
  );

  const allRows: AppRow[] = [
    ...apps.installed.map((app): AppRow => ({
      kind: "installed", app, appStatus: getAppStatus(app),
      sortSize: app.size_bytes, sortAge: app.last_opened_days_ago ?? 0, sortName: app.name.toLowerCase(),
    })),
    ...visibleLeftovers.map((leftover): AppRow => ({
      kind: "leftover", leftover,
      sortSize: leftover.size_bytes, sortAge: Infinity, sortName: leftover.dir_name.toLowerCase(),
    })),
  ];

  const filteredRows = allRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "active") return row.kind === "installed" && row.appStatus === "active";
    if (row.kind !== "leftover") return false;
    if (filter === "orphaned") return row.leftover.status.type === "orphaned";
    if (filter === "companion") return row.leftover.status.type === "companion";
    if (filter === "ambiguous") return row.leftover.status.type === "ambiguous";
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sort === "size") return b.sortSize - a.sortSize;
    if (sort === "last_opened") return b.sortAge - a.sortAge;
    if (sort === "name") return a.sortName.localeCompare(b.sortName);
    return 0;
  });

  const orphanedCount = visibleLeftovers.filter((cl) => cl.status.type === "orphaned").length;
  const companionCount = visibleLeftovers.filter((cl) => cl.status.type === "companion").length;
  const ambiguousCount = visibleLeftovers.filter((cl) => cl.status.type === "ambiguous").length;
  const activeCount = apps.installed.filter((a) => getAppStatus(a) === "active").length;
  const totalCount = apps.installed.length + visibleLeftovers.length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Filter chip row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 20px 12px", borderBottom: "1px solid var(--color-border-divider)", flexWrap: "wrap" }}>
        <FilterChip label={t("apps_tab.filter_all", { count: totalCount })} isActive={filter === "all"} dot={null} onClick={() => setFilter("all")} />
        <FilterChip label={t("apps_tab.filter_orphaned", { count: orphanedCount })} isActive={filter === "orphaned"} dot="var(--color-severity-medium-fg)" onClick={() => setFilter("orphaned")} />
        <FilterChip label={t("apps_tab.filter_companion", { count: companionCount })} isActive={filter === "companion"} dot="var(--color-severity-info-fg)" onClick={() => setFilter("companion")} />
        {ambiguousCount > 0 && (
          <FilterChip label={t("apps_tab.filter_ambiguous", { count: ambiguousCount })} isActive={filter === "ambiguous"} dot="var(--color-severity-medium-fg)" onClick={() => setFilter("ambiguous")} />
        )}
        <FilterChip label={t("apps_tab.filter_active", { count: activeCount })} isActive={filter === "active"} dot="var(--color-severity-low-fg)" onClick={() => setFilter("active")} />

        <div style={{ flex: 1 }} />

        {/* Show system toggle */}
        <button
          onClick={() => setShowSystem((v) => !v)}
          title={undefined}
          style={{
            display: "flex", alignItems: "center", gap: "4px", background: showSystem ? "rgba(255,255,255,0.08)" : "transparent",
            border: "1px solid var(--color-border-subtle)", borderRadius: "12px", padding: "4px 10px",
            color: showSystem ? "var(--color-text-secondary)" : "var(--color-text-muted)",
            fontSize: "11px", cursor: "pointer",
          }}
        >
          <Settings2 size={11} />
          {t("apps_tab.show_system")}
        </button>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{
            background: "var(--color-bg-elev-2)", border: "1px solid var(--color-border-subtle)",
            borderRadius: "6px", color: "var(--color-text-secondary)", fontSize: "11px",
            padding: "4px 8px", cursor: "pointer", fontFamily: "var(--font-sans)",
          }}
        >
          <option value="size">{t("apps_tab.sort_size")}</option>
          <option value="last_opened">{t("apps_tab.sort_last_opened")}</option>
          <option value="name">{t("apps_tab.sort_name")}</option>
        </select>
      </div>

      {/* Column header */}
      <div style={{
        display: "grid", gridTemplateColumns: GRID, padding: "8px 20px",
        borderBottom: "1px solid var(--color-border-divider)", fontFamily: "var(--font-mono)",
        fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        <div /><div>{t("apps_tab.col_name")}</div><div>{t("apps_tab.col_last_opened")}</div><div>{t("apps_tab.col_size")}</div><div>{t("apps_tab.col_status")}</div><div /><div />
      </div>

      {/* Rows */}
      {sortedRows.length === 0 ? (
        <div style={{ padding: "24px 20px", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
          {t("apps_tab.empty_filter", { filter })}
        </div>
      ) : (
        sortedRows.map((row, i) => {
          if (row.kind === "installed") {
            return <InstalledRow key={`inst-${row.app.path}-${i}`} row={row} />;
          }
          const cl = row.leftover;
          return (
            <LeftoverRow
              key={`left-${cl.path}-${i}`}
              row={row}
              isExecuted={executedPaths.has(cl.path)}
              isPartial={partialPaths.has(cl.path)}
              onClean={() => onCleanLeftover([cl.path], cl.dir_name, cl.size_bytes)}
            />
          );
        })
      )}
    </div>
  );
}
