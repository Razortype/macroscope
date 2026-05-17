import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types (shared with AnalysisProgress) ─────────────────────────────────────

export type ProbeStatus = "pending" | "running" | "complete" | "failed";
export interface ProbeState {
  label: string;
  status: ProbeStatus;
  duration_ms?: number;
}

export type AuditPhase =
  | "pending"
  | "starting"
  | "analyzing"
  | "waiting"
  | "complete"
  | "error";
export interface AuditEvent {
  label: string;
  status: "done" | "running-live";
  time: string;
}
export interface AuditState {
  phase: AuditPhase;
  pid?: number;
  elapsed_ms: number;
  events: AuditEvent[];
  timing?: { ttft_ms?: number; duration_api_ms?: number; duration_ms?: number };
  error?: string;
}

// ── Tauri event payload types ─────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROBE_KEYS = [
  "disk",
  "processes",
  "network",
  "persistence",
  "users",
  "kernel",
  "apps",
] as const;
export type ProbeKey = (typeof PROBE_KEYS)[number];

export const PROBE_LABELS: Record<ProbeKey, string> = {
  disk: "disk volume",
  processes: "processes",
  network: "listening ports",
  persistence: "launch agents",
  users: "user accounts",
  kernel: "kernel extensions",
  apps: "installed apps",
};

// Only the three presets shown in the UI (file-inventory-audit runs silently)
export const DISPLAY_PRESETS = [
  "disk-audit",
  "security-audit",
  "app-lifecycle-audit",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtS(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function makeProbes(): ProbeState[] {
  return PROBE_KEYS.map((k) => ({
    label: PROBE_LABELS[k],
    status: "pending" as ProbeStatus,
  }));
}

export function makeAudit(): AuditState {
  return { phase: "pending", elapsed_ms: 0, events: [] };
}

function makeInitialAudits(): Record<string, AuditState> {
  return Object.fromEntries(DISPLAY_PRESETS.map((p) => [p, makeAudit()]));
}

// ── Run state ─────────────────────────────────────────────────────────────────

export interface RunState {
  active: boolean;
  probes: ProbeState[];
  audits: Record<string, AuditState>;
  elapsedMs: number;
  wallStartedAt: number | null; // Date.now() when run started
}

const IDLE: RunState = {
  active: false,
  probes: makeProbes(),
  audits: makeInitialAudits(),
  elapsedMs: 0,
  wallStartedAt: null,
};

// ── Context ───────────────────────────────────────────────────────────────────

interface AnalysisRunContextType {
  run: RunState;
  startRun: () => void;
  deactivateRun: () => void;
}

const AnalysisRunContext = createContext<AnalysisRunContextType | null>(null);

export function useAnalysisRun(): AnalysisRunContextType {
  const ctx = useContext(AnalysisRunContext);
  if (!ctx) throw new Error("useAnalysisRun must be used inside AnalysisRunProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const PULSE_CSS = `
@keyframes mscope-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.92); }
  50%       { opacity: 1;    transform: scale(1.06); }
}
.mscope-pulse { animation: mscope-pulse 1.4s ease-in-out infinite; }
`;

export function AnalysisRunProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<RunState>(IDLE);
  const perfStartRef = useRef(0); // performance.now() at run start

  // Elapsed timer — ticks while active
  useEffect(() => {
    if (!run.active) return;
    const id = setInterval(() => {
      setRun((prev) =>
        prev.active
          ? { ...prev, elapsedMs: performance.now() - perfStartRef.current }
          : prev
      );
    }, 100);
    return () => clearInterval(id);
  }, [run.active]);

  // Auto-deactivate 1500ms after all tracked probes and audits finish
  const allProbesComplete = run.probes.every(
    (p) => p.status !== "pending" && p.status !== "running"
  );
  const allAuditsComplete = Object.values(run.audits).every(
    (a) => a.phase === "complete" || a.phase === "error"
  );
  const allComplete = run.active && allProbesComplete && allAuditsComplete;

  useEffect(() => {
    if (!allComplete) return;
    const id = setTimeout(() => {
      setRun((prev) => ({ ...prev, active: false }));
    }, 1500);
    return () => clearTimeout(id);
  }, [allComplete]);

  // Tauri event listeners — registered once at app boot, never torn down
  useEffect(() => {
    const pending: Promise<UnlistenFn>[] = [];

    pending.push(
      listen<ProbePayload>("snapshot:probe", (e) => {
        const payload = e.payload;
        setRun((prev) => {
          if (!prev.active) return prev;
          const idx = PROBE_KEYS.indexOf(payload.probe as ProbeKey);
          if (idx === -1) return prev;
          const next = [...prev.probes];
          if (payload.status === "starting") {
            next[idx] = { ...next[idx], status: "running" };
          } else if (payload.status === "complete") {
            next[idx] = { ...next[idx], status: "complete", duration_ms: payload.duration_ms };
          } else {
            next[idx] = { ...next[idx], status: "failed", duration_ms: payload.duration_ms };
          }
          return { ...prev, probes: next };
        });
      })
    );

    pending.push(
      listen<ProgressPayload>("analyzer:progress", (e) => {
        const payload = e.payload;
        setRun((prev) => {
          if (!prev.active) return prev;
          const audit = prev.audits[payload.preset];
          if (!audit) return prev; // file-inventory-audit — not displayed, skip

          const elapsedS = fmtS(payload.elapsed_ms);
          const newEvents = [...audit.events];
          const newPid = payload.pid ?? audit.pid;

          if (newPid && !newEvents.some((ev) => ev.label === "spawn claude -p")) {
            newEvents.push({ label: "spawn claude -p", status: "done", time: "0.1s" });
          }

          if (payload.phase === "analyzing") {
            if (!newEvents.some((ev) => ev.label === "received system/init")) {
              newEvents.push({ label: "received system/init", status: "done", time: elapsedS });
            }
          } else if (payload.phase === "waiting") {
            if (!newEvents.some((ev) => ev.label === "rate_limit_event acknowledged")) {
              newEvents.push({ label: "rate_limit_event acknowledged", status: "done", time: elapsedS });
            }
            if (!newEvents.some((ev) => ev.label === "claude is composing findings...")) {
              newEvents.push({ label: "claude is composing findings...", status: "running-live", time: "live" });
            }
          } else if (payload.phase === "complete" || payload.phase === "error") {
            const filtered = newEvents.filter(
              (ev) => ev.label !== "claude is composing findings..."
            );
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
              audits: {
                ...prev.audits,
                [payload.preset]: {
                  ...audit,
                  phase: payload.phase as AuditPhase,
                  pid: newPid,
                  elapsed_ms: payload.elapsed_ms,
                  events: filtered,
                  timing: payload.timing,
                  error: payload.error,
                },
              },
            };
          }

          return {
            ...prev,
            audits: {
              ...prev.audits,
              [payload.preset]: {
                ...audit,
                phase: payload.phase as AuditPhase,
                pid: newPid,
                elapsed_ms: payload.elapsed_ms,
                events: newEvents,
              },
            },
          };
        });
      })
    );

    pending.push(
      listen<FailedPayload>("analyzer:preset_failed", (e) => {
        const payload = e.payload;
        setRun((prev) => {
          if (!prev.active) return prev;
          const audit = prev.audits[payload.preset];
          if (!audit) return prev;
          return {
            ...prev,
            audits: {
              ...prev.audits,
              [payload.preset]: { ...audit, phase: "error" as AuditPhase, error: payload.error },
            },
          };
        });
      })
    );

    return () => {
      Promise.all(pending).then((fns) => fns.forEach((fn) => fn()));
    };
  }, []); // intentionally empty — register once at app boot

  const startRun = useCallback(() => {
    perfStartRef.current = performance.now();
    setRun({
      active: true,
      probes: makeProbes(),
      audits: makeInitialAudits(),
      elapsedMs: 0,
      wallStartedAt: Date.now(),
    });
  }, []);

  const deactivateRun = useCallback(() => {
    setRun((prev) => ({ ...prev, active: false }));
  }, []);

  return (
    <AnalysisRunContext.Provider value={{ run, startRun, deactivateRun }}>
      <style>{PULSE_CSS}</style>
      {children}
    </AnalysisRunContext.Provider>
  );
}
