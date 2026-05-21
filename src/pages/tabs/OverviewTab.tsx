import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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

function formatRelativeTime(ts: number): string {
  // i18n-deferred: replace with Intl.RelativeTimeFormat keyed off locale
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LastAnalysisAudit {
  preset: string;
  label: string;
  findingCount: number;
}

export interface LastAnalysisTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
}

export interface LastAnalysisSummary {
  completedAt: number;
  totalDurationMs: number;
  audits: LastAnalysisAudit[];
  tokenTotals?: LastAnalysisTokenTotals;
}

export interface OverviewTabProps {
  latestSnapshot: Snapshot | null;
  findings: Finding[] | null;
  lastAnalysis: LastAnalysisSummary | null;
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
  const { t } = useTranslation("tabs");
  const hint =
    f.suggested_action === "delete_paths"
      ? f.estimated_bytes_freed
        ? t("overview.finding_hint_freeable", { bytes: formatBytes(f.estimated_bytes_freed) })
        : t("overview.finding_hint_deleteable")
      : f.suggested_action === "investigate"
      ? t("overview.finding_hint_investigate")
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

function AuditFindingCount({ count }: { count: number }) {
  const { t } = useTranslation("tabs");
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}>
      {t("overview.finding_count", { count })}
    </div>
  );
}

function AuditSummaryCard({ label, findingCount }: { label: string; findingCount: number }) {
  return (
    <div
      style={{
        background: "var(--color-bg-elev-2)",
        borderRadius: 4,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#5dca8c",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500 }}>
          {label}
        </span>
      </div>
      <AuditFindingCount count={findingCount} />
    </div>
  );
}

function LastAnalysisSection({ lastAnalysis }: { lastAnalysis: LastAnalysisSummary }) {
  const { t } = useTranslation("tabs");
  const [relTime, setRelTime] = useState(() => formatRelativeTime(lastAnalysis.completedAt));

  useEffect(() => {
    setRelTime(formatRelativeTime(lastAnalysis.completedAt));
    const id = setInterval(
      () => setRelTime(formatRelativeTime(lastAnalysis.completedAt)),
      30_000
    );
    return () => clearInterval(id);
  }, [lastAnalysis.completedAt]);

  const totalSecs = (lastAnalysis.totalDurationMs / 1000).toFixed(0);

  return (
    <div
      style={{
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: 6,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-secondary)",
          }}
        >
          {t("overview.last_analysis_label")}
        </span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {lastAnalysis.tokenTotals && (
            <span
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}
            >
              {lastAnalysis.tokenTotals.cacheRead > 0
                ? t("overview.last_analysis_tokens_cached", {
                    input: lastAnalysis.tokenTotals.input.toLocaleString("en-US"),
                    output: lastAnalysis.tokenTotals.output.toLocaleString("en-US"),
                    cached: lastAnalysis.tokenTotals.cacheRead.toLocaleString("en-US"),
                  })
                : t("overview.last_analysis_tokens", {
                    input: lastAnalysis.tokenTotals.input.toLocaleString("en-US"),
                    output: lastAnalysis.tokenTotals.output.toLocaleString("en-US"),
                  })}
            </span>
          )}
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}
          >
            {t("overview.last_analysis_time", { secs: totalSecs })}
          </span>
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-muted)" }}
          >
            {relTime}
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {lastAnalysis.audits.map((a) => (
          <AuditSummaryCard key={a.preset} label={a.label} findingCount={a.findingCount} />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OverviewTab({
  latestSnapshot,
  findings,
  lastAnalysis,
  onJumpToFindings,
  onJumpToApps,
  onJumpToFiles,
}: OverviewTabProps) {
  const { t } = useTranslation("tabs");

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
        {t("overview.empty")}
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
  const usedBytes = vol ? vol.size_bytes - vol.available_bytes : 0;
  const recoverablePct =
    vol && usedBytes > 0 ? Math.round((recoverableBytes / usedBytes) * 100) : null;

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
          <CardLabel>{t("overview.disk_label")}</CardLabel>
          <HeroNumber value={freeGb} suffix={t("overview.disk_free_suffix")} />
          {vol && (
            <>
              <SubLine>{t("overview.disk_used", { pct: usedPct, total: totalStr })}</SubLine>
              <ProgressBar percent={usedPct} color={diskBarColor(usedPct)} />
            </>
          )}
        </MetricCard>

        {/* Findings card */}
        <MetricCard>
          <CardLabel>{t("overview.findings_label")}</CardLabel>
          <HeroNumber value={String(allFindings.length)} suffix={t("overview.findings_total_suffix")} />
          <SubLine>
            {t("overview.findings_breakdown", { actionable: actionableFindings.length, investigate: investigateCount })}
          </SubLine>
          <SeverityBar findings={allFindings} />
        </MetricCard>

        {/* Recoverable card */}
        <MetricCard>
          <CardLabel>{t("overview.recoverable_label")}</CardLabel>
          <HeroNumber value={recoverableGb} suffix={t("overview.recoverable_suffix")} color="var(--color-accent)" />
          <SubLine>{t("overview.recoverable_paths", { count: pathCount })}</SubLine>
          {recoverablePct != null && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--color-text-muted)",
              }}
            >
              {t("overview.recoverable_pct", { pct: recoverablePct })}
            </span>
          )}
        </MetricCard>
      </div>

      {/* Row 2 — Last analysis summary */}
      {lastAnalysis && <LastAnalysisSection lastAnalysis={lastAnalysis} />}

      {/* Row 3 — Top priority */}
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
            {t("overview.top_findings_label")}
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
            {t("overview.top_findings_view_all", { count: allFindings.length })}
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
            {t("overview.top_findings_empty")}
          </div>
        ) : (
          topFindings.map((f, i) => (
            <CompactFindingRow key={f.id} finding={f} isLast={i === topFindings.length - 1} />
          ))
        )}
      </div>

      {/* Row 4 — Cross-tab preview cards */}
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
              {t("overview.apps_label")}
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>→</span>
          </div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {(() => {
              const a = latestSnapshot.apps;
              if (!a) return t("overview.apps_empty");
              const stale = a.installed.filter((app) => (app.last_opened_days_ago ?? 0) > 180).length;
              return t("overview.apps_summary", { installed: a.installed.length, leftovers: a.leftovers.length, stale });
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
              {t("overview.files_label")}
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>→</span>
          </div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {(() => {
              const lf = latestSnapshot.large_files;
              if (!lf) return t("overview.files_empty");
              const totalBytes = lf.files.reduce((s, f) => s + f.size_bytes, 0);
              return t("overview.files_summary", { count: lf.files.length, bytes: formatBytes(totalBytes) });
            })()}
          </span>
        </button>
      </div>
    </div>
  );
}
