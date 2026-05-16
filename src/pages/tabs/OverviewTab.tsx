import type { Finding, Severity } from "../../types/finding";
import type { Snapshot } from "../../types/snapshot";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

function diskBarColor(pct: number): string {
  if (pct > 80) return "var(--color-severity-high-fg)";
  if (pct > 50) return "var(--color-severity-medium-fg)";
  return "var(--color-severity-low-fg)";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OverviewTabProps {
  latestSnapshot: Snapshot | null;
  findings: Finding[] | null;
  onJumpToFindings: () => void;
  onJumpToApps: () => void;
  onJumpToFiles: () => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "6px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function HeroNumber({
  value,
  suffix,
  color,
}: {
  value: string;
  suffix?: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-3xl)",
          fontWeight: 500,
          lineHeight: "var(--leading-tight)",
          color: color ?? "var(--color-text-primary)",
        }}
      >
        {value}
      </span>
      {suffix && (
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function SubLine({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
      {children}
    </span>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      style={{
        height: "4px",
        background: "var(--color-bg-elev-3)",
        borderRadius: "2px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, percent)}%`,
          height: "100%",
          background: color,
          borderRadius: "2px",
          transition: "width 400ms ease",
        }}
      />
    </div>
  );
}

function SeverityBar({ findings }: { findings: Finding[] }) {
  const severities: Severity[] = ["high", "medium", "low", "info"];
  const counts = severities.map((s) => ({
    s,
    n: findings.filter((f) => f.severity === s).length,
  }));
  const total = findings.length;
  if (total === 0) {
    return (
      <div
        style={{
          height: "4px",
          background: "var(--color-bg-elev-3)",
          borderRadius: "2px",
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", height: "4px", borderRadius: "2px", overflow: "hidden" }}>
      {counts.filter((c) => c.n > 0).map(({ s, n }) => (
        <div
          key={s}
          style={{
            flex: n / total,
            background: `var(--color-severity-${s}-fg)`,
          }}
        />
      ))}
    </div>
  );
}

function CompactFindingRow({ finding: f, isLast }: { finding: Finding; isLast: boolean }) {
  const hint =
    f.suggested_action === "delete_paths"
      ? f.estimated_bytes_freed
        ? `${formatBytes(f.estimated_bytes_freed)} freeable`
        : "deleteable"
      : f.suggested_action === "investigate"
      ? "investigate"
      : f.suggested_action;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 0",
        borderBottom: isLast ? "none" : "1px solid var(--color-border-divider)",
      }}
    >
      <span
        style={{
          background: `var(--color-severity-${f.severity}-bg)`,
          color: `var(--color-severity-${f.severity}-fg)`,
          borderRadius: "var(--radius-xs)",
          padding: "1px 5px",
          fontSize: "10px",
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
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        {f.category}
      </span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-text-primary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {f.title}
      </span>
      <span
        style={{
          fontSize: "11px",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}
      >
        {hint}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OverviewTab({
  latestSnapshot,
  findings,
  onJumpToFindings,
  onJumpToApps,
  onJumpToFiles,
}: OverviewTabProps) {
  // Empty state
  if (!latestSnapshot) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          color: "var(--color-text-muted)",
          fontSize: "var(--text-sm)",
        }}
      >
        Take your first snapshot to begin.
      </div>
    );
  }

  // Disk metrics
  const vol = latestSnapshot.disk?.volume;
  const freeGb = vol ? (vol.available_bytes / 1e9).toFixed(1) : "—";
  const usedPct = vol ? vol.capacity_pct : 0;
  const totalStr = vol ? formatBytes(vol.size_bytes) : "—";

  // Findings metrics
  const allFindings = findings ?? [];
  const actionableFindings = allFindings.filter((f) => f.suggested_action === "delete_paths");
  const investigateCount = allFindings.filter((f) => f.suggested_action === "investigate").length;
  const recoverableBytes = actionableFindings.reduce((s, f) => s + (f.estimated_bytes_freed ?? 0), 0);
  const recoverableGb = (recoverableBytes / 1e9).toFixed(1);
  const pathCount = new Set(
    actionableFindings.flatMap((f) => f.paths_to_remove ?? [])
  ).size;
  const recoverablePct =
    vol && vol.used_bytes > 0 ? Math.round((recoverableBytes / vol.used_bytes) * 100) : null;

  // Top priority
  const topFindings = [...allFindings]
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    )
    .slice(0, 3);

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Row 1 — Metric cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          gap: "12px",
        }}
      >
        {/* Disk card */}
        <MetricCard>
          <CardLabel>Disk</CardLabel>
          <HeroNumber value={freeGb} suffix="GB free" />
          {vol && (
            <>
              <SubLine>{usedPct}% used of {totalStr}</SubLine>
              <ProgressBar percent={usedPct} color={diskBarColor(usedPct)} />
            </>
          )}
        </MetricCard>

        {/* Findings card */}
        <MetricCard>
          <CardLabel>Findings</CardLabel>
          <HeroNumber value={String(allFindings.length)} suffix="total" />
          <SubLine>
            {actionableFindings.length} actionable · {investigateCount} to investigate
          </SubLine>
          <SeverityBar findings={allFindings} />
        </MetricCard>

        {/* Recoverable card */}
        <MetricCard>
          <CardLabel>Recoverable</CardLabel>
          <HeroNumber value={recoverableGb} suffix="GB" color="var(--color-accent)" />
          <SubLine>across {pathCount} paths</SubLine>
          {recoverablePct != null && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--color-text-muted)",
              }}
            >
              ↑ ~{recoverablePct}% of used space
            </span>
          )}
        </MetricCard>
      </div>

      {/* Row 2 — Top priority */}
      <div
        style={{
          background: "var(--color-bg-elev-1)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "6px",
          padding: "14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: topFindings.length > 0 ? "8px" : 0,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
            }}
          >
            top priority findings
          </span>
          <button
            onClick={onJumpToFindings}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "11px",
              color: "var(--color-text-muted)",
            }}
          >
            view all {allFindings.length} →
          </button>
        </div>
        {topFindings.length === 0 ? (
          <div
            style={{
              paddingTop: "8px",
              fontSize: "var(--text-sm)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            No findings — system looks clean
          </div>
        ) : (
          topFindings.map((f, i) => (
            <CompactFindingRow key={f.id} finding={f} isLast={i === topFindings.length - 1} />
          ))
        )}
      </div>

      {/* Row 3 — Cross-tab preview cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {/* Apps preview */}
        <button
          onClick={onJumpToApps}
          style={{
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "6px",
            padding: "12px 14px",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-1)";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              Apps
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>→</span>
          </div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {(() => {
              const a = latestSnapshot.apps;
              if (!a) return "Take a snapshot to scan apps";
              const stale = a.installed.filter((app) => (app.last_opened_days_ago ?? 0) > 180).length;
              return `${a.installed.length} installed · ${a.leftovers.length} leftovers · ${stale} stale`;
            })()}
          </span>
        </button>

        {/* Large files preview */}
        <button
          onClick={onJumpToFiles}
          style={{
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "6px",
            padding: "12px 14px",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-1)";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              Large Files
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>→</span>
          </div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            25 over 50 MB · 12.4 GB total
          </span>
        </button>
      </div>
    </div>
  );
}
