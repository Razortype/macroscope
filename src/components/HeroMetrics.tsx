import type { ClaudeStatus, Snapshot } from "../types/snapshot";

interface Props {
  snapshot: Snapshot | null;
  claudeStatus: ClaudeStatus | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(0)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function MetricCard({
  label,
  hero,
  heroColor,
  sub,
  subColor,
}: {
  label: string;
  hero: string;
  heroColor?: string;
  sub: string;
  subColor?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-3xl)",
          fontWeight: 500,
          lineHeight: "var(--leading-tight)",
          color: heroColor ?? "var(--color-text-primary)",
        }}
      >
        {hero}
      </span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          color: subColor ?? "var(--color-text-secondary)",
          lineHeight: "var(--leading-snug)",
        }}
      >
        {sub}
      </span>
    </div>
  );
}

export default function HeroMetrics({ snapshot, claudeStatus }: Props) {
  const vol = snapshot?.disk?.volume;

  const diskHero = vol ? formatBytes(vol.available_bytes) : "—";
  const diskSub = vol
    ? `${vol.capacity_pct}% used of ${formatBytes(vol.size_bytes)}`
    : "Take a snapshot to see disk stats";

  const claudeHero = claudeStatus?.available
    ? "✓"
    : claudeStatus
    ? "✗"
    : "—";

  const claudeHeroColor = claudeStatus?.available
    ? "var(--color-status-ok)"
    : claudeStatus?.error
    ? "var(--color-severity-high-fg)"
    : "var(--color-text-muted)";

  const claudeSub = claudeStatus?.available
    ? claudeStatus.path?.replace(/\/bin\/claude$/, "") ?? ""
    : claudeStatus?.error ?? "Checking…";

  const claudeSubColor =
    claudeStatus?.available
      ? "var(--color-text-secondary)"
      : claudeStatus?.error
      ? "var(--color-severity-high-fg)"
      : undefined;

  return (
    <div style={{ display: "flex", gap: "12px" }}>
      <MetricCard label="Disk" hero={diskHero} sub={diskSub} />
      <MetricCard
        label="Claude"
        hero={claudeHero}
        heroColor={claudeHeroColor}
        sub={claudeSub}
        subColor={claudeSubColor}
      />
    </div>
  );
}
