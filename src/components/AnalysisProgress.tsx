import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Sparkles, Cpu, Circle, Loader2, Check } from "lucide-react";
import { useTauriEvent } from "../hooks/useTauriEvent";

// ── Animation ────────────────────────────────────────────────────────────────

const PULSE_CSS = `
@keyframes mscope-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.92); }
  50%       { opacity: 1;    transform: scale(1.06); }
}
.mscope-pulse { animation: mscope-pulse 1.4s ease-in-out infinite; }
`;

// ── Types ────────────────────────────────────────────────────────────────────

type ProbeStatus = "pending" | "running" | "complete" | "failed";
interface ProbeState {
  label: string;
  status: ProbeStatus;
  duration_ms?: number;
}

type AuditPhase = "pending" | "starting" | "analyzing" | "waiting" | "complete" | "error";
interface AuditEvent {
  label: string;
  status: "done" | "running-live";
  time: string;
}
interface AuditState {
  phase: AuditPhase;
  pid?: number;
  elapsed_ms: number;
  events: AuditEvent[];
  timing?: { ttft_ms?: number; duration_api_ms?: number; duration_ms?: number };
  error?: string;
}

interface ProbePayload {
  probe: string;
  status: string;
  duration_ms: number;
  error?: string;
}
interface ProgressPayload {
  preset: string;
  phase: string;
  elapsed_ms: number;
  pid?: number;
  timing?: { ttft_ms?: number; duration_api_ms?: number; duration_ms?: number };
  error?: string;
}
interface FailedPayload {
  preset: string;
  error: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROBE_KEYS = ["disk", "processes", "network", "persistence", "users", "kernel", "apps"] as const;
type ProbeKey = (typeof PROBE_KEYS)[number];

const PROBE_LABELS: Record<ProbeKey, string> = {
  disk: "disk volume",
  processes: "processes",
  network: "listening ports",
  persistence: "launch agents",
  users: "user accounts",
  kernel: "kernel extensions",
  apps: "installed apps",
};

const makeProbes = (): ProbeState[] =>
  PROBE_KEYS.map((k) => ({ label: PROBE_LABELS[k], status: "pending" as ProbeStatus }));

const makeAudit = (): AuditState => ({ phase: "pending", elapsed_ms: 0, events: [] });

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  const label = preset === "disk-audit" ? "disk audit" : "security audit";

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
      {/* Header row */}
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

      {/* Event log */}
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
                  color:
                    ev.status === "running-live" ? "#f5a623" : "rgba(255,255,255,0.55)",
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
  auditDisk,
  auditSecurity,
}: {
  enabled: boolean;
  auditDisk: AuditState;
  auditSecurity: AuditState;
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
        <AuditRow preset="disk-audit" audit={auditDisk} />
        <AuditRow preset="security-audit" audit={auditSecurity} />
      </div>
    </div>
  );
}

// ── AnalysisProgress ──────────────────────────────────────────────────────────

interface Props {
  isActive: boolean;
  onComplete?: () => void;
}

export default function AnalysisProgress({ isActive, onComplete }: Props) {
  const [probes, setProbes] = useState<ProbeState[]>(makeProbes);
  const [audits, setAudits] = useState<Record<string, AuditState>>({
    "disk-audit": makeAudit(),
    "security-audit": makeAudit(),
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const allProbesComplete = probes.every((p) => p.status !== "pending" && p.status !== "running");
  const allAuditsComplete = Object.values(audits).every(
    (a) => a.phase === "complete" || a.phase === "error"
  );
  const allComplete = allProbesComplete && allAuditsComplete;

  // Reset on activation
  useEffect(() => {
    if (!isActive) return;
    setProbes(makeProbes());
    setAudits({ "disk-audit": makeAudit(), "security-audit": makeAudit() });
    setElapsedMs(0);
    startTimeRef.current = performance.now();
  }, [isActive]);

  // Elapsed timer — stops when allComplete
  useEffect(() => {
    if (!isActive || allComplete) return;
    const id = setInterval(() => {
      setElapsedMs(performance.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [isActive, allComplete]);

  // Completion callback after 1500ms hold
  useEffect(() => {
    if (!allComplete || !isActive) return;
    const id = setTimeout(() => onCompleteRef.current?.(), 1500);
    return () => clearTimeout(id);
  }, [allComplete, isActive]);

  const handleProbe = useCallback((payload: ProbePayload) => {
    const idx = PROBE_KEYS.indexOf(payload.probe as ProbeKey);
    if (idx === -1) return;
    setProbes((prev) => {
      const next = [...prev];
      if (payload.status === "starting") {
        next[idx] = { ...next[idx], status: "running" };
      } else if (payload.status === "complete") {
        next[idx] = { ...next[idx], status: "complete", duration_ms: payload.duration_ms };
      } else {
        next[idx] = { ...next[idx], status: "failed", duration_ms: payload.duration_ms };
      }
      return next;
    });
  }, []);

  const handleProgress = useCallback((payload: ProgressPayload) => {
    setAudits((prev) => {
      const audit = prev[payload.preset];
      if (!audit) return prev;
      const elapsedS = fmtS(payload.elapsed_ms);
      const newEvents = [...audit.events];
      const newPid = payload.pid ?? audit.pid;

      // Add spawn row when PID first appears
      if (newPid && !newEvents.some((e) => e.label === "spawn claude -p")) {
        newEvents.push({ label: "spawn claude -p", status: "done", time: "0.1s" });
      }

      if (payload.phase === "analyzing") {
        if (!newEvents.some((e) => e.label === "received system/init")) {
          newEvents.push({ label: "received system/init", status: "done", time: elapsedS });
        }
      } else if (payload.phase === "waiting") {
        if (!newEvents.some((e) => e.label === "rate_limit_event acknowledged")) {
          newEvents.push({ label: "rate_limit_event acknowledged", status: "done", time: elapsedS });
        }
        if (!newEvents.some((e) => e.label === "claude is composing findings...")) {
          newEvents.push({ label: "claude is composing findings...", status: "running-live", time: "live" });
        }
      } else if (payload.phase === "complete" || payload.phase === "error") {
        const filtered = newEvents.filter((e) => e.label !== "claude is composing findings...");
        if (payload.phase === "complete") {
          const t = payload.timing;
          const parts: string[] = [];
          if (t?.ttft_ms != null) parts.push(`ttft ${fmtS(t.ttft_ms)}`);
          if (t?.duration_api_ms != null) parts.push(`api ${fmtS(t.duration_api_ms)}`);
          const timingStr = parts.join(" · ") || elapsedS;
          filtered.push({ label: "claude analysis", status: "done", time: timingStr });
          filtered.push({ label: "findings parsed and validated", status: "done", time: "0.0s" });
        }
        return {
          ...prev,
          [payload.preset]: {
            ...audit,
            phase: payload.phase as AuditPhase,
            pid: newPid,
            elapsed_ms: payload.elapsed_ms,
            events: filtered,
            timing: payload.timing,
            error: payload.error,
          },
        };
      }

      return {
        ...prev,
        [payload.preset]: {
          ...audit,
          phase: payload.phase as AuditPhase,
          pid: newPid,
          elapsed_ms: payload.elapsed_ms,
          events: newEvents,
        },
      };
    });
  }, []);

  const handleFailed = useCallback((payload: FailedPayload) => {
    setAudits((prev) => ({
      ...prev,
      [payload.preset]: { ...prev[payload.preset], phase: "error", error: payload.error },
    }));
  }, []);

  useTauriEvent<ProbePayload>("snapshot:probe", handleProbe);
  useTauriEvent<ProgressPayload>("analyzer:progress", handleProgress);
  useTauriEvent<FailedPayload>("analyzer:preset_failed", handleFailed);

  if (!isActive) return null;

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
      <style>{PULSE_CSS}</style>

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
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {/* Subtitle */}
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "-6px" }}>
        running two AI audits in parallel · disk + security
      </div>

      {/* Step 1 */}
      <ProbeSection probes={probes} allComplete={allProbesComplete} />

      {/* Divider */}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)" }} />

      {/* Step 2 */}
      <ClaudeSection
        enabled={allProbesComplete}
        auditDisk={audits["disk-audit"]}
        auditSecurity={audits["security-audit"]}
      />
    </div>
  );
}
