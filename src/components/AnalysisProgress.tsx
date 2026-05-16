import { useState, useEffect, useCallback } from "react";
import { useTauriEvent } from "../hooks/useTauriEvent";

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = "starting" | "analyzing" | "waiting" | "complete" | "error";

interface ProgressState {
  phase: Phase;
  elapsed_ms: number;
  error?: string;
  timing?: { duration_ms?: number; duration_api_ms?: number };
}

interface ProgressPayload {
  preset: string;
  phase: Phase;
  elapsed_ms: number;
  error?: string;
  timing?: { duration_ms?: number; duration_api_ms?: number };
}

interface FailedPayload {
  preset: string;
  error: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function phaseLabel(phase: Phase, error?: string): string {
  switch (phase) {
    case "starting":
      return "starting...";
    case "analyzing":
      return "analyzing snapshot...";
    case "waiting":
      return "waiting for Claude...";
    case "complete":
      return "complete";
    case "error":
      return error ? `failed: ${error}` : "failed";
  }
}

function phaseDotColor(phase: Phase): string {
  if (phase === "complete") return "var(--color-status-ok)";
  if (phase === "error") return "var(--color-status-critical)";
  return "var(--color-severity-info)";
}

function presetLabel(preset: string): string {
  return preset === "disk-audit" ? "Disk audit" : "Security audit";
}

const PRESETS = ["disk-audit", "security-audit"];
const INITIAL_STATE: Record<string, ProgressState> = Object.fromEntries(
  PRESETS.map((p) => [p, { phase: "starting" as Phase, elapsed_ms: 0 }])
);

const TERMINAL: Phase[] = ["complete", "error"];

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  isActive: boolean;
}

export default function AnalysisProgress({ isActive }: Props) {
  const [states, setStates] = useState<Record<string, ProgressState>>(INITIAL_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Reset when a new analysis starts
  useEffect(() => {
    if (isActive) {
      setStates(INITIAL_STATE);
      setElapsedMs(0);
    }
  }, [isActive]);

  // Elapsed timer — ticks while any preset is non-terminal
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      const allDone = Object.values(states).every((s) => TERMINAL.includes(s.phase));
      if (!allDone) setElapsedMs((ms) => ms + 1000);
    }, 1000);
    return () => clearInterval(id);
  }, [isActive, states]);

  const handleProgress = useCallback((payload: ProgressPayload) => {
    setStates((prev) => ({
      ...prev,
      [payload.preset]: {
        phase: payload.phase,
        elapsed_ms: payload.elapsed_ms,
        error: payload.error,
        timing: payload.timing,
      },
    }));
  }, []);

  const handleFailed = useCallback((payload: FailedPayload) => {
    setStates((prev) => ({
      ...prev,
      [payload.preset]: {
        ...(prev[payload.preset] ?? { phase: "error", elapsed_ms: 0 }),
        phase: "error",
        error: payload.error,
      },
    }));
  }, []);

  useTauriEvent<ProgressPayload>("analyzer:progress", handleProgress);
  useTauriEvent<FailedPayload>("analyzer:preset_failed", handleFailed);

  if (!isActive) return null;

  const allDone = Object.values(states).every((s) => TERMINAL.includes(s.phase));

  return (
    <div
      style={{
        margin: "0 -20px",
        padding: "16px 20px",
        background: "var(--color-bg-elev-1)",
        borderTop: "1px solid var(--color-border-divider)",
        borderBottom: "1px solid var(--color-border-divider)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Pulse dot */}
        {!allDone && (
          <span
            className="macroscope-pulse-dot"
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "var(--color-accent)",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            flex: 1,
          }}
        >
          Analyzing your system
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {/* Per-preset rows */}
      {PRESETS.map((preset) => {
        const s = states[preset] ?? { phase: "starting" as Phase, elapsed_ms: 0 };
        return (
          <div
            key={preset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              paddingLeft: "18px",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: phaseDotColor(s.phase),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-secondary)",
                minWidth: "90px",
              }}
            >
              {presetLabel(preset)}
            </span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              {phaseLabel(s.phase, s.error)}
            </span>
          </div>
        );
      })}

      <style>{`
        @keyframes macroscope-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .macroscope-pulse-dot {
          animation: macroscope-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
