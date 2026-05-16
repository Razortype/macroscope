import { useState } from "react";
import { Package, FolderX } from "lucide-react";
import type { AppsSnapshot, InstalledApp, LeftoverDir } from "../../types/snapshot";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatLastOpened(days: number | null): string {
  if (days === null) return "unknown";
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function getStatus(app: InstalledApp): "active" | "stale" {
  if (app.last_opened_days_ago === null) return "active";
  return app.last_opened_days_ago > 180 ? "stale" : "active";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppsTabProps {
  apps: AppsSnapshot | null;
  onCleanLeftover: (paths: string[], name: string, bytes: number) => void;
}

type AppRow =
  | { type: "installed"; app: InstalledApp; status: "active" | "stale"; sortSize: number; sortAge: number; sortName: string }
  | { type: "leftover"; leftover: LeftoverDir; sortSize: number; sortAge: number; sortName: string };

type FilterKey = "all" | "leftovers" | "stale" | "active";
type SortKey = "size" | "last_opened" | "name";

// ── Sub-components ────────────────────────────────────────────────────────────

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

function StatusBadge({ status }: { status: "active" | "stale" | "leftover" }) {
  const colorMap = { active: "low", stale: "info", leftover: "medium" };
  const semantic = colorMap[status];
  return (
    <span
      style={{
        background: `var(--color-severity-${semantic}-bg)`,
        color: `var(--color-severity-${semantic}-fg)`,
        fontSize: "9px",
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: "var(--radius-xs)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {status}
    </span>
  );
}

const GRID = "50px 1fr 110px 100px 90px 80px";
const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID,
  padding: "10px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  alignItems: "center",
};

function IconCell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "var(--color-bg-elev-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function InstalledRow({ row }: { row: AppRow & { type: "installed" } }) {
  const { app, status } = row;
  return (
    <div style={ROW_STYLE}>
      <IconCell>
        <Package size={14} color="var(--color-text-muted)" />
      </IconCell>
      <div>
        <div style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{app.name}</div>
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
      <div><StatusBadge status={status} /></div>
      <div />
    </div>
  );
}

function LeftoverRow({
  row,
  onClean,
}: {
  row: AppRow & { type: "leftover" };
  onClean: () => void;
}) {
  const { leftover } = row;
  const displayName = leftover.matched_app_name ?? leftover.path.split("/").pop() ?? leftover.path;
  return (
    <div style={{ ...ROW_STYLE, background: "rgba(245,166,35,0.025)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FolderX size={14} color="var(--color-severity-medium-fg)" />
      </div>
      <div>
        <div style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{displayName}</div>
        <div style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {leftover.path}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>— uninstalled</div>
      <div style={{ fontSize: "12px", color: "var(--color-severity-medium-fg)", fontFamily: "var(--font-mono)" }}>
        {formatBytes(leftover.size_bytes)}
      </div>
      <div><StatusBadge status="leftover" /></div>
      <div>
        <button
          onClick={onClean}
          style={{
            background: "var(--color-severity-medium-bg)",
            color: "var(--color-severity-medium-fg)",
            border: "none",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "10px",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          clean →
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppsTab({ apps, onCleanLeftover }: AppsTabProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("size");

  if (!apps || (apps.installed.length === 0 && apps.leftovers.length === 0)) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
        {!apps ? "Take a snapshot to scan installed apps." : "No apps found on this system."}
      </div>
    );
  }

  const allRows: AppRow[] = [
    ...apps.installed.map((app): AppRow => ({
      type: "installed",
      app,
      status: getStatus(app),
      sortSize: app.size_bytes,
      sortAge: app.last_opened_days_ago ?? 0,
      sortName: app.name.toLowerCase(),
    })),
    ...apps.leftovers.map((leftover): AppRow => ({
      type: "leftover",
      leftover,
      sortSize: leftover.size_bytes,
      sortAge: Infinity,
      sortName: (leftover.matched_app_name ?? leftover.path).toLowerCase(),
    })),
  ];

  const filteredRows = allRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "leftovers") return row.type === "leftover";
    if (filter === "stale") return row.type === "installed" && row.status === "stale";
    if (filter === "active") return row.type === "installed" && row.status === "active";
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sort === "size") return b.sortSize - a.sortSize;
    if (sort === "last_opened") return b.sortAge - a.sortAge;
    if (sort === "name") return a.sortName.localeCompare(b.sortName);
    return 0;
  });

  const leftoverCount = apps.leftovers.length;
  const staleCount = apps.installed.filter((a) => getStatus(a) === "stale").length;
  const activeCount = apps.installed.filter((a) => getStatus(a) === "active").length;
  const totalCount = apps.installed.length + apps.leftovers.length;

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
        <FilterChip label={`all ${totalCount}`} isActive={filter === "all"} dot={null} onClick={() => setFilter("all")} />
        <FilterChip label={`leftovers ${leftoverCount}`} isActive={filter === "leftovers"} dot="var(--color-severity-medium-fg)" onClick={() => setFilter("leftovers")} />
        <FilterChip label={`stale ${staleCount}`} isActive={filter === "stale"} dot="var(--color-severity-info-fg)" onClick={() => setFilter("stale")} />
        <FilterChip label={`active ${activeCount}`} isActive={filter === "active"} dot="var(--color-severity-low-fg)" onClick={() => setFilter("active")} />
        <div style={{ flex: 1 }} />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "6px",
            color: "var(--color-text-secondary)",
            fontSize: "11px",
            padding: "4px 8px",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          <option value="size">size ▾</option>
          <option value="last_opened">last opened ▾</option>
          <option value="name">name ▾</option>
        </select>
      </div>

      {/* Column header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          padding: "8px 20px",
          borderBottom: "1px solid var(--color-border-divider)",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        <div />
        <div>name</div>
        <div>last opened</div>
        <div>size</div>
        <div>status</div>
        <div />
      </div>

      {/* Rows */}
      {sortedRows.length === 0 ? (
        <div style={{ padding: "24px 20px", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
          No {filter} apps
        </div>
      ) : (
        sortedRows.map((row, i) => {
          if (row.type === "installed") {
            return <InstalledRow key={`${row.type}-${row.app.path}-${i}`} row={row} />;
          }
          return (
            <LeftoverRow
              key={`${row.type}-${row.leftover.path}-${i}`}
              row={row}
              onClean={() =>
                onCleanLeftover(
                  [row.leftover.path],
                  row.leftover.matched_app_name ?? row.leftover.path.split("/").pop() ?? "leftover",
                  row.leftover.size_bytes
                )
              }
            />
          );
        })
      )}
    </div>
  );
}
