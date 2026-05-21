import { useEffect, useState } from "react";
import { useNavigate, useLocation, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import { useAnalysisRun } from "./context/AnalysisRunContext";
import type { RunState } from "./context/AnalysisRunContext";
import { TooltipProvider } from "./components/ui/tooltip";

// ── Indicator helpers ─────────────────────────────────────────────────────────

function deriveStage(run: RunState): string {
  if (run.probes.some((p) => p.status === "pending" || p.status === "running")) {
    return "probing";
  }
  const phases = Object.values(run.audits).map((a) => a.phase);
  if (phases.some((p) => p === "waiting")) return "waiting";
  return "analyzing";
}

// ── AnalysisIndicatorBar ──────────────────────────────────────────────────────

function AnalysisIndicatorBar() {
  const { run } = useAnalysisRun();
  const navigate = useNavigate();
  const location = useLocation();

  if (!run.active) return null;

  const elapsedS = Math.floor(run.elapsedMs / 1000);
  const stage = deriveStage(run);
  const onDashboard = location.pathname === "/";

  return (
    <button
      onClick={() => navigate("/")}
      disabled={onDashboard}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "5px 16px",
        background: "var(--color-bg-elev-2)",
        borderTop: "none",
        borderRight: "none",
        borderLeft: "none",
        borderBottom: "1px solid var(--color-border-divider)",
        cursor: onDashboard ? "default" : "pointer",
        flexShrink: 0,
        textAlign: "left",
      }}
    >
      <span
        className="mscope-pulse"
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "var(--color-accent)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          userSelect: "none",
        }}
      >
        analyzing
        <span style={{ color: "var(--color-text-muted)", margin: "0 4px" }}>·</span>
        <span style={{ color: "var(--color-accent)" }}>{elapsedS}s</span>
        <span style={{ color: "var(--color-text-muted)", margin: "0 4px" }}>·</span>
        {stage}
      </span>
      {!onDashboard && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: "11px",
            color: "var(--color-text-muted)",
            userSelect: "none",
          }}
        >
          → view progress
        </span>
      )}
    </button>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [firstRunChecked, setFirstRunChecked] = useState(false);
  const [firstRunCompleted, setFirstRunCompleted] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_first_run_state")
      .then((completed) => {
        setFirstRunCompleted(completed);
        setFirstRunChecked(true);
      })
      .catch(() => {
        setFirstRunCompleted(true);
        setFirstRunChecked(true);
      });
  }, []);

  return (
    <TooltipProvider delayDuration={400}>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {firstRunChecked && (
        firstRunCompleted ? (
          <>
            <AnalysisIndicatorBar />
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </>
        ) : (
          <Onboarding onComplete={() => setFirstRunCompleted(true)} />
        )
      )}
      <Toaster theme="dark" position="bottom-right" richColors />
    </div>
    </TooltipProvider>
  );
}
