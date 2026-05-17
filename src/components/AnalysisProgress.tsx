import { Search, Sparkles, Cpu, Circle, Loader2, Check } from "lucide-react";
import {
  useAnalysisRun,
  DISPLAY_PRESETS,
  type ProbeState,
  type AuditState,
} from "../context/AnalysisRunContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const total = ms / 1000;
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(Math.floor(total % 60)).padStart(2, "0");
  const ds = String(Math.floor((total * 10) % 10));
  return `${m}:${s}.${ds}`;
}

function fmtS(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── ProbeRow ─────────────────────────────────────────────────────────────────

function ProbeRow({ probe }: { probe: ProbeState }) {
  const isPending = probe.status === "pending";
  const isRunning = probe.status === "running";
  const isDone = probe.status === "complete" || probe.status === "failed";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        opacity: isPending ? 0.4 : isRunning ? 0.7 : 1,
        transition: "opacity 0.25s",
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {isPending && <Circle size={11} style={{ color: "rgba(255,255,255,0.3)" }} />}
        {isRunning && <Loader2 size={11} className="mscope-pulse" style={{ color: "#f5a623" }} />}
        {isDone && <Check size={11} style={{ color: "#5dca8c" }} />}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "#e8e8ed",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {probe.label}
      </span>
      {probe.duration_ms != null && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "rgba(255,255,255,0.45)" }}>
          {fmtS(probe.duration_ms)}
        </span>
      )}
    </div>
  );
}

// ── ProbeSection ─────────────────────────────────────────────────────────────

function ProbeSection({ probes, allComplete }: { probes: ProbeState[]; allComplete: boolean }) {
  const runningCount = probes.filter((p) => p.status === "running").length;
  const doneCount = probes.filter((p) => p.status === "complete" || p.status === "failed").length;
  const totalDur = allComplete ? probes.reduce((s, p) => s + (p.duration_ms ?? 0), 0) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Search size={11} style={{ color: "rgba(255,255,255,0.45)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "rgba(255,255,255,0.45)",
            flex: 1,
          }}
        >
          step 1 · local probes
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: allComplete ? "#5dca8c" : runningCount > 0 ? "#f5a623" : "rgba(255,255,255,0.4)",
          }}
        >
          {allComplete
            ? `complete · ${fmtS(totalDur!)}`
            : runningCount > 0
            ? "running…"
            : `${doneCount}/${probes.length}`}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
        {probes.map((p) => (
          <ProbeRow key={p.label} probe={p} />
        ))}
      </div>
    </div>
  );
}

// ── AuditRow ─────────────────────────────────────────────────────────────────

function AuditRow({ preset, audit }: { preset: string; audit: AuditState }) {
  const isComplete = audit.phase === "complete";
  const isError = audit.phase === "error";
  const isRunning =
    audit.phase === "starting" || audit.phase === "analyzing" || audit.phase === "waiting";
  const isPending = audit.phase === "pending";

  const dotColor = isComplete
    ? "#5dca8c"
    : isError
    ? "#e05050"
    : isRunning
    ? "#5da3f5"
    : "rgba(255,255,255,0.25)";

  const labelMap: Record<string, string> = {
    "disk-audit": "disk audit",
    "security-audit": "security audit",
    "app-lifecycle-audit": "app lifecycle audit",
  };
  const label = labelMap[preset] ?? preset;

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: isComplete
          ? "1px solid rgba(93,202,140,0.15)"
          : isError
          ? "1px solid rgba(224,80,80,0.15)"
          : "1px solid rgba(255,255,255,0.06)",
        background: isComplete ? "rgba(93,202,140,0.04)" : "rgba(255,255,255,0.02)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        transition: "border-color 0.4s, background 0.4s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          className={isRunning ? "mscope-pulse" : undefined}
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: "12px", fontWeight: 500, color: "#e8e8ed", flex: 1 }}>
          {label}
        </span>
        {audit.pid != null && !isComplete && !isError && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
            pid {audit.pid}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: isComplete ? "#5dca8c" : isError ? "#e05050" : "rgba(255,255,255,0.45)",
          }}
        >
          {isComplete
            ? `complete · ${fmtS(audit.elapsed_ms)}`
            : isError
            ? "failed"
            : isPending
            ? "—"
            : fmtS(audit.elapsed_ms)}
        </span>
      </div>

      {audit.events.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", paddingLeft: "15px" }}>
          {audit.events.map((ev, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {ev.status === "running-live" && (
                <span
                  className="mscope-pulse"
                  style={{
                    display: "inline-block",
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: "#f5a623",
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: ev.status === "running-live" ? "#f5a623" : "rgba(255,255,255,0.55)",
                  flex: 1,
                }}
              >
                {ev.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "rgba(255,255,255,0.3)",
                  flexShrink: 0,
                }}
              >
                {ev.time}
              </span>
            </div>
          ))}
        </div>
      )}

      {isError && audit.error && (
        <div
          style={{
            paddingLeft: "15px",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "#e05050",
          }}
        >
          {audit.error}
        </div>
      )}
    </div>
  );
}

// ── ClaudeSection ─────────────────────────────────────────────────────────────

function ClaudeSection({
  enabled,
  audits,
}: {
  enabled: boolean;
  audits: Record<string, AuditState>;
}) {
  return (
    <div
      style={{
        opacity: enabled ? 1 : 0.3,
        transition: "opacity 0.3s",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Sparkles size={11} style={{ color: "rgba(255,255,255,0.45)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "rgba(255,255,255,0.45)",
            flex: 1,
          }}
        >
          step 2 · ai analysis (claude sonnet)
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "rgba(255,255,255,0.25)" }}>
          claude -p · stream-json
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {DISPLAY_PRESETS.map((preset) =>
          audits[preset] ? (
            <AuditRow key={preset} preset={preset} audit={audits[preset]} />
          ) : null
        )}
      </div>
    </div>
  );
}

// ── AnalysisProgress ──────────────────────────────────────────────────────────

export default function AnalysisProgress() {
  const { run } = useAnalysisRun();

  const allProbesComplete = run.probes.every(
    (p) => p.status !== "pending" && p.status !== "running"
  );
  const allAuditsComplete = Object.values(run.audits).every(
    (a) => a.phase === "complete" || a.phase === "error"
  );
  const allComplete = allProbesComplete && allAuditsComplete;

  return (
    <div
      style={{
        background: "#0c0c14",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--radius-md)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        marginBottom: "16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          className={allComplete ? undefined : "mscope-pulse"}
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: allComplete ? "#5dca8c" : "#f5a623",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "#e8e8ed", flex: 1 }}>
          {allComplete ? "Analysis complete" : "Analyzing your system"}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "100px",
            padding: "2px 7px",
            flexShrink: 0,
          }}
        >
          <Cpu size={10} style={{ color: "rgba(255,255,255,0.4)" }} />
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "rgba(255,255,255,0.4)" }}
          >
            powered by claude code cli
          </span>
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "rgba(255,255,255,0.45)",
            flexShrink: 0,
          }}
        >
          {formatElapsed(run.elapsedMs)}
        </span>
      </div>

      {/* Subtitle */}
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "-6px" }}>
        running three AI audits in parallel · disk + security + apps
      </div>

      {/* Step 1 */}
      <ProbeSection probes={run.probes} allComplete={allProbesComplete} />

      {/* Divider */}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)" }} />

      {/* Step 2 */}
      <ClaudeSection enabled={allProbesComplete} audits={run.audits} />
    </div>
  );
}
